import { NotFoundException } from '@nestjs/common';
import { ChatIaService } from './chat-ia.service';

/**
 * Conversas separadas no histórico do assistente.
 *
 * O que estes testes travam é o escopo: o app manda o `conversa_id`, mas o
 * dono sai sempre do JWT. Um id válido de outra pessoa não pode ler, apagar,
 * nem virar contexto da conversa de quem perguntou.
 */
describe('ChatIaService — conversas', () => {
  const USER = { user: { id: 47 }, sub: 47 } as any;
  const OUTRO_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  function montar(overrides: Record<string, any> = {}) {
    const historico = {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      ...overrides,
    };
    const prisma = { isConnected: true, chat_Ia_Historico: historico };
    const tenant = { assertCondominio: jest.fn().mockResolvedValue(undefined) };
    const svc = new ChatIaService(prisma as any, tenant as any, {} as any);
    return { svc, historico, tenant };
  }

  describe('listarConversas', () => {
    it('escopa por condomínio e usuário do JWT e ignora linhas sem conversa', async () => {
      const { svc, historico, tenant } = montar({
        groupBy: jest.fn().mockResolvedValue([
          {
            conversa_id: 'c1',
            _max: { created_at: new Date('2026-08-28T12:00:00Z'), titulo: 'Boleto de agosto' },
            _count: { _all: 4 },
          },
        ]),
      });

      const lista = await svc.listarConversas(1, USER);

      expect(tenant.assertCondominio).toHaveBeenCalledWith(1, USER);
      const where = historico.groupBy.mock.calls[0][0].where;
      expect(where.id_condominio).toBe(1);
      expect(where.id_user).toBe(47);
      expect(where.conversa_id).toEqual({ not: null });
      expect(lista).toEqual([
        {
          conversa_id: 'c1',
          titulo: 'Boleto de agosto',
          ultima_em: new Date('2026-08-28T12:00:00Z'),
          total: 4,
        },
      ]);
    });

    it('conversa sem título gravado não vai vazia para a lateral', async () => {
      const { svc } = montar({
        groupBy: jest.fn().mockResolvedValue([
          { conversa_id: 'c1', _max: { created_at: new Date(), titulo: null }, _count: { _all: 2 } },
        ]),
      });
      const [conversa] = await svc.listarConversas(1, USER);
      expect(conversa.titulo).toBe('Conversa');
    });
  });

  describe('obterConversa', () => {
    it('consulta sempre com o usuário do JWT', async () => {
      const { svc, historico } = montar({
        findMany: jest
          .fn()
          .mockResolvedValue([{ papel: 'user', mensagem: 'oi', created_at: new Date() }]),
      });

      await svc.obterConversa(1, 'c1', USER);

      const where = historico.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ id_condominio: 1, id_user: 47, conversa_id: 'c1' });
    });

    it('conversa de outro usuário não é encontrada', async () => {
      // O where inclui o id_user do JWT, então a consulta volta vazia.
      const { svc } = montar({ findMany: jest.fn().mockResolvedValue([]) });
      await expect(svc.obterConversa(1, OUTRO_ID, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('apagarConversa', () => {
    it('apaga apenas dentro do escopo do usuário', async () => {
      const { svc, historico } = montar({
        deleteMany: jest.fn().mockResolvedValue({ count: 6 }),
      });

      const res = await svc.apagarConversa(1, 'c1', USER);

      expect(historico.deleteMany.mock.calls[0][0].where).toEqual({
        id_condominio: 1,
        id_user: 47,
        conversa_id: 'c1',
      });
      expect(res).toEqual({ ok: true, removidas: 6 });
    });

    it('apagar conversa alheia não remove nada e devolve não encontrada', async () => {
      const { svc } = montar({ deleteMany: jest.fn().mockResolvedValue({ count: 0 }) });
      await expect(svc.apagarConversa(1, OUTRO_ID, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('resolverConversa', () => {
    const resolver = (svc: ChatIaService, pedida?: string) =>
      (svc as any).resolverConversa(1, 47, pedida) as Promise<{
        conversaId: string;
        nova: boolean;
      }>;

    it('sem id, abre conversa nova', async () => {
      const { svc, historico } = montar();
      const r = await resolver(svc);
      expect(r.nova).toBe(true);
      expect(r.conversaId).toHaveLength(36);
      expect(historico.findFirst).not.toHaveBeenCalled();
    });

    it('id da própria conversa continua a conversa', async () => {
      const { svc } = montar({ findFirst: jest.fn().mockResolvedValue({ id: 10 }) });
      expect(await resolver(svc, 'c1')).toEqual({ conversaId: 'c1', nova: false });
    });

    it('id de outro usuário abre conversa nova em vez de continuar a alheia', async () => {
      // findFirst já filtra por id_user: para este usuário, o id não existe.
      const { svc } = montar({ findFirst: jest.fn().mockResolvedValue(null) });
      const r = await resolver(svc, OUTRO_ID);
      expect(r.nova).toBe(true);
      expect(r.conversaId).not.toBe(OUTRO_ID);
    });
  });

  describe('histórico por conversa', () => {
    it('só carrega turnos da conversa aberta', async () => {
      const { svc, historico } = montar();
      await (svc as any).getHistoricoRecente(1, 47, 'c1');
      expect(historico.findMany.mock.calls[0][0].where).toEqual({
        id_condominio: 1,
        id_user: 47,
        conversa_id: 'c1',
      });
    });

    it('grava o título apenas na primeira linha da conversa', async () => {
      const { svc, historico } = montar();
      await (svc as any).salvarTurnos(
        1,
        47,
        [
          { papel: 'user', mensagem: 'Quando vence o boleto?' },
          { papel: 'assistant', mensagem: 'Vence dia 10.' },
        ],
        'c1',
        'Quando vence o boleto?',
      );
      const data = historico.createMany.mock.calls[0][0].data;
      expect(data.map((d: any) => d.conversa_id)).toEqual(['c1', 'c1']);
      expect(data.map((d: any) => d.titulo)).toEqual(['Quando vence o boleto?', null]);
    });

    it('turno de conversa já existente não regrava título', async () => {
      const { svc, historico } = montar();
      await (svc as any).salvarTurnos(
        1,
        47,
        [{ papel: 'user', mensagem: 'e a taxa?' }],
        'c1',
        undefined,
      );
      expect(historico.createMany.mock.calls[0][0].data[0].titulo).toBeNull();
    });
  });
});
