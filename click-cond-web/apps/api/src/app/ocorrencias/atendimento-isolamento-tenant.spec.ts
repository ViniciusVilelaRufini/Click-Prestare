import { ForbiddenException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Os specs do atendimento pelo console mockam `assertEntidade` como "passa".
 * Aqui o TenantAccessService é o real: o porteiro de OUTRO condomínio e o
 * token do CRM não mexem na ocorrência nem escrevem no chat dela — 403 e
 * nada gravado.
 */
describe('Ocorrências — atendimento e chat isolados por condomínio (TenantAccessService real)', () => {
  function montar() {
    const oc = { id: 5, id_condominio: 1, user: 100, status: 'Pendente', tipo: 1, publica: false };
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn(async () => ({ ocorrencias: 1 })) },
      ocorrencias: {
        findUnique: jest.fn(async () => ({ ...oc })),
        update: jest.fn(async ({ data }: any) => ({ ...oc, ...data })),
        delete: jest.fn(async () => ({})),
      },
      ocorrencias_Categorias: { findUnique: jest.fn(async () => ({ sla_horas: 24 })) },
      ocorrenciaMensagens: { create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })) },
      funcionarios_Portaria: { findMany: jest.fn(async () => []) },
      users: { findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    };
    const tenant = new TenantAccessService(prisma);
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const svc = new OcorrenciasService(prisma, notifications, tenant, {} as any);
    const nadaGravado = () => {
      expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
      expect(prisma.ocorrencias.delete).not.toHaveBeenCalled();
      expect(prisma.ocorrenciaMensagens.create).not.toHaveBeenCalled();
      expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    };
    return { svc, nadaGravado };
  }

  const porteiroDeOutro: JwtPayload = {
    sub: 3, nome: 'João', id_condominio: 2, turno: 'Diurno', tipo_sub: 'funcionario_portaria',
  };
  const crm = { sub: 1, nome: 'Operador CRM', role: 'crm_admin' } as JwtPayload;

  it.each([
    ['porteiro do condomínio 2', porteiroDeOutro],
    ['token do CRM', crm],
  ])('%s → 403 em todo atendimento e no chat, nada gravado', async (_n, user) => {
    const { svc, nadaGravado } = montar();
    const tentativas = [
      () => svc.updateStatus(5, 'Ciente', user),
      () => svc.updateResposta(5, 'x', user),
      () => svc.atribuir(5, null, user),
      () => svc.createMessage(5, null, 'x', user),
      () => svc.listMessages(5, user),
      () => svc.remove(5, user),
      () => svc.updatePublica(5, true, user),
    ];
    for (const t of tentativas) {
      await expect(t()).rejects.toBeInstanceOf(ForbiddenException);
    }
    nadaGravado();
  });
});
