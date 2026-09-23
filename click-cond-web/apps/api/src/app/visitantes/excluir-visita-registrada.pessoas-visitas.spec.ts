import { BadRequestException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';

/**
 * O botão "Excluir" do app (tela de edição da visita) apagava qualquer visita
 * do apartamento — inclusive a de quem já passou pela portaria ou ainda está
 * dentro. A linha de `Visitas` é o registro de entrada/saída do condomínio:
 * apagá-la some com a passagem do histórico da portaria e, com a pessoa
 * dentro, tira ela da lista "no local". O morador só cancela o que ainda não
 * aconteceu; a portaria/síndico continuam podendo remover.
 */
describe('POST /visitantes/remove — visita já registrada pela portaria', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const MEU_APTO = 106;
  const morador = { sub: 50, nome: 'QA_SECURITY_20260923 morador', typeAccess: 'Morador' } as any;
  const porteiro = { sub: 3, nome: 'QA_SECURITY_20260923 porteiro', id_condominio: 1 } as any;

  function montar(visita: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const v = {
      id: 1000004, id_pessoa: 2000001, id_condominio: 1, id_apartamento: MEU_APTO,
      is_prestador: 0, data_entrada: null, data_saida: null,
      pessoa: { id: 2000001, nome: 'QA_SECURITY_20260923', doc_identificacao: null, face_id: null },
      ...visita,
    };
    const prisma: any = {
      isConnected: true,
      pessoas: {},
      visitas: {
        findUnique: jest.fn(async () => ({ ...v })),
        delete: jest.fn(async () => ({ ...v })),
      },
      vagas: { updateMany: jest.fn(async () => ({ count: 0 })) },
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 50 && where.id_apto === MEU_APTO ? { id_apto: MEU_APTO } : null,
        ),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, {} as any, { registrar: jest.fn() } as any, tenant,
    );
    jest.spyOn(svc as any, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
    return { svc, prisma };
  }

  it('morador cancela visita agendada que ainda não aconteceu', async () => {
    const { svc, prisma } = montar({});
    await expect(svc.remove(1000004, morador)).resolves.toEqual({ success: true });
    expect(prisma.visitas.delete).toHaveBeenCalled();
  });

  it('morador NÃO apaga a visita de quem está dentro do condomínio', async () => {
    const { svc, prisma } = montar({ data_entrada: new Date('2026-09-23T13:00:00Z') });
    await expect(svc.remove(1000004, morador)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.visitas.delete).not.toHaveBeenCalled();
    expect(prisma.vagas.updateMany).not.toHaveBeenCalled();
  });

  it('morador NÃO apaga a visita que já terminou (histórico da portaria)', async () => {
    const { svc, prisma } = montar({
      data_entrada: new Date('2026-09-22T13:00:00Z'),
      data_saida: new Date('2026-09-22T14:00:00Z'),
    });
    await expect(svc.remove(1000004, morador)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.visitas.delete).not.toHaveBeenCalled();
  });

  it('portaria continua podendo remover uma visita registrada', async () => {
    const { svc, prisma } = montar({ data_entrada: new Date('2026-09-23T13:00:00Z') });
    await expect(svc.remove(1000004, porteiro)).resolves.toEqual({ success: true });
    expect(prisma.visitas.delete).toHaveBeenCalled();
  });
});
