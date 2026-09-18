import { Test, TestingModule } from '@nestjs/testing';
import { MobileAuthService } from './mobile-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '../common/mail/mail.service';
import { StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';
import { TenantAccessService } from './tenant-access.service';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { ApartamentosService } from '../apartamentos/apartamentos.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SuperlogicaWriteService } from '../superlogica/superlogica-write.service';
import { MfaService } from './mfa/mfa.service';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('MobileAuthService.loginSindico — 2FA / MFA', () => {
  let service: MobileAuthService;
  let prisma: any;
  let mfa: any;
  let jwt: any;

  beforeEach(async () => {
    prisma = {
      isConnected: true,
      users: {
        findFirst: jest.fn(),
      },
    };

    mfa = {
      isDeviceTrusted: jest.fn(),
      createChallenge: jest.fn(),
    };

    jwt = {
      sign: jest.fn().mockReturnValue('mock-jwt-token-sindico'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: MailService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: FacialService, useValue: {} },
        { provide: TenantAccessService, useValue: {} },
        { provide: FinanceiroService, useValue: {} },
        { provide: ApartamentosService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: SuperlogicaWriteService, useValue: {} },
        { provide: MfaService, useValue: mfa },
      ],
    }).compile();

    service = module.get<MobileAuthService>(MobileAuthService);
  });

  it('deve recusar login com senha errada antes de qualquer chamada ao MFA', async () => {
    const passwordHash = await bcrypt.hash('correta', 10);
    prisma.users.findFirst.mockResolvedValue({
      id: 10,
      login: 'sindico@click.com',
      password: passwordHash,
      sindicos: [{ name: 'Carlos' }],
    });

    await expect(service.loginSindico('sindico@click.com', 'errada')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mfa.isDeviceTrusted).not.toHaveBeenCalled();
    expect(mfa.createChallenge).not.toHaveBeenCalled();
  });

  it('deve disparar desafio MFA se o dispositivo não for confiável (primeiro login / novo aparelho)', async () => {
    const passwordHash = await bcrypt.hash('senha123', 10);
    prisma.users.findFirst.mockResolvedValue({
      id: 10,
      login: 'sindico@click.com',
      email: 'sindico@click.com',
      password: passwordHash,
      sindicos: [{ name: 'Carlos Síndico' }],
    });

    mfa.isDeviceTrusted.mockResolvedValue(false);
    mfa.createChallenge.mockResolvedValue({
      mfa_required: true,
      mfa_token: 'uuid-desafio-123',
      email_masked: 'si****@click.com',
      expires_in_seconds: 600,
    });

    const res = await service.loginSindico('sindico@click.com', 'senha123', 'token-invalido');

    expect(mfa.isDeviceTrusted).toHaveBeenCalledWith(10, 'token-invalido');
    expect(mfa.createChallenge).toHaveBeenCalledWith({
      id: 10,
      email: 'sindico@click.com',
      name: 'Carlos Síndico',
    });
    expect((res as any).mfa_required).toBe(true);
    expect((res as any).mfa_token).toBe('uuid-desafio-123');
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('deve fazer bypass do MFA e emitir JWT direto se o dispositivo for confiável (30 dias)', async () => {
    const passwordHash = await bcrypt.hash('senha123', 10);
    prisma.users.findFirst.mockResolvedValue({
      id: 10,
      login: 'sindico@click.com',
      email: 'sindico@click.com',
      password: passwordHash,
      sindicos: [{ name: 'Carlos Síndico' }],
    });

    mfa.isDeviceTrusted.mockResolvedValue(true);

    const res = await service.loginSindico('sindico@click.com', 'senha123', 'token-confiavel-valido');

    expect(mfa.isDeviceTrusted).toHaveBeenCalledWith(10, 'token-confiavel-valido');
    expect(mfa.createChallenge).not.toHaveBeenCalled();
    expect((res as any).token).toBe('mock-jwt-token-sindico');
    expect((res as any).user.name).toBe('Carlos Síndico');
  });
});
