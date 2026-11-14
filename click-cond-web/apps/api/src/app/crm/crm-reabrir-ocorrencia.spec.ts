import { CrmService } from './crm.service';
import { OcorrenciasService } from '../ocorrencias/ocorrencias.service';

/**
 * M11: o "Reabrir" do CRM gravava 'Pendente' e APAGAVA a resposta pública e
 * resposta_at. Agora segue a regra do Reabrir do console: a resposta da equipe
 * fica (é o histórico do atendimento e o que trava a edição pelo autor) e o
 * prazo recomeça de agora pelo SLA da categoria.
 */
describe('CrmService.reabrirOcorrencia', () => {
  const AGORA = new Date('2026-11-14T12:00:00Z');
  beforeAll(() => jest.useFakeTimers({ advanceTimers: true }).setSystemTime(AGORA));
  afterAll(() => jest.useRealTimers());

  function montar(oc: any) {
    const prisma: any = {
      isConnected: true,
      ocorrencias: {
        findUnique: jest.fn(async () => oc),
        update: jest.fn(async ({ data }: any) => ({ ...oc, ...data })),
      },
      ocorrencias_Categorias: { findUnique: jest.fn(async () => ({ sla_horas: 24 })) },
    };
    const ocorrencias = new OcorrenciasService(prisma, {} as any, {} as any, {} as any);
    jest.spyOn(ocorrencias, 'createMessageDoSistema').mockResolvedValue({} as any);
    const crm = new CrmService(prisma, ocorrencias, {} as any);
    return { crm, prisma };
  }

  it('reabre como Pendente sem apagar a resposta, com prazo novo pelo SLA', async () => {
    const { crm, prisma } = montar({
      id: 5, tipo: 3, status: 'Solucionado', descricao: 'Vazamento',
      resposta: 'Trocamos o registro.', resposta_at: new Date('2026-11-10T10:00:00Z'),
      prazo: new Date('2026-11-09T10:00:00Z'),
    });

    await crm.reabrirOcorrencia(5, 'Voltou a vazar');

    const data = prisma.ocorrencias.update.mock.calls[0][0].data;
    expect(data.status).toBe('Pendente');
    expect(data.descricao).toContain('Voltou a vazar');
    expect(data).not.toHaveProperty('resposta');
    expect(data).not.toHaveProperty('resposta_at');
    expect(prisma.ocorrencias_Categorias.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 } }));
    expect(data.prazo).toEqual(new Date(AGORA.getTime() + 24 * 3600 * 1000));
  });

  it('sem categoria, o prazo fica nulo (mesma conta do cadastro)', async () => {
    const { crm, prisma } = montar({ id: 6, tipo: null, status: 'Solucionado', descricao: 'X', resposta: 'ok' });
    await crm.reabrirOcorrencia(6, 'mais');
    expect(prisma.ocorrencias.update.mock.calls[0][0].data.prazo).toBeNull();
  });
});
