import { VisitantesService } from './visitantes.service';
import { VisitantesGlobalController } from './visitantes.controller';
import { prazoAutorizacaoRemotaMs } from '../common/janela-visita';
import { mantemLiberadoNaSaida } from './visitantes.service';

/**
 * Rodada 4, item 1: a autorização remota do morador vale 10 min também no
 * portão (facial). Quando a portaria clica em Liberar depois disso, a decisão
 * passa a ser dela — liberação da portaria vale pela janela, como sempre.
 * Sem limpar o `auth_status`, a visita seguia "autorização remota vencida" e
 * o portão continuava fechado mesmo com a portaria liberando.
 */
describe('Liberar (Pessoas/Visitas) sobre autorização remota do morador', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  function montar(extra: Record<string, unknown> = {}) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const pessoa = { id: 2000001, nome: 'QA_Remota', bloqueado: 0 };
    const agora = Date.now();
    const visita: any = {
      id: 1000004, id_pessoa: 2000001, id_condominio: 1, id_apartamento: 106, user: null,
      is_visitante: 1, is_prestador: 0,
      data_hora_inicio: new Date(agora - 25 * 60_000), data_hora_termino: new Date(agora + 3 * 60 * 60_000),
      data_entrada: null, data_saida: null, codigo_acesso: null, liberado: 1, bloqueado: 0,
      auth_status: 'autorizado', auth_solicitado_em: new Date(agora - 25 * 60_000),
      auth_respondido_em: new Date(agora - 20 * 60_000), auth_respondido_por: 77,
      ...extra,
    };
    const rel = (v: any) => ({ ...v, pessoa, apartamento: { bloco: 'A', apto: '106' } });
    const prisma: any = {
      isConnected: true,
      visitas: {
        update: jest.fn(async ({ data }: any) => rel(Object.assign(visita, data))),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, {} as any, { registrar: jest.fn() } as any, {} as any,
      { emitToCondominio: jest.fn() } as any,
    );
    const s = svc as any;
    jest.spyOn(s, 'assertPodeAcessarVisita').mockImplementation(async () => rel(visita));
    jest.spyOn(s, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
    return { svc, prisma, visita };
  }

  const porteiro = { sub: 3, nome: 'Portaria', id_condominio: 1, turno: 'Manha' } as any;

  it('a portaria libera depois dos 10 min: vira liberação da portaria e o portão volta a abrir pela janela', async () => {
    const { svc, visita } = montar();
    expect(prazoAutorizacaoRemotaMs(visita)).not.toBeNull();
    await svc.liberarAcesso(1000004, porteiro, undefined, 'autorizado');
    expect(visita.liberado).toBe(1);
    expect(visita.auth_status).toBeNull();
    expect(prazoAutorizacaoRemotaMs(visita)).toBeNull();
  });

  it('pedido resolvido pela própria portaria (sem Users.id): o Liberar não mexe no auth_status', async () => {
    const { svc, visita } = montar({ auth_respondido_por: null });
    await svc.liberarAcesso(1000004, porteiro, undefined, 'autorizado');
    expect(visita.auth_status).toBe('autorizado');
  });

  // Rodada 1, M-3: a auditoria diz que houve conversão.
  it('a auditoria do Liberar registra a conversão da autorização remota (expirada)', async () => {
    const { svc } = montar();
    await svc.liberarAcesso(1000004, porteiro, undefined, 'autorizado');
    const auditoria = (svc as any).auditoria.registrar.mock.calls[0][0];
    expect(auditoria.descricao).toMatch(/converteu a autorização remota do morador, expirada, em liberação direta/);
  });

  it('sem autorização remota a descrição do Liberar fica como antes', async () => {
    const { svc } = montar({ auth_status: null, auth_respondido_por: null });
    await svc.liberarAcesso(1000004, porteiro);
    expect((svc as any).auditoria.registrar.mock.calls[0][0].descricao).not.toMatch(/converteu/);
  });

  // Rodada 1, I-2: a autorização remota vale uma entrada — a baixa do console
  // não mantém a liberação, nem do prestador; a vaga cedida pelo morador sim.
  describe('mantemLiberadoNaSaida com autorização remota', () => {
    const remota = { auth_status: 'autorizado', auth_respondido_em: new Date(), auth_respondido_por: 77 };
    it('prestador vindo de pedido: não mantém', () => {
      expect(mantemLiberadoNaSaida({ is_prestador: 1, ...remota })).toBe(false);
    });
    it('recorrente vindo de pedido: não mantém', () => {
      const futuro = new Date(Date.now() + 24 * 60 * 60_000);
      expect(mantemLiberadoNaSaida({ dias_semana: 'seg', data_hora_termino: futuro, ...remota })).toBe(false);
    });
    it('com vaga vigente: mantém', () => {
      expect(mantemLiberadoNaSaida({ ...remota }, Date.now(), true)).toBe(true);
    });
    it('prestador sem pedido: mantém como sempre', () => {
      expect(mantemLiberadoNaSaida({ is_prestador: 1 })).toBe(true);
    });
  });

  // Rodada 1, M-1 (parte do morador): mudar as datas de uma visita remota não
  // usada é uma liberação nova dele — deixa de ser remota.
  describe('morador edita a janela da visita remota não usada', () => {
    const morador = { sub: 77, typeAccess: 'Morador', user: { id: 77 } } as any;
    function montarEdicao() {
      const m = montar();
      const s = m.svc as any;
      jest.spyOn(s, 'assertFlagCadastrarVisitante').mockResolvedValue(undefined);
      jest.spyOn(s, 'assertPodeUsarApartamento').mockResolvedValue(undefined);
      jest.spyOn(s, 'aptosDoMoradorMobile').mockResolvedValue([106]);
      jest.spyOn(s, 'mapVisitaParaRespostaLegada').mockReturnValue({});
      return m;
    }
    const fmtLocal = (d: Date) =>
      new Date(d.getTime() - 3 * 60 * 60_000).toISOString().slice(0, 19).replace('T', ' ');

    it('mudou o término: auth_status sai e a janela dele vale', async () => {
      const { svc, prisma, visita } = montarEdicao();
      await svc.update({
        id: 1000004, id_apartamento: 106,
        data_hora_termino: fmtLocal(new Date(visita.data_hora_termino.getTime() + 60 * 60_000)),
      } as any, morador);
      expect(prisma.visitas.update.mock.calls[0][0].data).toEqual(expect.objectContaining({ auth_status: null }));
    });

    it('sem mudar a janela (o app manda o formulário inteiro): continua remota', async () => {
      const { svc, prisma } = montarEdicao();
      await svc.update({ id: 1000004, id_apartamento: 106, categorias: 'Amigo' } as any, morador);
      expect(prisma.visitas.update.mock.calls[0][0].data).not.toHaveProperty('auth_status');
    });
  });

  // Rodada 2, Importante 2: o payload EXATO do app ao salvar a edição
  // (new_visitante.dart → apiSaveVisitante: POST /visitantes/update com
  // `{ id_condominio, visitante }`; as datas são `DateTime.toString()` de um
  // valor lido em "dd/MM/yyyy HH:mm" — sem segundos). O pedido gravou a janela
  // com segundos: comparar ao segundo convertia toda edição.
  describe('edição pelo app — payload exato', () => {
    const morador = { sub: 77, nome: 'Maria do 106', typeAccess: 'Morador', user: { id: 77 } } as any;
    // Janela do pedido com segundos: 14:00:37–18:00:37 BRT.
    const janelaDoPedido = {
      data_hora_inicio: new Date('2026-11-16T17:00:37Z'),
      data_hora_termino: new Date('2026-11-16T21:00:37Z'),
      auth_respondido_em: new Date('2026-11-16T17:01:10Z'),
    };
    function montarApp() {
      const m = montar(janelaDoPedido);
      const s = m.svc as any;
      m.prisma.visitas.count = jest.fn(async () => 0);
      m.prisma.pessoas = { update: jest.fn(async ({ data }: any) => ({ id: 2000001, nome: 'QA_Remota', ...data })) };
      jest.spyOn(s, 'assertFlagCadastrarVisitante').mockResolvedValue(undefined);
      jest.spyOn(s, 'assertPodeUsarApartamento').mockResolvedValue(undefined);
      jest.spyOn(s, 'aptosDoMoradorMobile').mockResolvedValue([106]);
      jest.spyOn(s, 'resolveFoto').mockImplementation(async (v: any) => (v ? 'https://arquivos/nova.jpg' : null));
      jest.spyOn(s, 'mapVisitaParaRespostaLegada').mockReturnValue({});
      const controller = new VisitantesGlobalController(m.svc);
      return { ...m, controller };
    }
    const corpo = (visitante: Record<string, unknown>) => ({
      id_condominio: '1',
      visitante: {
        id: 1000004, id_anterior: null, nome_anterior: null, nome: 'QA_Remota', doc_identificacao: '',
        avisar: true, observacoes: '', id_apartamento: 106, is_visitante: true, is_prestador: false,
        dias_semana: '', photo: null,
        data_inicio: '2026-11-16 14:00:00.000', data_termino: '2026-11-16 18:00:00.000',
        ...visitante,
      },
    });
    const conversoes = (m: any) =>
      m.svc.auditoria.registrar.mock.calls.filter((c: any[]) => /converteu a autorização remota/.test(c[0].descricao));

    it('reenviar as mesmas datas sem segundos e trocar só a foto NÃO converte', async () => {
      const m = montarApp();
      await m.controller.update(corpo({ photo: 'data:image/jpeg;base64,/9j/AAAA' }) as any, morador);
      expect(m.prisma.visitas.update.mock.calls[0][0].data).not.toHaveProperty('auth_status');
      expect(m.visita.auth_status).toBe('autorizado');
      expect(conversoes(m)).toHaveLength(0);
    });

    it('mudar o término converte e audita em nome do morador, com a janela', async () => {
      const m = montarApp();
      await m.controller.update(corpo({ data_termino: '2026-11-16 20:00:00.000' }) as any, morador);
      expect(m.prisma.visitas.update.mock.calls[0][0].data).toEqual(expect.objectContaining({ auth_status: null }));
      const [aud] = conversoes(m);
      expect(aud?.[0]).toEqual(
        expect.objectContaining({
          usuario_nome: 'Maria do 106',
          descricao: expect.stringContaining('converteu a autorização remota em liberação própria, janela 16/11 14:00–20:00'),
        }),
      );
    });
  });
});
