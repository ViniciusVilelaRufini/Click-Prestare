import { BadRequestException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';

/**
 * Solicitar/Liberar reaproveitavam a MESMA visita e zeravam data_entrada e
 * data_saida. Numa visita já usada (entrou e saiu), isso apagava do registro
 * a passagem real — em produção, a entrada pelo facial das 01:40 e a baixa
 * das 01:46 sumiram da visita, e o painel ficou contraditório. Numa visita
 * em curso (pessoa dentro), apagava a entrada de quem ainda está no prédio.
 *
 * Agora: visita encerrada → nova visita; pessoa dentro → recusa.
 */
describe('Solicitar/Liberar não apagam o histórico de uma visita usada', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const entrou = new Date('2026-09-23T04:40:22Z');
  const saiu = new Date('2026-09-23T04:46:06Z');

  function montar(visitaInicial: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const pessoa = { id: 2000001, nome: 'QA_SECURITY_20260923', bloqueado: 0, foto_pessoa: null };
    const visitas = new Map<number, any>();
    const base = {
      id: 1000004,
      id_pessoa: 2000001,
      id_condominio: 1,
      id_apartamento: 106,
      user: 7,
      is_visitante: 1,
      is_prestador: 0,
      data_hora_inicio: new Date('2026-09-23T04:39:00Z'),
      data_hora_termino: new Date('2026-09-24T04:39:00Z'),
      data_entrada: null,
      data_saida: null,
      codigo_acesso: null,
      liberado: 0,
      bloqueado: 0,
      avisar: 1,
      tag_rfid: 'QA_TAG',
      dias_semana: null,
      categorias: null,
      auth_status: null,
      ...visitaInicial,
    };
    visitas.set(base.id, base);
    let seq = 1000005;
    const comRelacoes = (v: any) => ({ ...v, pessoa, apartamento: { bloco: 'A', apto: '106' } });
    const prisma: any = {
      isConnected: true,
      visitas: {
        create: jest.fn(async ({ data }: any) => {
          const nova = { id: seq++, ...data };
          visitas.set(nova.id, nova);
          return comRelacoes(nova);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const v = visitas.get(where.id);
          Object.assign(v, data);
          return comRelacoes(v);
        }),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, {} as any, { registrar: jest.fn() } as any, {} as any,
      { emitToCondominio: jest.fn() } as any,
    );
    const s = svc as any;
    jest.spyOn(s, 'assertPodeAcessarVisita').mockImplementation(async (id: any) => comRelacoes(visitas.get(Number(id))));
    jest.spyOn(s, 'notificarMoradoresAutorizacao').mockResolvedValue(undefined);
    jest.spyOn(s, 'desativarOutrosCodigosVisita').mockResolvedValue(undefined);
    jest.spyOn(s, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
    return { svc, prisma, visitas };
  }

  const operador = { sub: 3, nome: 'QA', id_condominio: 1 } as any;

  it.each([['solicitarAutorizacao'], ['liberarAcesso']])(
    '%s numa visita encerrada cria uma visita nova e preserva a antiga',
    async (acao) => {
      const { svc, prisma, visitas } = montar({ data_entrada: entrou, data_saida: saiu });
      await (svc as any)[acao](1000004, operador);

      const antiga = visitas.get(1000004);
      expect(antiga.data_entrada).toEqual(entrou);
      expect(antiga.data_saida).toEqual(saiu);
      expect(antiga.tag_rfid).toBeNull(); // credencial migra para a visita ativa

      expect(prisma.visitas.create).toHaveBeenCalledTimes(1);
      const nova = visitas.get(1000005);
      expect(nova).toEqual(
        expect.objectContaining({
          id_pessoa: 2000001,
          id_condominio: 1,
          id_apartamento: 106,
          data_entrada: null,
          data_saida: null,
          tag_rfid: 'QA_TAG',
        }),
      );
    },
  );

  it.each([['solicitarAutorizacao'], ['liberarAcesso']])(
    '%s com a pessoa dentro do condomínio é recusado sem apagar a entrada',
    async (acao) => {
      const { svc, prisma, visitas } = montar({ data_entrada: entrou, data_saida: null, liberado: 1 });
      await expect((svc as any)[acao](1000004, operador)).rejects.toBeInstanceOf(BadRequestException);
      expect(visitas.get(1000004).data_entrada).toEqual(entrou);
      expect(prisma.visitas.create).not.toHaveBeenCalled();
    },
  );

  it.each([['solicitarAutorizacao'], ['liberarAcesso']])(
    '%s numa visita ainda não usada continua na mesma visita',
    async (acao) => {
      const { svc, prisma } = montar({});
      await (svc as any)[acao](1000004, operador);
      expect(prisma.visitas.create).not.toHaveBeenCalled();
      expect(prisma.visitas.update.mock.calls[0][0].where.id).toBe(1000004);
    },
  );
});
