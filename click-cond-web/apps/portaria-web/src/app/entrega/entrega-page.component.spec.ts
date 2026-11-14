import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { EntregaPageComponent, dimensoesReduzidas } from './entrega-page.component';
import { API_BASE } from '../shared/api.config';
import { ThemeService } from '../shared/theme.service';
import { appRoutes } from '../app.routes';

/**
 * Página que o ENTREGADOR abre ao ler o QR colado no portão. Sem conta.
 * Escolhe a unidade (só bloco e apartamento), informa o nome, tira uma selfie
 * e acompanha a resposta do morador; liberado, abre o portão por aqui.
 *
 * Tempo pelo relógio falso do Jest (ambiente sem zone).
 */

const PORTAO = 'f'.repeat(48);
const PEDIDO = 'c'.repeat(64);
const CHAVE = `prestare.entrega.${PORTAO}`;
const FOTO = 'data:image/jpeg;base64,/9j/AAAA';

const URL_PORTAO = `${API_BASE}/entrega/publico/${PORTAO}`;
const URL_CONSULTA = `${API_BASE}/entrega/publico/${PORTAO}/pedido`;
const URL_ABRIR = `${API_BASE}/entrega/publico/${PORTAO}/pedido/abrir`;
const URL_SAIR = `${API_BASE}/entrega/publico/${PORTAO}/pedido/sair`;

const PORTAO_OK = {
  condominio: 'Residencial Demo',
  portao: 'Portão social',
  disponivel: true,
  unidades: [
    { id: 11, bloco: 'A', apto: '101' },
    { id: 12, bloco: 'A', apto: '102' },
    { id: 21, bloco: 'B', apto: '101' },
  ],
};

function estado(situacao: string, extra: Record<string, unknown> = {}) {
  return { situacao, pode_abrir: false, pode_sair: false, liberado_ate: null, falha_abertura: false, ...extra };
}

let visibilidade: DocumentVisibilityState = 'visible';

describe('EntregaPageComponent — página do entregador no portão', () => {
  let fixture: ComponentFixture<EntregaPageComponent>;
  let http: HttpTestingController;

  beforeAll(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilidade });
  });

  beforeEach(() => {
    visibilidade = 'visible';
    sessionStorage.clear();
    jest.useFakeTimers().setSystemTime(new Date('2026-11-14T15:00:00.000Z'));
  });

  afterEach(() => {
    fixture?.destroy();
    http?.verify();
    TestBed.resetTestingModule();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function montar(params: Record<string, string> = { token: PORTAO }, query: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      imports: [EntregaPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(params), queryParamMap: convertToParamMap(query) } },
        },
        { provide: ThemeService, useValue: { isLight: signal(false) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EntregaPageComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const texto = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const botao = (rotulo: string) =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === rotulo,
    ) as HTMLButtonElement | undefined;

  function render() {
    fixture.detectChanges();
  }

  function avancar(ms: number) {
    jest.advanceTimersByTime(ms);
    render();
  }

  function responderPortao(corpo: unknown = PORTAO_OK) {
    http.expectOne({ method: 'GET', url: URL_PORTAO }).flush(corpo);
    render();
  }

  function responderConsulta(corpo: unknown) {
    const req = http.expectOne({ method: 'POST', url: URL_CONSULTA });
    expect(req.request.body).toEqual({ pedido: PEDIDO });
    req.flush(corpo);
    render();
  }

  /** Preenche o formulário como o entregador faria (a foto entra já reduzida). */
  function preencher() {
    const c = fixture.componentInstance;
    c.escolherBloco('A');
    c.idApartamento.set(12);
    c.nome.set('Carlos');
    c.plataforma.set('iFood');
    c.foto.set(FOTO);
    render();
  }

  function enviar(resposta: unknown = { ...estado('aguardando'), pedido: PEDIDO }) {
    botao('Pedir entrada')!.click();
    const req = http.expectOne({ method: 'POST', url: URL_PORTAO });
    req.flush(resposta);
    render();
    return req;
  }

  // ---------------------------------------------------------------- portão

  it('mostra o mesmo indicador de carregando do convite enquanto busca o portão', () => {
    const el = montar();
    expect(el.querySelector('.animate-spin')).toBeTruthy();
    responderPortao();
  });

  it('token inválido (404): "Este QR não vale mais. Procure a portaria."', () => {
    montar();
    http.expectOne(URL_PORTAO).flush({ message: 'QR de entregas indisponível.' }, { status: 404, statusText: 'Not Found' });
    render();
    expect(texto()).toContain('Este QR não vale mais. Procure a portaria.');
    expect(botao('Pedir entrada')).toBeUndefined();
  });

  it('sem token não chama a API e mostra a mesma tela', () => {
    montar({}, {});
    http.expectNone(() => true);
    expect(texto()).toContain('Este QR não vale mais. Procure a portaria.');
  });

  it('lê o token de ?entrega= (o link que a API gera)', () => {
    montar({}, { entrega: PORTAO });
    responderPortao();
    expect(texto()).toContain('Portão social');
  });

  it('opção desligada: avisa e não mostra o formulário', () => {
    montar();
    responderPortao({ condominio: 'Residencial Demo', portao: 'Portão social', disponivel: false, motivo: 'desligado', unidades: [] });
    expect(texto()).toContain('O autoatendimento de entregas está desligado. Procure a portaria.');
    expect(botao('Pedir entrada')).toBeUndefined();
  });

  it('fora do horário: mostra o horário configurado', () => {
    montar();
    responderPortao({
      condominio: 'Residencial Demo', portao: 'Portão social', disponivel: false, motivo: 'fora_horario',
      horario: { inicio: '07:00', fim: '22:00' }, unidades: [],
    });
    expect(texto()).toContain('O autoatendimento de entregas funciona das 07:00 às 22:00.');
    expect(botao('Pedir entrada')).toBeUndefined();
  });

  // ---------------------------------------------------------------- formulário

  it('formulário: condomínio e portão no topo, bloco e apartamento, nome, plataforma, foto e o aviso', () => {
    const el = montar();
    responderPortao();
    expect(texto()).toContain('Residencial Demo');
    expect(texto()).toContain('Portão social');
    expect(texto()).toContain('Sua foto será mostrada ao morador e guardada pelo condomínio por 90 dias.');

    const blocos = Array.from(el.querySelectorAll('select[name="bloco"] option')).map((o) => o.textContent?.trim());
    expect(blocos).toEqual(expect.arrayContaining(['A', 'B']));
    fixture.componentInstance.escolherBloco('A');
    render();
    const aptos = Array.from(el.querySelectorAll('select[name="apto"] option')).map((o) => o.textContent?.trim()).filter(Boolean);
    expect(aptos).toEqual(expect.arrayContaining(['101', '102']));
    expect(aptos).toHaveLength(3); // "Apartamento" + 101 + 102 do bloco A

    const plataformas = Array.from(el.querySelectorAll('select[name="plataforma"] option')).map((o) => o.textContent?.trim());
    expect(plataformas).toEqual(expect.arrayContaining(['iFood', 'Mercado Livre', 'Outra']));

    const arquivo = el.querySelector('input[type="file"]') as HTMLInputElement;
    expect(arquivo.getAttribute('capture')).toBe('user');
    expect(arquivo.getAttribute('accept')).toBe('image/*');
    expect(botao('Tirar foto') ?? el.querySelector('[data-tirar-foto]')).toBeTruthy();
  });

  it('"Pedir entrada" fica desabilitado até haver unidade, nome e foto; sem foto não envia', () => {
    montar();
    responderPortao();
    const c = fixture.componentInstance;
    expect(botao('Pedir entrada')!.disabled).toBe(true);
    c.escolherBloco('A');
    c.idApartamento.set(12);
    c.nome.set('Carlos');
    render();
    expect(botao('Pedir entrada')!.disabled).toBe(true);
    c.enviar();
    http.expectNone({ method: 'POST', url: URL_PORTAO });
    c.foto.set(FOTO);
    render();
    expect(botao('Pedir entrada')!.disabled).toBe(false);
  });

  it('o envio manda exatamente { id_apartamento, nome, plataforma, foto } e guarda o pedido nesta aba', () => {
    montar();
    responderPortao();
    preencher();
    const req = enviar();
    expect(req.request.body).toEqual({ id_apartamento: 12, nome: 'Carlos', plataforma: 'iFood', foto: FOTO });
    expect(sessionStorage.getItem(CHAVE)).toBe(PEDIDO);
    expect(texto()).toContain('Aguardando o morador');
  });

  it.each([
    [409, 'Já há uma entrega aguardando esta unidade. Tente em alguns minutos.'],
    [429, 'Esta unidade já recusou uma entrega há pouco. Procure a portaria.'],
    [400, 'Foto muito grande. Tente novamente.'],
  ])('erro %s no envio mostra a mensagem da API e mantém o formulário', (status, mensagem) => {
    montar();
    responderPortao();
    preencher();
    botao('Pedir entrada')!.click();
    http.expectOne({ method: 'POST', url: URL_PORTAO }).flush({ message: mensagem }, { status, statusText: 'x' });
    render();
    expect(texto()).toContain(mensagem);
    expect(botao('Pedir entrada')).toBeTruthy();
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
  });

  // ---------------------------------------------------------------- acompanhamento

  it.each([
    ['aguardando', {}, 'Aguardando o morador'],
    ['sem_resposta', {}, 'Procure a portaria ou use o interfone.'],
    ['liberado', { pode_abrir: true }, 'Liberado'],
    ['aberto', {}, 'Portão aberto. Pode entrar.'],
    ['liberado_portaria', {}, 'Liberado pela portaria. Aguarde a abertura.'],
    ['vou_buscar', {}, 'O morador vai buscar na portaria'],
    ['recusado', {}, 'Não autorizado'],
    ['expirado', {}, 'O pedido expirou.'],
  ])('situação %s mostra o texto certo', (situacao, extra, esperado) => {
    montar();
    responderPortao();
    preencher();
    enviar();
    avancar(3_000);
    responderConsulta(estado(situacao, extra));
    expect(texto()).toContain(esperado);
    if (situacao === 'sem_resposta') expect(texto()).toContain('Sem resposta');
  });

  it('consulta a cada 3 s com o pedido no corpo; sem resposta continua consultando', () => {
    montar();
    responderPortao();
    preencher();
    enviar();
    avancar(2_999);
    http.expectNone({ method: 'POST', url: URL_CONSULTA });
    avancar(1);
    responderConsulta(estado('sem_resposta'));
    avancar(3_000);
    responderConsulta(estado('sem_resposta'));
  });

  it.each(['vou_buscar', 'recusado', 'expirado'])('situação final %s para de consultar e apaga o pedido da aba', (situacao) => {
    montar();
    responderPortao();
    preencher();
    enviar();
    avancar(3_000);
    responderConsulta(estado(situacao));
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
    avancar(60_000);
    http.expectNone({ method: 'POST', url: URL_CONSULTA });
  });

  it('aberto sem saída para de consultar; aberto com saída continua', () => {
    montar();
    responderPortao();
    preencher();
    enviar();
    avancar(3_000);
    responderConsulta(estado('aberto', { pode_sair: true }));
    expect(botao('Abrir para sair')).toBeTruthy();
    avancar(3_000);
    responderConsulta(estado('aberto', { pode_sair: false }));
    expect(botao('Abrir para sair')).toBeUndefined();
    avancar(60_000);
    http.expectNone({ method: 'POST', url: URL_CONSULTA });
  });

  it('"Abrir portão" manda o pedido; abriu false mostra a falha e o botão continua enquanto pode_abrir', () => {
    montar();
    responderPortao();
    preencher();
    enviar({ ...estado('liberado', { pode_abrir: true }), pedido: PEDIDO });
    botao('Abrir portão')!.click();
    const req = http.expectOne({ method: 'POST', url: URL_ABRIR });
    expect(req.request.body).toEqual({ pedido: PEDIDO });
    req.flush({ ...estado('liberado', { pode_abrir: true }), abriu: false });
    render();
    expect(texto()).toContain('Não foi possível abrir, procure a portaria');
    expect(botao('Abrir portão')).toBeTruthy();

    botao('Abrir portão')!.click();
    http.expectOne({ method: 'POST', url: URL_ABRIR }).flush({ ...estado('aberto', { pode_sair: true }), abriu: true });
    render();
    expect(texto()).toContain('Portão aberto. Pode entrar.');
    expect(texto()).not.toContain('Não foi possível abrir');
    expect(botao('Abrir portão')).toBeUndefined();
  });

  it('falha_abertura na consulta mostra a falha', () => {
    montar();
    responderPortao();
    preencher();
    enviar();
    avancar(3_000);
    responderConsulta(estado('liberado', { pode_abrir: true, falha_abertura: true }));
    expect(texto()).toContain('Não foi possível abrir, procure a portaria');
    expect(botao('Abrir portão')).toBeTruthy();
  });

  it('"Abrir para sair" manda o pedido para a rota de saída', () => {
    montar();
    responderPortao();
    preencher();
    enviar({ ...estado('aberto', { pode_sair: true }), pedido: PEDIDO });
    botao('Abrir para sair')!.click();
    const req = http.expectOne({ method: 'POST', url: URL_SAIR });
    expect(req.request.body).toEqual({ pedido: PEDIDO });
    req.flush({ ...estado('aberto', { pode_sair: false }), abriu: true });
    render();
    expect(botao('Abrir para sair')).toBeUndefined();
  });

  it('429 ao abrir mostra a mensagem do servidor', () => {
    montar();
    responderPortao();
    preencher();
    enviar({ ...estado('liberado', { pode_abrir: true }), pedido: PEDIDO });
    botao('Abrir portão')!.click();
    http.expectOne(URL_ABRIR).flush({ message: 'ThrottlerException: Too Many Requests' }, { status: 429, statusText: 'x' });
    render();
    expect(texto()).toContain('ThrottlerException: Too Many Requests');
  });

  it('"Tentar de novo" depois de expirar volta ao formulário com os dados', () => {
    montar();
    responderPortao();
    preencher();
    enviar();
    avancar(3_000);
    responderConsulta(estado('expirado'));
    botao('Tentar de novo')!.click();
    render();
    expect(botao('Pedir entrada')).toBeTruthy();
    expect(botao('Pedir entrada')!.disabled).toBe(false);
  });

  it('a página nunca mostra dado de morador (a API não manda; nada além do pedido aparece)', () => {
    montar();
    responderPortao();
    preencher();
    enviar();
    expect(texto()).not.toMatch(/morador:\s*\w/i);
    expect(fixture.nativeElement.querySelectorAll('img[src^="http"]').length).toBe(0);
  });

  // ---------------------------------------------------------------- retomada

  it('retoma o pedido guardado nesta aba sem mostrar o formulário', () => {
    sessionStorage.setItem(CHAVE, PEDIDO);
    montar();
    responderPortao();
    expect(botao('Pedir entrada')).toBeUndefined();
    responderConsulta(estado('aguardando'));
    expect(texto()).toContain('Aguardando o morador');
    expect(botao('Pedir entrada')).toBeUndefined();
  });

  it('pedido guardado que não existe mais (404) é apagado e o formulário aparece', () => {
    sessionStorage.setItem(CHAVE, PEDIDO);
    montar();
    responderPortao();
    http.expectOne(URL_CONSULTA).flush({ message: 'Pedido não encontrado.' }, { status: 404, statusText: 'x' });
    render();
    expect(sessionStorage.getItem(CHAVE)).toBeNull();
    expect(botao('Pedir entrada')).toBeTruthy();
  });

  it('sessionStorage que lança não derruba a página', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    montar();
    responderPortao();
    preencher();
    enviar();
    expect(texto()).toContain('Aguardando o morador');
  });

  it('volta ao primeiro plano: consulta na hora', () => {
    montar();
    responderPortao();
    preencher();
    enviar();
    visibilidade = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    visibilidade = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    responderConsulta(estado('aguardando'));
  });

  it('para de consultar ao sair da página', () => {
    montar();
    responderPortao();
    preencher();
    enviar();
    fixture.destroy();
    jest.advanceTimersByTime(60_000);
    http.expectNone({ method: 'POST', url: URL_CONSULTA });
  });

  it('sem rede, avisa e continua tentando', () => {
    montar();
    responderPortao();
    preencher();
    enviar();
    avancar(3_000);
    http.expectOne(URL_CONSULTA).error(new ProgressEvent('error'));
    render();
    expect(texto()).toContain('Sem conexão. Tentando de novo…');
    avancar(5_000);
    responderConsulta(estado('aguardando'));
    expect(texto()).not.toContain('Sem conexão');
  });
});

describe('dimensoesReduzidas', () => {
  it('lado maior até 800 px, mantendo a proporção; foto pequena não cresce', () => {
    expect(dimensoesReduzidas(4000, 3000)).toEqual({ largura: 800, altura: 600 });
    expect(dimensoesReduzidas(1080, 1920)).toEqual({ largura: 450, altura: 800 });
    expect(dimensoesReduzidas(640, 480)).toEqual({ largura: 640, altura: 480 });
  });
});

describe('EntregaPageComponent — rotas públicas', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function navegar(url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(appRoutes),
        { provide: ThemeService, useValue: { isLight: signal(false) } },
      ],
    });
    const harness = await RouterTestingHarness.create();
    const http = TestBed.inject(HttpTestingController);
    const component = await harness.navigateByUrl(url, EntregaPageComponent);
    return { component, http };
  }

  it('abre pela raiz com ?entrega= (o link do QR impresso)', async () => {
    const { component, http } = await navegar(`/?entrega=${PORTAO}`);
    http.expectOne(URL_PORTAO).flush(PORTAO_OK);
    expect(component).toBeInstanceOf(EntregaPageComponent);
  });

  it('abre por /entrega/:token', async () => {
    const { component, http } = await navegar(`/entrega/${PORTAO}`);
    http.expectOne(URL_PORTAO).flush(PORTAO_OK);
    expect(component).toBeInstanceOf(EntregaPageComponent);
  });
});
