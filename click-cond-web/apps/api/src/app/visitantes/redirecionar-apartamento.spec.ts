import { ForbiddenException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * `solicitarAutorizacao` aceita um `id_apartamento` para o porteiro
 * redirecionar o visitante a outra unidade. A checagem era só "o apto é do
 * mesmo condomínio" — mais fraca que a do create/update, que usam
 * `assertPodeUsarApartamento` e exigem que morador aponte só para
 * apartamento dele.
 *
 * Pelo caminho fraco, um morador redirecionava a própria visita para a
 * unidade do vizinho: o registro MIGRAVA de apartamento e o vizinho recebia
 * um push pedindo para autorizar um desconhecido — com o visitante já
 * apontando para a casa dele.
 */
describe('VisitantesService — redirecionar visita para outro apartamento', () => {
  const MEU_APTO = 7;
  const APTO_VIZINHO = 8;
  const COND = 1;

  const visitante = {
    id: 100,
    id_condominio: COND,
    id_apartamento: MEU_APTO,
    nome: 'Entregador',
    bloqueado: 0,
    liberado: 1,
  };

  const morador: JwtPayload = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
  const porteiro: JwtPayload = { sub: 52, nome: 'Porteiro', id_condominio: COND };

  function build() {
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findUnique: jest.fn(async () => ({ ...visitante })),
        update: jest.fn(async ({ data }: any) => ({ ...visitante, ...data })),
        findMany: jest.fn(async () => []),
      },
      apartamentos: {
        findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: COND })),
      },
      // O morador 50 mora só no apto 7.
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 50 && where.id_apto === MEU_APTO ? { id_apto: MEU_APTO } : null,
        ),
        findMany: jest.fn(async () => []),
      },
      users: { findMany: jest.fn(async () => []) },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
    };
    const auditoria: any = { registrar: jest.fn() };
    const facial: any = { syncVisitante: jest.fn(async () => undefined), unsyncVisitante: jest.fn(async () => true) };
    const notif: any = { sendPushNotification: jest.fn(async () => undefined) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
    };
    const realtime: any = { emitToCondominio: jest.fn() };
    const svc = new VisitantesService(prisma, notif, storage, facial, auditoria, tenant, realtime);
    jest.spyOn(svc as any, 'notificarMoradoresAutorizacao').mockResolvedValue(undefined);
    jest.spyOn(svc as any, 'carregarContextoVisitante').mockResolvedValue(null);
    return { svc, prisma };
  }

  it('NEGA morador redirecionar a visita para o apartamento do vizinho', async () => {
    const { svc, prisma } = build();
    await expect(svc.solicitarAutorizacao(100, morador, APTO_VIZINHO))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.visitantes.update).not.toHaveBeenCalled();
  });

  it('PERMITE morador pedir autorização sem redirecionar', async () => {
    const { svc, prisma } = build();
    await svc.solicitarAutorizacao(100, morador);
    const data = prisma.visitantes.update.mock.calls[0][0].data;
    expect(data.auth_status).toBe('pendente');
    // Sem redirecionamento, o apartamento não é tocado.
    expect(data.id_apartamento).toBeUndefined();
  });

  it('PERMITE porteiro redirecionar para outra unidade do condomínio', async () => {
    const { svc, prisma } = build();
    await svc.solicitarAutorizacao(100, porteiro, APTO_VIZINHO);
    const data = prisma.visitantes.update.mock.calls[0][0].data;
    expect(data.id_apartamento).toBe(APTO_VIZINHO);
    expect(data.auth_status).toBe('pendente');
  });

  it('morador redirecionar para o PRÓPRIO apartamento é inofensivo', async () => {
    const { svc, prisma } = build();
    await svc.solicitarAutorizacao(100, morador, MEU_APTO);
    // Igual ao atual: nem entra no ramo de redirecionamento.
    expect(prisma.visitantes.update).toHaveBeenCalled();
  });
});
