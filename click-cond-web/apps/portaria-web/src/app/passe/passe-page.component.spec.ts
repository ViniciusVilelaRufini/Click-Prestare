import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import qrcode from 'qrcode-generator';
import { PassePageComponent } from './passe-page.component';
import { API_BASE } from '../shared/api.config';
import { ThemeService } from '../shared/theme.service';
import { appRoutes } from '../app.routes';

/**
 * Página que o VISITANTE abre pelo link do passe. Mostra o QR do código
 * dinâmico, que a API troca a cada 30 s, e nada além do que o visitante
 * precisa: primeiro nome, condomínio, unidade e validade.
 *
 * Tempo controlado pelo relógio falso do Jest (o ambiente de teste é sem zone,
 * então não há fakeAsync); a página usa só setTimeout/setInterval e Date.now.
 */

const TOKEN = 'b5.QUJDREVGR0g';
const URL_PASSE = `${API_BASE}/passes/publico/${TOKEN}`;

const CODIGO_1 = 'P1AAAAAAIDQRCMABTQCSPWDO5F3Q';
const CODIGO_2 = 'P1AAAAAAIDQRCMDS3DSX2WSX2IVM';

function resposta(codigo: string, troca_em_s: number) {
  return {
    nome: 'Joana',
    condominio: 'Residencial Demo',
    unidade: 'Apartamento 101 · Bloco A',
    valido_de: '2026-11-14T12:00:00.000Z',
    valido_ate: '2026-11-14T22:00:00.000Z',
    codigo,
    troca_em_s,
  };
}

/** O mesmo desenho que a página deve fazer: módulos escuros do QR em SVG. */
function caminhoEsperado(codigo: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(codigo, 'Alphanumeric');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + 4},${r + 4}h1v1h-1z`;
    }
  }
  return d;
}

let visibilidade: DocumentVisibilityState = 'visible';

function mudarVisibilidade(estado: DocumentVisibilityState) {
  visibilidade = estado;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('PassePageComponent — passe público do visitante', () => {
  let fixture: ComponentFixture<PassePageComponent>;
  let http: HttpTestingController;

  beforeAll(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilidade,
    });
  });

  beforeEach(() => {
    visibilidade = 'visible';
    jest.useFakeTimers().setSystemTime(new Date('2026-11-14T15:00:05.000Z'));
  });

  afterEach(() => {
    fixture?.destroy();
    http?.verify();
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  function montar(params: Record<string, string> = { token: TOKEN }, query: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      imports: [PassePageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap(params), queryParamMap: convertToParamMap(query) },
          },
        },
        { provide: ThemeService, useValue: { isLight: signal(false) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PassePageComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const desenhado = (el: HTMLElement) =>
    el.querySelector('svg[data-qr-passe] path')?.getAttribute('d') ?? null;

  function avancar(ms: number) {
    jest.advanceTimersByTime(ms);
    fixture.detectChanges();
  }

  function responder(corpo: unknown) {
    http.expectOne(URL_PASSE).flush(corpo);
    fixture.detectChanges();
  }

  it('desenha o QR com o código recebido e mostra nome, condomínio e unidade', () => {
    const el = montar();
    responder(resposta(CODIGO_1, 25));

    expect(desenhado(el)).toBe(caminhoEsperado(CODIGO_1));
    const texto = el.textContent ?? '';
    expect(texto).toContain('Joana');
    expect(texto).toContain('Residencial Demo');
    expect(texto).toContain('Apartamento 101 · Bloco A');
    expect(texto).toContain('Novo código em 25 s');
    // O código vai só no QR; em texto viraria algo fácil de copiar e repassar.
    expect(texto).not.toContain(CODIGO_1);
  });

  it('o QR fica em fundo branco com margem e pelo menos 240 px, também no tema escuro', () => {
    const el = montar();
    responder(resposta(CODIGO_1, 25));
    const moldura = el.querySelector('[data-qr-moldura]') as HTMLElement;
    expect(moldura.style.background).toMatch(/#fff|rgb\(255, 255, 255\)/);
    expect(moldura.style.minWidth).toBe('240px');
    const svg = el.querySelector('svg[data-qr-passe]') as SVGElement;
    const qr = qrcode(0, 'M');
    qr.addData(CODIGO_1, 'Alphanumeric');
    qr.make();
    const lado = qr.getModuleCount() + 8; // 4 módulos de margem de cada lado
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${lado} ${lado}`);
  });

  it('busca de novo quando a contagem chega a zero', () => {
    const el = montar();
    responder(resposta(CODIGO_1, 7));

    avancar(6_999);
    http.expectNone(URL_PASSE);
    expect(el.textContent).toContain('Novo código em 1 s');

    avancar(1);
    responder(resposta(CODIGO_2, 30));
    expect(desenhado(el)).toBe(caminhoEsperado(CODIGO_2));
  });

  it('sem chegar a zero, busca de novo a cada 25 s, não antes', () => {
    montar();
    responder(resposta(CODIGO_1, 30));

    avancar(24_999);
    http.expectNone(URL_PASSE);
    avancar(1);
    responder(resposta(CODIGO_1, 5));
  });

  it('busca imediatamente ao voltar ao primeiro plano (Review Focus 5)', () => {
    const el = montar();
    responder(resposta(CODIGO_1, 30));

    mudarVisibilidade('hidden');
    avancar(10_000);
    http.expectNone(URL_PASSE);

    // O navegador pausou os temporizadores por muito tempo: o relógio andou
    // sem o setTimeout disparar. Ao voltar, o QR velho não pode reaparecer.
    jest.setSystemTime(Date.now() + 5 * 60_000);
    mudarVisibilidade('visible');
    fixture.detectChanges();
    expect(desenhado(el)).toBeNull();

    responder(resposta(CODIGO_2, 12));
    expect(desenhado(el)).toBe(caminhoEsperado(CODIGO_2));
  });

  it('voltar ao primeiro plano com uma busca em andamento não dispara outra', () => {
    montar();
    mudarVisibilidade('hidden');
    mudarVisibilidade('visible');
    responder(resposta(CODIGO_1, 30));
    http.expectNone(URL_PASSE);
  });

  it('404 mostra "Passe indisponível" e não busca mais', () => {
    const el = montar();
    responder(resposta(CODIGO_1, 3));
    avancar(3_000);
    http.expectOne(URL_PASSE).flush({ message: 'Passe indisponível.' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(el.textContent).toContain('Passe indisponível');
    expect(desenhado(el)).toBeNull();

    avancar(5 * 60_000);
    mudarVisibilidade('hidden');
    mudarVisibilidade('visible');
    http.expectNone(URL_PASSE);
  });

  it('link sem token mostra "Passe indisponível" sem chamar a API', () => {
    const el = montar({}, {});
    http.expectNone(() => true);
    expect(el.textContent).toContain('Passe indisponível');
  });

  it('sem rede, esconde o QR depois de 30 s do último código', () => {
    const el = montar();
    responder(resposta(CODIGO_1, 30));

    avancar(25_000);
    http.expectOne(URL_PASSE).error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(el.textContent).toContain('Sem conexão. Tentando de novo…');
    expect(desenhado(el)).toBe(caminhoEsperado(CODIGO_1));

    // Nova tentativa 5 s depois; ainda dentro dos 30 s do último código.
    avancar(5_000);
    http.expectOne(URL_PASSE).error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(desenhado(el)).toBe(caminhoEsperado(CODIGO_1));

    avancar(1_000);
    expect(desenhado(el)).toBeNull();
    expect(el.textContent).toContain('Sem conexão. Tentando de novo…');

    // A conexão volta: o QR reaparece com o código novo.
    avancar(4_000);
    responder(resposta(CODIGO_2, 30));
    expect(desenhado(el)).toBe(caminhoEsperado(CODIGO_2));
    expect(el.textContent).not.toContain('Sem conexão');
  });

  it('não faz requisição para nenhum host além de API_BASE', () => {
    const el = montar();
    responder(resposta(CODIGO_1, 2));
    avancar(2_000);
    responder(resposta(CODIGO_2, 30));

    const outras = http.match((req) => !req.url.startsWith(`${API_BASE}/`));
    expect(outras).toHaveLength(0);
    // Nem imagem nem link para fora: o token está na URL desta página.
    el.querySelectorAll('img').forEach((img) => expect(img.getAttribute('src')).toMatch(/^\//));
    el.querySelectorAll('a[href]').forEach((a) => expect(a.getAttribute('href')).toMatch(/^\/(?!\/)/));
  });

  it('pede ao navegador para não mandar a URL (com o token) como referer', () => {
    montar();
    responder(resposta(CODIGO_1, 30));
    const meta = document.head.querySelector('meta[name="referrer"]');
    expect(meta?.getAttribute('content')).toBe('no-referrer');
  });

  it('para de buscar ao sair da página', () => {
    montar();
    responder(resposta(CODIGO_1, 5));
    fixture.destroy();
    jest.advanceTimersByTime(60_000);
    mudarVisibilidade('hidden');
    mudarVisibilidade('visible');
    http.expectNone(URL_PASSE);
  });
});

describe('PassePageComponent — rotas públicas', () => {
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
    const component = await harness.navigateByUrl(url, PassePageComponent);
    return { component, http };
  }

  it('abre o passe pela raiz com ?passe= (o Amplify não serve caminho profundo)', async () => {
    const { component, http } = await navegar(`/?passe=${TOKEN}`);
    http.expectOne(URL_PASSE).flush(resposta(CODIGO_1, 30));
    expect(component).toBeInstanceOf(PassePageComponent);
  });

  it('abre o passe por /passe/:token', async () => {
    const { component, http } = await navegar(`/passe/${TOKEN}`);
    http.expectOne(URL_PASSE).flush(resposta(CODIGO_1, 30));
    expect(component).toBeInstanceOf(PassePageComponent);
  });
});
