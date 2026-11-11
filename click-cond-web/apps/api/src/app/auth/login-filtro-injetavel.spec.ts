import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MobileAuthService } from './mobile-auth.service';
import { CrmAuthService } from '../crm/crm-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';
import { StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';
import { TenantAccessService } from './tenant-access.service';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { ApartamentosService } from '../apartamentos/apartamentos.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SuperlogicaWriteService } from '../superlogica/superlogica-write.service';
import { MfaService } from './mfa/mfa.service';

describe('logins: login/senha só como string (sem filtro injetável)', () => {
  const objeto: any = { not: '' };

  it('loginSindico recusa objeto em login ou senha sem consultar o banco', async () => {
    const prisma: any = { isConnected: true, users: { findFirst: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [
        MobileAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: MailService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: FacialService, useValue: {} },
        { provide: TenantAccessService, useValue: {} },
        { provide: FinanceiroService, useValue: {} },
        { provide: ApartamentosService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: SuperlogicaWriteService, useValue: {} },
        { provide: MfaService, useValue: {} },
      ],
    }).compile();
    const service = mod.get(MobileAuthService);

    await expect(service.loginSindico(objeto, 'x')).rejects.toThrow(UnauthorizedException);
    await expect(service.loginSindico('a@b.com', objeto)).rejects.toThrow(UnauthorizedException);
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
  });

  it('CrmAuthService.login recusa objeto em login ou senha sem consultar o banco', async () => {
    const prisma: any = { isConnected: true, crm_Admins: { findFirst: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [
        CrmAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn() } },
      ],
    }).compile();
    const service = mod.get(CrmAuthService);

    await expect(service.login(objeto, 'x')).rejects.toThrow(UnauthorizedException);
    await expect(service.login('admin', objeto)).rejects.toThrow(UnauthorizedException);
    expect(prisma.crm_Admins.findFirst).not.toHaveBeenCalled();
  });
});
