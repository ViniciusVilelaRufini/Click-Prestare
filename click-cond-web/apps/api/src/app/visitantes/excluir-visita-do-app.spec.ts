import { ForbiddenException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';
import { VisitantesGlobalController } from './visitantes.controller';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * O app apaga uma visita com `apiDeleteObject('visitantes', id)`, que bate em
 * POST /visitantes/remove — o par exato do /prestadores/remove, que existe.
 * Só que essa rota nunca foi declarada no controller: respondia 404, e o
 * helper do app só olha o status, então o botão "excluir" falhava em
 * silêncio. Prestador funcionava; visitante, não.
 *
 * O método do service também estava sem `payload`: apagava qualquer visita
 * por id, sem conferir nada. Passou despercebido justamente porque não havia
 * rota chamando.
 */
describe('POST /visitantes/remove — excluir visita pelo app', () => {
  const MEU_APTO = 7;
  const APTO_VIZINHO = 8;

  const morador: JwtPayload = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
  const porteiro: JwtPayload = { sub: 52, nome: 'Porteiro', id_condominio: 1 };

  function build(idApartamento: number) {
    const visitante = {
      id: 100,
      id_condominio: 1,
      id_apartamento: idApartamento,
      nome: 'Entregador',
      face_id: null,
      is_prestador: 0,
    };
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findUnique: jest.fn(async () => ({ ...visitante })),
        delete: jest.fn(async () => ({ ...visitante })),
      },
      vagas: { updateMany: jest.fn(async () => ({ count: 0 })) },
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 50 && where.id_apto === MEU_APTO ? { id_apto: MEU_APTO } : null,
        ),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const auditoria: any = { registrar: jest.fn() };
    const facial: any = { unsyncVisitante: jest.fn(async () => true) };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
    };
    const svc = new VisitantesService(prisma, {} as any, {} as any, facial, auditoria, tenant);
    return { svc, prisma, ctrl: new VisitantesGlobalController(svc) };
  }

  it('a rota existe e chega no service', async () => {
    const { ctrl, prisma } = build(MEU_APTO);
    await ctrl.remove(100, porteiro);
    expect(prisma.visitantes.delete).toHaveBeenCalledWith({ where: { id: 100 } });
  });

  it('NEGA morador apagar visita de apartamento que não é dele', async () => {
    const { svc, prisma } = build(APTO_VIZINHO);
    await expect(svc.remove(100, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.visitantes.delete).not.toHaveBeenCalled();
  });

  it('PERMITE morador apagar visita do próprio apartamento', async () => {
    const { svc, prisma } = build(MEU_APTO);
    await expect(svc.remove(100, morador)).resolves.toEqual({ success: true });
    expect(prisma.visitantes.delete).toHaveBeenCalled();
  });

  it('solta a vaga junto, como o removerPessoa', async () => {
    const { svc, prisma } = build(MEU_APTO);
    await svc.remove(100, porteiro);
    expect(prisma.vagas.updateMany).toHaveBeenCalledWith({
      where: { id_visitante: 100 },
      data: { id_visitante: null, ativo: 0 },
    });
  });
});
