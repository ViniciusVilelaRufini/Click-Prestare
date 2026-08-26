import {
  SuperlogicaClient,
  SuperlogicaHttpError,
  SuperlogicaRotaBloqueadaError,
} from './superlogica.client';

/**
 * O ERP da Superlógica tem boletos de clientes reais da administradora. Estes
 * testes existem para garantir que a integração não consiga escrever lá nem
 * por acidente. Nenhum deles toca a rede: `fetch` é mockado.
 */
describe('SuperlogicaClient — travas de segurança', () => {
  let client: SuperlogicaClient;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.SUPERLOGICA_APP_TOKEN = 'app-token-falso';
    process.env.SUPERLOGICA_ACCESS_TOKEN = 'access-token-falso';
    client = new SuperlogicaClient();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const respostaOk = (corpo: unknown) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(corpo),
  });

  it('recusa a rota que dispara e-mail real para o morador', async () => {
    // Esta é um GET, então uma trava "só GET" não pegaria: o endpoint
    // emailcobrancasemaberto envia e-mail de cobrança para pessoas reais.
    await expect(
      client.get('publico/emailcobrancasemaberto', { cpf: '00000000000' }),
    ).rejects.toBeInstanceOf(SuperlogicaRotaBloqueadaError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'cobranca/liquidar',
    'cobranca/estornar',
    'cobranca/excluir',
    'comunicados/notificarcomunicado',
    'ocorrencias/imprimircarta',
  ])('recusa a rota de escrita %s', async (rota) => {
    await expect(client.get(rota)).rejects.toBeInstanceOf(SuperlogicaRotaBloqueadaError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recusa rota fora da allowlist mesmo sendo inofensiva', async () => {
    // Allowlist, não blocklist: o que não foi liberado não passa.
    await expect(client.get('despesas/index')).rejects.toBeInstanceOf(SuperlogicaRotaBloqueadaError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('não é enganado por maiúsculas ou barras extras', async () => {
    await expect(client.get('/Cobranca/LIQUIDAR/')).rejects.toBeInstanceOf(SuperlogicaRotaBloqueadaError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('permite as rotas de leitura e usa sempre GET', async () => {
    fetchMock.mockResolvedValue(respostaOk([{ id_condominio_cond: '24' }]));

    await client.get('condominios/get', { id: -1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('GET');
  });

  it('envia os tokens nos headers', async () => {
    fetchMock.mockResolvedValue(respostaOk([]));

    await client.get('cobranca/index', { idCondominio: 24 });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.app_token).toBe('app-token-falso');
    expect(init.headers.access_token).toBe('access-token-falso');
  });

  it('propaga o motivo do erro da API', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"msg":"Itens por p\\u00e1gina n\\u00e3o pode ser superior a 50."}',
    });

    await expect(client.get('cobranca/index')).rejects.toBeInstanceOf(SuperlogicaHttpError);
  });
});

describe('SuperlogicaClient — datas', () => {
  /**
   * O ERP usa MM/DD/AAAA. Trocar a ordem não dá erro: devolve o mês errado em
   * silêncio, e a sincronização traz o período errado sem ninguém perceber.
   */
  it('formata no padrão americano da Superlógica', () => {
    // 1º de fevereiro de 2026 → 02/01/2026, e não 01/02/2026.
    expect(SuperlogicaClient.formatarData(new Date(2026, 1, 1))).toBe('02/01/2026');
    expect(SuperlogicaClient.formatarData(new Date(2026, 11, 25))).toBe('12/25/2026');
  });

  it('parseia data com hora', () => {
    const data = SuperlogicaClient.parsearData('08/10/2026 00:00:00');
    expect(data?.getFullYear()).toBe(2026);
    expect(data?.getMonth()).toBe(7); // agosto
    expect(data?.getDate()).toBe(10);
  });

  it('trata campo vazio como ausência', () => {
    // O ERP representa "não liquidado" com string vazia, não com null.
    expect(SuperlogicaClient.parsearData('')).toBeNull();
    expect(SuperlogicaClient.parsearData(undefined)).toBeNull();
    expect(SuperlogicaClient.parsearData('sem data')).toBeNull();
  });
});

describe('SuperlogicaClient — paginação', () => {
  let client: SuperlogicaClient;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.SUPERLOGICA_APP_TOKEN = 'x';
    process.env.SUPERLOGICA_ACCESS_TOKEN = 'y';
    client = new SuperlogicaClient();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const pagina = (qtd: number) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(Array.from({ length: qtd }, (_, i) => ({ i }))),
  });

  it('nunca pede mais que 50 itens por página', async () => {
    // Acima de 50 a API responde 400.
    fetchMock.mockResolvedValue(pagina(0));

    await client.getPaginado('unidades/index', { idCondominio: 24 });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('itensPorPagina=50');
  });

  it('busca a próxima página enquanto vierem cheias', async () => {
    fetchMock
      .mockResolvedValueOnce(pagina(50))
      .mockResolvedValueOnce(pagina(50))
      .mockResolvedValueOnce(pagina(7));

    const todos = await client.getPaginado('unidades/index', { idCondominio: 24 });

    expect(todos).toHaveLength(107);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('para na primeira página incompleta', async () => {
    fetchMock.mockResolvedValueOnce(pagina(12));

    const todos = await client.getPaginado('cobranca/index', { idCondominio: 24 });

    expect(todos).toHaveLength(12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
