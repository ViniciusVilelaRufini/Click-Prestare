import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

export interface CreateChallengeResult {
  mfa_required: true;
  mfa_token: string;
  email_masked: string;
  expires_in_seconds: number;
}

export interface VerifyMfaResult {
  token: string;
  user: { id: number; name: string; photo: string };
  device_token?: string;
}

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
  ) {}

  maskEmail(email: string): string {
    if (!email || !email.includes('@')) return 'e-mail';
    const [user, domain] = email.split('@');
    if (user.length <= 2) {
      return `${user.charAt(0)}*@${domain}`;
    }
    const prefix = user.substring(0, 2);
    return `${prefix}****@${domain}`;
  }

  async createChallenge(user: { id: number; email: string; name: string }): Promise<CreateChallengeResult> {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível.');
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const token = crypto.randomUUID();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

    await this.prisma.mfa_Challenges.create({
      data: {
        id_user: user.id,
        token,
        code_hash: codeHash,
        tentativas: 0,
        expires_at: expiresAt,
      },
    });

    try {
      await this.mail.sendMfaCode(user.email, user.name, code);
    } catch (err: any) {
      this.logger.error(`Falha ao disparar e-mail de 2FA para ${user.email}: ${err?.message ?? err}`);
      await this.prisma.mfa_Challenges.deleteMany({ where: { token } }).catch(() => null);
      throw new ServiceUnavailableException(
        `Não foi possível enviar o código para o e-mail cadastrado (${this.maskEmail(
          user.email,
        )}). Detalhes: ${err?.message ?? 'Serviço de e-mail indisponível'}`,
      );
    }

    return {
      mfa_required: true,
      mfa_token: token,
      email_masked: this.maskEmail(user.email),
      expires_in_seconds: 600,
    };
  }

  async verifyChallenge(
    mfaToken: string,
    code: string,
    rememberDevice = false,
    meta?: { userAgent?: string; ip?: string },
  ): Promise<VerifyMfaResult> {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível.');
    }

    const challenge = await this.prisma.mfa_Challenges.findFirst({
      where: {
        token: mfaToken,
        expires_at: { gt: new Date() },
      },
      include: {
        user: {
          include: { sindicos: true },
        },
      },
    });

    if (!challenge || !challenge.user) {
      throw new BadRequestException('Código expirado ou inválido. Solicite um novo.');
    }

    if (challenge.tentativas >= 5) {
      await this.prisma.mfa_Challenges.delete({ where: { id: challenge.id } }).catch(() => null);
      throw new HttpException(
        'Muitas tentativas incorretas. O código foi invalidado por segurança.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const isMatch = await bcrypt.compare(String(code).trim(), challenge.code_hash);
    if (!isMatch) {
      await this.prisma.mfa_Challenges.update({
        where: { id: challenge.id },
        data: { tentativas: { increment: 1 } },
      });
      const restam = Math.max(0, 5 - (challenge.tentativas + 1));
      throw new UnauthorizedException(`Código incorreto. Restam ${restam} tentativa(s).`);
    }

    // Código correto: apaga o desafio para evitar replay
    await this.prisma.mfa_Challenges.delete({ where: { id: challenge.id } }).catch(() => null);

    let deviceToken: string | undefined;
    if (rememberDevice) {
      deviceToken = crypto.randomBytes(32).toString('hex');
      const deviceHash = crypto.createHash('sha256').update(deviceToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 dias

      await this.prisma.user_Trusted_Devices.create({
        data: {
          id_user: challenge.id_user,
          device_hash: deviceHash,
          user_agent: meta?.userAgent ?? null,
          ip_address: meta?.ip ?? null,
          expires_at: expiresAt,
        },
      }).catch((err) => {
        this.logger.warn(`Falha ao registrar dispositivo confiável: ${err?.message}`);
      });
    }

    const user = challenge.user;
    const sindico = user.sindicos?.[0];
    const userObj = {
      id: user.id,
      name: sindico?.name ?? 'Síndico',
      photo: user.photo ?? '',
    };
    const payload = {
      sub: user.id,
      nome: userObj.name,
      typeAccess: 'Sindico',
      user: userObj,
    };

    const token = this.jwt.sign(payload, { expiresIn: '365d' });

    return {
      token,
      user: userObj,
      device_token: deviceToken,
    };
  }

  async resendChallenge(mfaToken: string): Promise<{ success: boolean; message: string }> {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível.');
    }

    const challenge = await this.prisma.mfa_Challenges.findFirst({
      where: { token: mfaToken },
      include: {
        user: {
          include: { sindicos: true },
        },
      },
    });

    if (!challenge || !challenge.user) {
      throw new BadRequestException('Desafio não encontrado ou expirado.');
    }

    // Cooldown de 60 segundos
    const tempoDecorridoMs = Date.now() - new Date(challenge.created_at).getTime();
    if (tempoDecorridoMs < 60_000) {
      const segundosRestantes = Math.ceil((60_000 - tempoDecorridoMs) / 1000);
      throw new HttpException(
        `Aguarde ${segundosRestantes}s para solicitar um novo código.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const novoCodigo = crypto.randomInt(100000, 999999).toString();
    const novoHash = await bcrypt.hash(novoCodigo, 10);
    const novoExpires = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.mfa_Challenges.update({
      where: { id: challenge.id },
      data: {
        code_hash: novoHash,
        tentativas: 0,
        expires_at: novoExpires,
        created_at: new Date(),
      },
    });

    const user = challenge.user;
    const nome = user.sindicos?.[0]?.name ?? 'Síndico';
    const email = (user.sindicos?.[0]?.email?.trim() && user.sindicos[0].email.includes('@'))
      ? user.sindicos[0].email.trim()
      : (user.email?.trim() && user.email.includes('@'))
        ? user.email.trim()
        : (user.login?.trim() && user.login.includes('@'))
          ? user.login.trim()
          : '';

    if (!email) {
      throw new BadRequestException('E-mail cadastrado inválido para reenvio do código.');
    }

    try {
      await this.mail.sendMfaCode(email, nome, novoCodigo);
    } catch (err: any) {
      this.logger.error(`Falha ao reenviar e-mail de 2FA para ${email}: ${err?.message ?? err}`);
      throw new ServiceUnavailableException(
        `Não foi possível reenviar o código para ${this.maskEmail(
          email,
        )}. Detalhes: ${err?.message ?? 'Falha no serviço de e-mail'}`,
      );
    }

    return { success: true, message: 'Novo código enviado com sucesso!' };
  }

  async checkMailHealth() {
    return this.mail.getHealth();
  }

  async isDeviceTrusted(userId: number, deviceToken?: string): Promise<boolean> {
    if (!deviceToken || !this.prisma.isConnected) return false;

    const deviceHash = crypto.createHash('sha256').update(deviceToken.trim()).digest('hex');

    const trusted = await this.prisma.user_Trusted_Devices.findFirst({
      where: {
        id_user: Number(userId),
        device_hash: deviceHash,
        expires_at: { gt: new Date() },
      },
    });

    return !!trusted;
  }
}
