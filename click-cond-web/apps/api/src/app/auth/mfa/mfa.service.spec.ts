import { Test, TestingModule } from '@nestjs/testing';
import { MfaService } from './mfa.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

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

      await expect(service.verifyChallenge('token-invalido', '123456', false)).rejects.toThrow(
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

      await expect(service.verifyChallenge('token-valido', '123456', false)).rejects.toThrow(
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

      await expect(service.verifyChallenge('token-valido', '999999', false)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.mfa_Challenges.update).toHaveBeenCalledWith({
        where: { id: 1 },
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

      const res = await service.verifyChallenge('token-valido', '123456', false);

      expect(res.token).toBe('jwt-token-sindico-123');
      expect(res.user.name).toBe('Carlos Síndico');
      expect(prisma.mfa_Challenges.delete).toHaveBeenCalledWith({ where: { id: 1 } });
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

      const res = await service.verifyChallenge('token-valido', '123456', true, {
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
