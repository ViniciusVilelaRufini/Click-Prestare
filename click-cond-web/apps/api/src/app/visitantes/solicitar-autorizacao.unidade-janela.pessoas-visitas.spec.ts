import { VisitantesService } from './visitantes.service';

/**
 * Solicitar (portaria remota), caminho Pessoas/Visitas:
 *  - A7: o pedido ia sempre para a visita PRINCIPAL e, com outra unidade
 *    escolhida, MOVIA essa visita de apartamento — levando junto a liberação
 *    da unidade original. Agora mira a visita da unidade escolhida; sem visita
 *    ali, cria uma nova.
 *  - A4: a visita copiada (visita já usada) herdava a janela antiga, muitas
 *    vezes vencida: o morador autorizava, a tela mostrava "Liberar catraca" e
 *    o facial recusava fora da janela. Em cópia ou janela vencida, a janela do
 *    pedido passa a ser agora → +4 h.
 */
describe('solicitarAutorizacao (Pessoas/Visitas) — unidade escolhida e janela do pedido', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const H = 60 * 60 * 1000;
  const operador = { sub: 3, nome: 'QA', id_condominio: 1 } as any;

  function montar(lista: Record<string, unknown>[]) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const pessoa = { id: 2000001, nome: 'QA_Solicitar', bloqueado: 0, foto_pessoa: null };
    const visitas = new Map<number, any>();
    for (const extra of lista) {
      const v = {
        id_pessoa: 2000001,
        id_condominio: 1,
        id_apartamento: 106,
        user: 7,
        is_visitante: 1,
        is_prestador: 0,
        data_hora_inicio: new Date(Date.now() - H),
        data_hora_termino: new Date(Date.now() + 3 * H),
        data_entrada: null,
        data_saida: null,
        codigo_acesso: null,
        liberado: 0,
        bloqueado: 0,
        avisar: 1,
        tag_rfid: null,
        dias_semana: null,
        categorias: null,
        auth_status: null,
        created_at: new Date(Date.now() - 2 * H),
        ...extra,
      };
      visitas.set(v.id as number, v);
    }
    let seq = 1000100;
    const comRelacoes = (v: any) => ({ ...v, pessoa, apartamento: { bloco: 'A', apto: String(v.id_apartamento) } });
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: 1 })) },
      visitas: {
        findFirst: jest.fn(async ({ where }: any) => {
          const achadas = [...visitas.values()]
            .filter((v) => v.id_pessoa === where.id_pessoa && v.id_apartamento === where.id_apartamento)
            .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
          return achadas[0] ? comRelacoes(achadas[0]) : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const nova = { id: seq++, created_at: new Date(), ...data };
          visitas.set(nova.id, nova);
          return comRelacoes(nova);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const v = visitas.get(where.id);
          Object.assign(v, data);
          return comRelacoes(v);
        }),
      },
    };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, {} as any, { registrar: jest.fn() } as any, {} as any,
      { emitToCondominio: jest.fn() } as any,
    );
    const s = svc as any;
    jest.spyOn(s, 'assertPodeAcessarVisita').mockImplementation(async (id: any) => comRelacoes(visitas.get(Number(id))));
    jest.spyOn(s, 'assertPodeUsarApartamento').mockResolvedValue(undefined);
    jest.spyOn(s, 'notificarMoradoresAutorizacao').mockResolvedValue(undefined);
    return { svc, prisma, visitas };
  }

  describe('A7 — unidade escolhida', () => {
    it('com visita na unidade escolhida: o pedido vai para ELA; a da outra unidade não muda', async () => {
      const { svc, visitas } = montar([
        { id: 1000004, id_apartamento: 106, liberado: 1 },
        { id: 1000020, id_apartamento: 107 },
      ]);
      await svc.solicitarAutorizacao(1000004, operador, 107);
      expect(visitas.get(1000020).auth_status).toBe('pendente');
      const original106 = visitas.get(1000004);
      expect(original106.id_apartamento).toBe(106);
      expect(original106.liberado).toBe(1);
      expect(original106.auth_status).toBeNull();
    });

    it('sem visita na unidade escolhida: cria uma visita nova lá, sem PIN e sem liberação', async () => {
      const { svc, prisma, visitas } = montar([{ id: 1000004, id_apartamento: 106, liberado: 1 }]);
      await svc.solicitarAutorizacao(1000004, operador, 107);
      expect(prisma.visitas.create).toHaveBeenCalledTimes(1);
      const nova = visitas.get(1000100);
      expect(nova).toEqual(
        expect.objectContaining({ id_pessoa: 2000001, id_apartamento: 107, codigo_acesso: null, liberado: 0, auth_status: 'pendente' }),
      );
      expect(visitas.get(1000004)).toEqual(expect.objectContaining({ id_apartamento: 106, liberado: 1, auth_status: null }));
    });

    it('mesma unidade da visita: segue na própria visita', async () => {
      const { svc, prisma, visitas } = montar([{ id: 1000004, id_apartamento: 106 }]);
      await svc.solicitarAutorizacao(1000004, operador, 106);
      expect(prisma.visitas.create).not.toHaveBeenCalled();
      expect(visitas.get(1000004).auth_status).toBe('pendente');
    });
  });

  describe('A4 — janela do pedido', () => {
    const perto = (d: Date, alvo: number) => Math.abs(new Date(d).getTime() - alvo) < 60 * 1000;

    it('visita usada (cópia) com janela vencida: a cópia ganha janela agora → +4 h', async () => {
      const { svc, visitas } = montar([
        {
          id: 1000004,
          data_entrada: new Date(Date.now() - 30 * H),
          data_saida: new Date(Date.now() - 29 * H),
          data_hora_inicio: new Date(Date.now() - 31 * H),
          data_hora_termino: new Date(Date.now() - 27 * H),
        },
      ]);
      await svc.solicitarAutorizacao(1000004, operador);
      const copia = visitas.get(1000100);
      expect(copia.auth_status).toBe('pendente');
      expect(perto(copia.data_hora_inicio, Date.now())).toBe(true);
      expect(perto(copia.data_hora_termino, Date.now() + 4 * H)).toBe(true);
    });

    it('visita não usada com janela vencida: janela agora → +4 h', async () => {
      const { svc, visitas } = montar([
        { id: 1000004, data_hora_inicio: new Date(Date.now() - 10 * H), data_hora_termino: new Date(Date.now() - 6 * H) },
      ]);
      await svc.solicitarAutorizacao(1000004, operador);
      const v = visitas.get(1000004);
      expect(perto(v.data_hora_inicio, Date.now())).toBe(true);
      expect(perto(v.data_hora_termino, Date.now() + 4 * H)).toBe(true);
    });

    it('visita não usada com janela valendo: janela intacta', async () => {
      const inicio = new Date(Date.now() - H);
      const termino = new Date(Date.now() + 3 * H);
      const { svc, visitas } = montar([{ id: 1000004, data_hora_inicio: inicio, data_hora_termino: termino }]);
      await svc.solicitarAutorizacao(1000004, operador);
      const v = visitas.get(1000004);
      expect(v.data_hora_inicio).toEqual(inicio);
      expect(v.data_hora_termino).toEqual(termino);
    });
  });
});
