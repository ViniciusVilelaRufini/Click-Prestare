import { VisitantesService } from './visitantes.service';
import { criadoPelaPortaria, descricaoCriacaoVisita, tipoAvisoCriacaoVisita } from './aviso-criacao-visita.util';

/**
 * F5: todo cadastro de visita mandava "X acabou de chegar para o seu
 * apartamento" (push e WhatsApp) para a unidade inteira, inclusive para quem
 * acabou de agendar, mesmo com a visita marcada para o dia seguinte.
 *
 * Regra: quem criou não recebe. Agendamento (morador/síndico pelo app, ou
 * janela que começa no futuro) vira "X foi agendado para <data>" só por push.
 * "Acabou de chegar" (push + WhatsApp) fica para a portaria cadastrando quem
 * está no portão agora.
 */
const AGORA = new Date('2026-11-25T13:00:00Z'); // 10:00 em Brasília

const morador = { sub: 50, nome: 'Ana', typeAccess: 'Morador', user: { id: 50 } } as any;
const sindicoApp = { sub: 70, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 70 } } as any;
const funcionarioApp = { sub: 80, nome: 'Porteiro app', typeAccess: 'Funcionario', user: { id: 80 } } as any;
const porteiroConsole = { sub: 3, nome: 'QA porteiro', id_condominio: 1, turno: 'Diurno' } as any;

const daUnidade = [
  { id: 50, fcm_token: 'tok-ana', name: 'Ana', phone: '11999990001' },
  { id: 51, fcm_token: 'tok-bia', name: 'Bia', phone: '11999990002' },
];

const AGORA_LOCAL = '2026-11-25 10:00';
const AMANHA_LOCAL = '2026-11-26 08:00';

describe('aviso de criação de visita — regra', () => {
  it('portaria: console ou funcionário pelo app', () => {
    expect(criadoPelaPortaria(porteiroConsole)).toBe(true);
    expect(criadoPelaPortaria(funcionarioApp)).toBe(true);
    expect(criadoPelaPortaria(morador)).toBe(false);
    expect(criadoPelaPortaria(sindicoApp)).toBe(false);
    expect(criadoPelaPortaria(undefined)).toBe(false);
  });

  it('portaria com início agora é chegada; com início no futuro é agendamento', () => {
    const agora = AGORA.getTime();
    expect(tipoAvisoCriacaoVisita(porteiroConsole, AGORA, agora)).toBe('chegada');
    expect(tipoAvisoCriacaoVisita(porteiroConsole, new Date(agora + 5 * 60_000), agora)).toBe('chegada');
    expect(tipoAvisoCriacaoVisita(porteiroConsole, new Date(agora + 60 * 60_000), agora)).toBe('agendamento');
    expect(tipoAvisoCriacaoVisita(morador, AGORA, agora)).toBe('agendamento');
    expect(tipoAvisoCriacaoVisita(sindicoApp, AGORA, agora)).toBe('agendamento');
  });
});

function montar(flag: 'true' | 'false') {
  process.env['PESSOAS_MIGRATION_ENABLED'] = flag;
  const prisma: any = {
    isConnected: true,
    pessoas: {},
    visitas: { findFirst: jest.fn(async () => null) },
    visitantes: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 900, ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 901, ...data })),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    users: { findMany: jest.fn(async () => daUnidade.map((u) => ({ ...u }))) },
  };
  const notifications: any = { sendPushNotification: jest.fn(async () => undefined), sendWhatsApp: jest.fn(async () => undefined) };
  const visitasService: any = {
    criarVisita: jest.fn(async (dados: any) => ({
      id: 1000300,
      id_pessoa: 2000300,
      id_condominio: 1,
      id_apartamento: dados.id_apartamento,
      is_visitante: dados.is_visitante,
      is_prestador: dados.is_prestador,
      liberado: dados.liberado,
      codigo_acesso: dados.codigo_acesso,
      data_hora_inicio: dados.data_hora_inicio,
      data_hora_termino: dados.data_hora_termino,
      pessoa: { id: 2000300, nome: dados.pessoa.nome, tipo_pessoa: dados.pessoa.tipo_pessoa, foto_pessoa: null },
      apartamento: { bloco: 'A', apto: '106' },
    })),
  };
  const tenant: any = { assertPermissaoFuncionario: jest.fn(async () => undefined) };
  const svc = new VisitantesService(
    prisma, notifications, { isDataUrl: () => false } as any, {} as any, { registrar: jest.fn() } as any, tenant,
    { emitToCondominio: jest.fn() } as any, visitasService,
  );
  const s = svc as any;
  jest.spyOn(s, 'assertPodeUsarApartamento').mockResolvedValue(undefined);
  jest.spyOn(s, 'verificarSeBloqueadoPessoa').mockResolvedValue(false);
  jest.spyOn(s, 'verificarSeBloqueado').mockResolvedValue(false);
  jest.spyOn(s, 'aptosDoMoradorMobile').mockResolvedValue(undefined);
  jest.spyOn(s, 'resolveFoto').mockImplementation(async (v: any) => v ?? null);
  jest.spyOn(s, 'buscarPessoa').mockResolvedValue(null);
  jest.spyOn(s, 'gerarPinUnicoVisita').mockResolvedValue('123456');
  jest.spyOn(s, 'gerarPinUnico').mockResolvedValue('123456');
  jest.spyOn(s, 'desativarOutrosCodigosVisita').mockResolvedValue(undefined);
  jest.spyOn(s, 'desativarOutrosCodigos').mockResolvedValue(undefined);
  jest.spyOn(s, 'carregarContextoVisitante').mockResolvedValue(null);
  jest.spyOn(s, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
  jest.spyOn(s, 'fireFacialSync').mockImplementation(() => undefined);
  return { svc, s, prisma, notifications };
}

const dto = (inicio: string, extra: any = {}) => ({
  nome: 'Pedreiro João',
  id_apartamento: 106,
  id_condominio: 1,
  is_visitante: 0,
  is_prestador: 1,
  data_hora_inicio: inicio,
  ...extra,
});

function destinos(notifications: any): string[] {
  return notifications.sendPushNotification.mock.calls.map((c: any[]) => c[0]);
}
function corpos(notifications: any): string[] {
  return notifications.sendPushNotification.mock.calls.map((c: any[]) => c[2]);
}

describe.each([
  ['Pessoas/Visitas', 'true' as const],
  ['legado (Visitantes)', 'false' as const],
])('create (%s) — aviso aos moradores', (_nome, flag) => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    jest.useFakeTimers({ now: AGORA, doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  it('morador agenda para amanhã: quem criou não recebe; os outros recebem "agendado" só por push', async () => {
    const { svc, notifications } = montar(flag);
    await svc.create(dto(AMANHA_LOCAL) as any, morador);
    expect(destinos(notifications)).toEqual(['tok-bia']);
    expect(corpos(notifications)[0]).toBe('Pedreiro João foi agendado para 26/11/2026 08:00.');
    expect(corpos(notifications)[0]).not.toMatch(/chegar/);
    expect(notifications.sendPushNotification.mock.calls[0][3]).toEqual({ id: expect.any(String), type: 'visitante', id_condominio: '1' });
    expect(notifications.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('síndico pelo app cadastrando para agora também é agendamento (sem WhatsApp, sem avisar ele mesmo)', async () => {
    const { svc, notifications, prisma } = montar(flag);
    prisma.users.findMany.mockResolvedValue([
      { id: 70, fcm_token: 'tok-sindico', name: 'Síndico', phone: '1199' },
      { id: 51, fcm_token: 'tok-bia', name: 'Bia', phone: '1198' },
    ]);
    await svc.create(dto(AGORA_LOCAL) as any, sindicoApp);
    expect(destinos(notifications)).toEqual(['tok-bia']);
    expect(corpos(notifications)[0]).toMatch(/foi agendado para/);
    expect(notifications.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('portaria cadastra com início agora: "liberado pela portaria" por push e WhatsApp (nunca afirma que chegou)', async () => {
    const { svc, notifications } = montar(flag);
    await svc.create(dto(AGORA_LOCAL) as any, porteiroConsole);
    expect(destinos(notifications)).toEqual(['tok-ana', 'tok-bia']);
    expect(corpos(notifications)).toEqual([
      'Pedreiro João foi liberado pela portaria para o seu apartamento.',
      'Pedreiro João foi liberado pela portaria para o seu apartamento.',
    ]);
    expect(notifications.sendWhatsApp).toHaveBeenCalledTimes(2);
  });

  it('portaria cadastra para amanhã: agendamento, sem WhatsApp', async () => {
    const { svc, notifications } = montar(flag);
    await svc.create(dto(AMANHA_LOCAL) as any, porteiroConsole);
    expect(destinos(notifications)).toEqual(['tok-ana', 'tok-bia']);
    expect(corpos(notifications)[0]).toBe('Pedreiro João foi agendado para 26/11/2026 08:00.');
    expect(notifications.sendWhatsApp).not.toHaveBeenCalled();
  });
});

describe('create legado — reaproveitando agendamento ativo', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => jest.useFakeTimers({ now: AGORA, doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => {
    jest.useRealTimers();
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  it('morador reagenda: não recebe, e os outros recebem "agendado" sem WhatsApp', async () => {
    const { svc, notifications, prisma } = montar('false');
    prisma.visitantes.findFirst.mockResolvedValue({
      id: 901, nome: 'Pedreiro João', doc_identificacao: null, data_hora_inicio: new Date(), is_visitante: 0,
      is_prestador: 1, id_condominio: 1, id_apartamento: 106,
    });
    await svc.create(dto(AMANHA_LOCAL) as any, morador);
    expect(prisma.visitantes.update).toHaveBeenCalled();
    expect(destinos(notifications)).toEqual(['tok-bia']);
    expect(corpos(notifications)[0]).toBe('Pedreiro João foi agendado para 26/11/2026 08:00.');
    expect(notifications.sendWhatsApp).not.toHaveBeenCalled();
  });
});

describe('novaVisitaParaPessoa (Pessoas/Visitas) — aviso aos moradores', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => jest.useFakeTimers({ now: AGORA, doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => {
    jest.useRealTimers();
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  function comPessoa(flag: 'true') {
    const h = montar(flag);
    jest.spyOn(h.s, 'assertPodeAcessarPessoa').mockResolvedValue({
      id: 2000300, id_condominio: 1, nome: 'Pedreiro João', tipo_pessoa: 'prestador',
      doc_identificacao: null, foto_pessoa: null, foto_documento: null,
    });
    return h;
  }

  it('morador agenda de novo pela lista: quem criou não recebe; "agendado" sem WhatsApp para os outros', async () => {
    const { svc, notifications } = comPessoa('true');
    await svc.novaVisitaParaPessoa(2000300, { id_apartamento: 106, data_hora_inicio: AMANHA_LOCAL }, morador);
    expect(destinos(notifications)).toEqual(['tok-bia']);
    expect(corpos(notifications)[0]).toBe('Pedreiro João foi agendado para 26/11/2026 08:00.');
    expect(notifications.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('portaria libera de novo com início agora: "liberado pela portaria" com WhatsApp', async () => {
    const { svc, notifications } = comPessoa('true');
    await svc.novaVisitaParaPessoa(2000300, { id_apartamento: 106, data_hora_inicio: AGORA_LOCAL }, porteiroConsole);
    expect(destinos(notifications)).toEqual(['tok-ana', 'tok-bia']);
    expect(corpos(notifications)[0]).toBe('Pedreiro João foi liberado pela portaria para o seu apartamento.');
    expect(notifications.sendWhatsApp).toHaveBeenCalledTimes(2);
  });
});

describe('descricaoCriacaoVisita (auditoria)', () => {
  const porteiro: any = { id_condominio: 1, nome: 'Porteiro' };
  const morador: any = { sub: 5, typeAccess: 'Morador', user: { id: 5 } };

  it('portaria liberando quem está no portão não escreve "agendamento"', () => {
    expect(descricaoCriacaoVisita('Visitante', 'Ana', 'Apto 12', porteiro, new Date())).toBe('Visitante liberado pela portaria: "Ana" para Apto 12');
  });

  it('morador agendando, ou janela no futuro, segue "Novo agendamento"', () => {
    expect(descricaoCriacaoVisita('Visitante', 'Ana', 'Apto 12', morador, new Date())).toBe('Novo agendamento: Visitante "Ana" para Apto 12');
    expect(descricaoCriacaoVisita('Prestador', 'Zé', 'Apto 3', porteiro, new Date(Date.now() + 86_400_000))).toBe('Novo agendamento: Prestador "Zé" para Apto 3');
  });

  it('pedido de autorização pendente não diz "liberado" nem "agendamento"', () => {
    expect(descricaoCriacaoVisita('Visitante', 'Ana', 'Apto 12', porteiro, new Date(), true)).toBe('Novo cadastro: Visitante "Ana" para Apto 12');
  });
});
