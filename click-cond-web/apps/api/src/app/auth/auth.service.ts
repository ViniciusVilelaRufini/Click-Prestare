import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from './jwt-payload.interface';
import { QrSessionStore } from './qr-session.store';

/**
 * Lockout em memória por login. Após N tentativas falhas em janela,
 * trava o login por X minutos. Defende contra password spray que muda
 * de IP a cada tentativa (escapando do rate limit por IP).
 */
interface LockoutEntry {
  failedAt: number[];
  lockedUntil: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly lockouts = new Map<string, LockoutEntry>();
  private readonly maxFailures = Number(process.env.AUTH_MAX_FAILURES ?? 8);
  private readonly failureWindowMs = Number(process.env.AUTH_FAILURE_WINDOW_MS ?? 600_000);
  private readonly lockoutMs = Number(process.env.AUTH_LOCKOUT_MS ?? 900_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly qrStore: QrSessionStore,
  ) {}

  private isLocked(login: string): boolean {
    const entry = this.lockouts.get(login);
    if (!entry) return false;
    if (entry.lockedUntil > Date.now()) return true;
    if (entry.lockedUntil && entry.lockedUntil <= Date.now()) {
      // Janela expirou — limpa.
      this.lockouts.delete(login);
    }
    return false;
  }

  private registrarFalha(login: string) {
    const now = Date.now();
    const entry = this.lockouts.get(login) ?? { failedAt: [], lockedUntil: 0 };
    // Mantém só falhas dentro da janela.
    entry.failedAt = entry.failedAt.filter((t) => now - t < this.failureWindowMs);
    entry.failedAt.push(now);
    if (entry.failedAt.length >= this.maxFailures) {
      entry.lockedUntil = now + this.lockoutMs;
      this.logger.warn(`Login "${login}" travado por ${this.lockoutMs / 60_000}min após ${entry.failedAt.length} falhas`);
    }
    this.lockouts.set(login, entry);
  }

  private limparFalhas(login: string) {
    this.lockouts.delete(login);
  }

  async loginPortaria(login: string, senha: string) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    // Lockout por login antes mesmo do lookup no banco — evita user enumeration
    // (resposta diferente quando login existe vs. quando não existe).
    if (this.isLocked(login)) {
      throw new UnauthorizedException(
        'Muitas tentativas falhas. Tente novamente mais tarde.',
      );
    }

    const funcionario = await this.prisma.funcionarios_Portaria.findFirst({
      where: { login, ativo: 1 },
    });

    if (!funcionario) {
      this.registrarFalha(login);
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const isBcrypt = funcionario.password.startsWith('$2');
    let isMatch = false;

    if (isBcrypt) {
      isMatch = await bcrypt.compare(senha, funcionario.password);
    } else {
      const md5Password = createHash('md5').update(senha).digest('hex');
      isMatch = funcionario.password === md5Password;
      if (isMatch) {
        const newHash = await bcrypt.hash(senha, 12);
        await this.prisma.funcionarios_Portaria.update({
          where: { id: funcionario.id },
          data: { password: newHash },
        });
      }
    }

    if (!isMatch) {
      this.registrarFalha(login);
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Login bem-sucedido: reseta contador de falhas.
    this.limparFalhas(login);

    // Busca o nome do condomínio associado
    const cond = await this.prisma.condominios.findUnique({
      where: { id: funcionario.id_condominio },
      select: { nome: true },
    });

    const payload: JwtPayload = {
      sub: funcionario.id,
      nome: funcionario.nome,
      id_condominio: funcionario.id_condominio,
      turno: funcionario.turno,
    };

    return {
      access_token: this.jwt.sign(payload),
      id: funcionario.id,
      nome: funcionario.nome,
      turno: funcionario.turno,
      id_condominio: funcionario.id_condominio,
      condominio_nome: cond?.nome || 'Click Condomínio',
    };
  }

  async changePassword(id: number, senhaAtual: string, novaSenha: string) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    const funcionario = await this.prisma.funcionarios_Portaria.findUnique({
      where: { id },
    });

    if (!funcionario) {
      throw new UnauthorizedException('Funcionário não encontrado.');
    }

    const isBcrypt = funcionario.password.startsWith('$2');
    let isMatch = false;

    if (isBcrypt) {
      isMatch = await bcrypt.compare(senhaAtual, funcionario.password);
    } else {
      const md5Password = createHash('md5').update(senhaAtual).digest('hex');
      isMatch = funcionario.password === md5Password;
    }

    if (!isMatch) {
      throw new UnauthorizedException('Senha atual incorreta.');
    }

    const newHash = await bcrypt.hash(novaSenha, 12);
    await this.prisma.funcionarios_Portaria.update({
      where: { id },
      data: { password: newHash },
    });

    return { success: true, message: 'Senha updated com sucesso.' };
  }

  async getCondominioNome(id: number) {
    if (!this.prisma.isConnected) {
      return { nome: 'Click Condomínio' };
    }
    const cond = await this.prisma.condominios.findUnique({
      where: { id },
      select: { nome: true },
    });
    return { nome: cond?.nome || 'Click Condomínio' };
  }

  /**
   * Garante que o usuário autenticado tem vínculo com o condomínio antes de
   * emitir um token de portaria via QR. Síndico: precisa estar em
   * Sindicos_Condominios. Demais (porteiro/app): via Funcionarios ou
   * Funcionarios_Portaria do condomínio.
   */
  private async assertVinculoCondominio(userId: number, typeAccess: string, idCondominio: number) {
    if (!this.prisma.isConnected) return;

    const tipo = (typeAccess ?? '').toLowerCase();

    if (tipo === 'sindico') {
      const vinculo = await this.prisma.sindicos_Condominios.findFirst({
        where: { id_user: userId, id_condominio: idCondominio },
        select: { id: true },
      });
      if (!vinculo) {
        throw new UnauthorizedException('Você não tem vínculo com este condomínio.');
      }
      return;
    }

    // Funcionário/porteiro: vínculo via Funcionarios (id_user) ou, para o
    // porteiro-web, via Funcionarios_Portaria.
    const func = await this.prisma.funcionarios.findFirst({
      where: { id_user: userId, id_condominio: idCondominio },
      select: { id: true },
    });
    if (func) return;

    const funcPortaria = await this.prisma.funcionarios_Portaria.findFirst({
      where: { id: userId, id_condominio: idCondominio },
      select: { id: true },
    });
    if (funcPortaria) return;

    throw new UnauthorizedException('Você não tem vínculo com este condomínio.');
  }

  createQrSession() {
    const session = this.qrStore.create();
    return { qrToken: session.qrToken, expiresAt: session.expiresAt };
  }

  async getQrStatus(qrToken: string) {
    const session = this.qrStore.get(qrToken);
    if (!session) {
      return { status: 'expired' };
    }

    if (session.status === 'confirmed') {
      return {
        status: 'confirmed',
        access_token: session.access_token,
        id: session.idUser,
        nome: session.nome,
        turno: session.typeAccess === 'Sindico' ? 'Síndico' : 'Porteiro (App)',
        id_condominio: session.id_condominio,
        condominio_nome: session.condominio_nome,
      };
    }

    return { status: 'pending' };
  }

  async authorizeQrSession(payload: JwtPayload, qrToken: string, idCondominio: number) {
    const session = this.qrStore.get(qrToken);
    if (!session) {
      throw new UnauthorizedException('QR Code expirado ou inválido.');
    }

    if (session.status !== 'pending') {
      throw new UnauthorizedException('Sessão QR Code já processada.');
    }

    const cond = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { nome: true },
    });

    if (!cond) {
      throw new UnauthorizedException('Condomínio não encontrado.');
    }

    const userId = payload.sub;
    const typeAccess = payload.typeAccess ?? 'Sindico';

    // Verifica que o usuário autenticado realmente tem vínculo com o condomínio
    // solicitado. Sem isso, um síndico de um condomínio mintava um token de
    // portaria para QUALQUER condomínio só passando o id_condominio no body.
    await this.assertVinculoCondominio(userId, typeAccess, idCondominio);
    const nomeUsuario = payload.nome;

    const portariaPayload: JwtPayload = {
      sub: userId,
      nome: nomeUsuario,
      id_condominio: idCondominio,
      turno: typeAccess === 'Sindico' ? 'Síndico' : 'Porteiro (App)',
    };

    const accessToken = this.jwt.sign(portariaPayload);

    this.qrStore.confirm(qrToken, {
      idUser: userId,
      nome: nomeUsuario,
      typeAccess,
      id_condominio: idCondominio,
      condominio_nome: cond.nome,
      access_token: accessToken,
    });

    return { success: true };
  }
}
