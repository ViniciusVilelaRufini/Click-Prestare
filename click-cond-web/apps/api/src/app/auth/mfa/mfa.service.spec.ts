import { Test, TestingModule } from '@nestjs/testing';
import { MfaService } from './mfa.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const TOKEN = '3f2b8c1e-5a4d-4e7f-9b6a-1c2d3e4f5a6b';

describe('MfaService', () => {
  let service: MfaService;
  let prisma: any;
  let mail: any;
  let jwt: any;

  beforeEach(async () => {
    prisma = {
      isConnected: true,
      mfa_Challenges: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 1 }),
        delete: jest.fn().mockResolvedValue({ id: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user_Trusted_Devices: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        findFirst: jest.fn(),
      },
    };

    mail = {
      sendMfaCode: jest.fn().mockResolvedValue(undefined),
    };

    jwt = {
      sign: jest.fn().mockReturnValue('jwt-token-sindico-123'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MfaService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();

    service = module.get<MfaService>(MfaService);
  });

  describe('createChallenge', () => {
    it('deve gerar código de 6 dígitos, hash bcrypt, salvar no banco e enviar e-mail', async () => {
      const res = await service.createChallenge({
        id: 42,
        email: 'sindico@click.com',
        name: 'Carlos Síndico',
      });

      expect(res.mfa_required).toBe(true);
      expect(res.mfa_token).toBeDefined();
      expect(res.email_masked).toBe('si****@click.com');
      expect(res.expires_in_seconds).toBe(600);

      expect(prisma.mfa_Challenges.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id_user: 42,
            tentativas: 0,
          }),
        }),
      );
      expect(mail.sendMfaCode).toHaveBeenCalledWith(
        'sindico@click.com',
        'Carlos Síndico',
        expect.stringMatching(/^\d{6}$/),
      );
    });
  });

  describe('verifyChallenge', () => {
    it('deve falhar com BadRequest se o desafio não existir ou estiver expirado', async () => {
      prisma.mfa_Challenges.findFirst.mockResolvedValue(null);

      await expect(service.verifyChallenge(TOKEN, '123456', false)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve falhar com 429 se exceder 5 tentativas', async () => {
      prisma.mfa_Challenges.findFirst.mockResolvedValue({
        id: 1,
        id_user: 42,
        tentativas: 5,
        expires_at: new Date(Date.now() + 100000),
        user: { id: 42, sindicos: [{ name: 'Carlos Síndico' }] },
      });

      await expect(service.verifyChallenge(TOKEN, '123456', false)).rejects.toThrow(
        HttpException,
      );
      expect(prisma.mfa_Challenges.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('deve falhar com UnauthorizedException se o código for incorreto e incrementar tentativas', async () => {
      const codeHash = await bcrypt.hash('123456', 10);
      prisma.mfa_Challenges.findFirst.mockResolvedValue({
        id: 1,
        id_user: 42,
        code_hash: codeHash,
        tentativas: 1,
        expires_at: new Date(Date.now() + 100000),
        user: { id: 42, sindicos: [{ name: 'Carlos Síndico' }] },
      });

      await expect(service.verifyChallenge(TOKEN, '999999', false)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.mfa_Challenges.updateMany).toHaveBeenCalledWith({
        where: { id: 1, tentativas: { lt: 5 }, expires_at: { gt: expect.any(Date) } },
        data: { tentativas: { increment: 1 } },
      });
    });

    it('deve autenticar com sucesso, deletar desafio e emitir JWT quando código estiver correto', async () => {
      const codeHash = await bcrypt.hash('123456', 10);
      prisma.mfa_Challenges.findFirst.mockResolvedValue({
        id: 1,
        id_user: 42,
        code_hash: codeHash,
        tentativas: 0,
        expires_at: new Date(Date.now() + 100000),
        user: {
          id: 42,
          photo: 'https://foto.jpg',
          sindicos: [{ name: 'Carlos Síndico' }],
        },
      });

      const res = await service.verifyChallenge(TOKEN, '123456', false);

      expect(res.token).toBe('jwt-token-sindico-123');
      expect(res.user.name).toBe('Carlos Síndico');
      expect(prisma.mfa_Challenges.deleteMany).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(prisma.user_Trusted_Devices.create).not.toHaveBeenCalled();
    });

    it('deve gerar device_token de 30 dias quando rememberDevice for true', async () => {
      const codeHash = await bcrypt.hash('123456', 10);
      prisma.mfa_Challenges.findFirst.mockResolvedValue({
        id: 1,
        id_user: 42,
        code_hash: codeHash,
        tentativas: 0,
        expires_at: new Date(Date.now() + 100000),
        user: {
          id: 42,
          photo: '',
          sindicos: [{ name: 'Carlos Síndico' }],
        },
      });

      const res = await service.verifyChallenge(TOKEN, '123456', true, {
        userAgent: 'Flutter Mobile App',
        ip: '192.168.1.1',
      });

      expect(res.device_token).toBeDefined();
      expect(res.device_token?.length).toBe(64);
      expect(prisma.user_Trusted_Devices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id_user: 42,
            user_agent: 'Flutter Mobile App',
            ip_address: '192.168.1.1',
          }),
        }),
      );
    });
  });


  describe('createChallenge: limpeza e erro de e-mail', () => {
    it('apaga os desafios vencidos do mesmo usuário ao criar um novo', async () => {
      await service.createChallenge({ id: 42, email: 'sindico@click.com', name: 'Carlos' });
      expect(prisma.mfa_Challenges.deleteMany).toHaveBeenCalledWith({
        where: { id_user: 42, expires_at: { lte: expect.any(Date) } },
      });
    });

    it('falha de SMTP volta mensagem genérica, sem detalhe interno', async () => {
      mail.sendMfaCode.mockRejectedValue(new Error('connect ECONNREFUSED smtp.interno:587'));
      const erro = await service
        .createChallenge({ id: 42, email: 'sindico@click.com', name: 'Carlos' })
        .catch((e) => e);
      expect(erro.message).toBe('Não foi possível enviar o código agora. Tente novamente em instantes.');
      expect(JSON.stringify(erro.getResponse())).not.toMatch(/ECONNREFUSED|smtp|click\.com/);
    });
  });

  describe('entrada: mfa_token e code só como string no formato do serviço', () => {
    it.each([
      [{ startsWith: 'a' }, '123456'],
      ['token-qualquer', '123456'],
      [TOKEN, { not: '' }],
      [TOKEN, 123456],
    ])('verify recusa (%p, %p) com 400 sem consultar o banco', async (tok: any, code: any) => {
      await expect(service.verifyChallenge(tok, code, false)).rejects.toThrow(BadRequestException);
      expect(prisma.mfa_Challenges.findFirst).not.toHaveBeenCalled();
    });

    it.each([[{ startsWith: 'a' }], ['abc'], [undefined]])(
      'resend recusa %p com 400 sem consultar o banco',
      async (tok: any) => {
        await expect(service.resendChallenge(tok)).rejects.toThrow(BadRequestException);
        expect(prisma.mfa_Challenges.findFirst).not.toHaveBeenCalled();
      },
    );
  });

  describe('verify: concorrência', () => {
    const desafioOk = async () => ({
      id: 1,
      id_user: 42,
      code_hash: await bcrypt.hash('123456', 10),
      tentativas: 0,
      expires_at: new Date(Date.now() + 100000),
      user: { id: 42, photo: '', sindicos: [{ name: 'Carlos' }] },
    });

    it('sem vaga de tentativa (updateMany count 0): recusa, apaga e nem chama bcrypt', async () => {
      prisma.mfa_Challenges.findFirst.mockResolvedValue(await desafioOk());
      prisma.mfa_Challenges.updateMany.mockResolvedValue({ count: 0 });
      const spy = jest.spyOn(bcrypt, 'compare');
      await expect(service.verifyChallenge(TOKEN, '123456', false)).rejects.toThrow(HttpException);
      expect(spy).not.toHaveBeenCalled();
      expect(prisma.mfa_Challenges.deleteMany).toHaveBeenCalledWith({ where: { id: 1 } });
      spy.mockRestore();
    });

    it('acerto que perdeu a disputa pelo consumo (deleteMany count 0) não emite token', async () => {
      prisma.mfa_Challenges.findFirst.mockResolvedValue(await desafioOk());
      prisma.mfa_Challenges.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.verifyChallenge(TOKEN, '123456', false)).rejects.toThrow(BadRequestException);
      expect(jwt.sign).not.toHaveBeenCalled();
    });
  });

  describe('verify: tentativas esgotadas', () => {
    it('apaga o desafio quando o erro atual esgota as tentativas', async () => {
      prisma.mfa_Challenges.findFirst.mockResolvedValue({
        id: 1,
        id_user: 42,
        code_hash: await bcrypt.hash('123456', 10),
        tentativas: 4,
        expires_at: new Date(Date.now() + 100000),
        user: { id: 42, sindicos: [] },
      });
      await expect(service.verifyChallenge(TOKEN, '999999', false)).rejects.toThrow(HttpException);
      expect(prisma.mfa_Challenges.deleteMany).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });

  describe('resendChallenge', () => {
    const desafio = (extra: any = {}) => ({
      id: 1,
      id_user: 42,
      tentativas: 3,
      created_at: new Date(Date.now() - 120_000),
      expires_at: new Date(Date.now() + 300_000),
      user: { id: 42, email: 'sindico@click.com', login: 'x', sindicos: [{ name: 'Carlos', email: 'sindico@click.com' }] },
      ...extra,
    });

    it('só procura desafio ainda válido (expires_at > agora)', async () => {
      prisma.mfa_Challenges.findFirst.mockResolvedValue(null);
      await expect(service.resendChallenge(TOKEN)).rejects.toThrow(BadRequestException);
      expect(prisma.mfa_Challenges.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token: TOKEN, expires_at: { gt: expect.any(Date) } },
        }),
      );
    });

    it('não zera tentativas nem estende a validade', async () => {
      prisma.mfa_Challenges.findFirst.mockResolvedValue(desafio());
      await service.resendChallenge(TOKEN);
      const data = prisma.mfa_Challenges.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('tentativas');
      expect(data).not.toHaveProperty('expires_at');
      expect(mail.sendMfaCode).toHaveBeenCalledTimes(1);
    });

    it('devolve expires_in_seconds = segundos restantes do desafio', async () => {
      prisma.mfa_Challenges.findFirst.mockResolvedValue(desafio());
      const res = await service.resendChallenge(TOKEN);
      expect(res.expires_in_seconds).toBeGreaterThanOrEqual(298);
      expect(res.expires_in_seconds).toBeLessThanOrEqual(300);
    });

    it('recusa o quarto reenvio do mesmo desafio', async () => {
      prisma.mfa_Challenges.findFirst.mockResolvedValue(desafio());
      await service.resendChallenge(TOKEN);
      await service.resendChallenge(TOKEN);
      await service.resendChallenge(TOKEN);
      await expect(service.resendChallenge(TOKEN)).rejects.toThrow(HttpException);
      expect(mail.sendMfaCode).toHaveBeenCalledTimes(3);
    });

    it('falha de SMTP no reenvio volta mensagem genérica', async () => {
      prisma.mfa_Challenges.findFirst.mockResolvedValue(desafio());
      mail.sendMfaCode.mockRejectedValue(new Error('535 auth failed smtp.interno'));
      const erro = await service.resendChallenge(TOKEN).catch((e) => e);
      expect(erro.message).toBe('Não foi possível enviar o código agora. Tente novamente em instantes.');
    });
  });

  describe('isDeviceTrusted', () => {
    it('retorna false se não houver device token', async () => {
      expect(await service.isDeviceTrusted(42, '')).toBe(false);
    });

    it('retorna true quando o hash do token confere no banco com expiração futura', async () => {
      const rawToken = 'minha-chave-secreta-de-aparelho-123456';
      const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

      prisma.user_Trusted_Devices.findFirst.mockResolvedValue({ id: 99 });

      const isTrusted = await service.isDeviceTrusted(42, rawToken);
      expect(isTrusted).toBe(true);
      expect(prisma.user_Trusted_Devices.findFirst).toHaveBeenCalledWith({
        where: {
          id_user: 42,
          device_hash: hash,
          expires_at: { gt: expect.any(Date) },
        },
      });
    });
  });
});
