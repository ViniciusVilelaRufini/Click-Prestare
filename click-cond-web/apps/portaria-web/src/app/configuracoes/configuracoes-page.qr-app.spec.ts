import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { ConfiguracoesPageComponent } from './configuracoes-page.component';
import { AuthService } from '../auth/auth.service';
import { ConfirmService } from '../shared/confirm.service';
import { API_BASE } from '../shared/api.config';

/**
 * "QR no app" (credencial por QR dinâmico) é liga/desliga por condomínio e só
 * o síndico mexe: a API recusa os outros com 403 (assertSindicoEstrito, pelo
 * typeAccess do token). Ligar muda o acesso físico — o PIN do visitante deixa
 * de abrir quando mostrado como QR —, então pede confirmação com o aviso;
 * desligar volta ao que era, sem perguntar.
 */

const AVISO =
  'O QR depende da internet do condomínio. Antes de ligar, confirme que todo morador sem rosto cadastrado tem tag ou que há porteiro. Com a opção ligada, o PIN do visitante deixa de abrir quando mostrado como QR no leitor; continua valendo digitado na portaria.';

const URL_OPCAO = `${API_BASE}/credenciais/condominio/1/opcao`;

/** JWT de mentira (só o payload importa para a tela). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}

const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });
const FUNCIONARIO = jwt({ sub: 20, nome: 'Func', id_condominio: 1, typeAccess: 'Funcionario' });
const PORTEIRO = jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Síndico', tipo_sub: 'funcionario_portaria' });

describe('ConfiguracoesPageComponent — QR no app', () => {
  let http: HttpTestingController;
  let ask: jest.Mock;

  afterEach(() => TestBed.resetTestingModule());

  function render(token: string, turno: string | null = 'Síndico') {
    ask = jest.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      imports: [ConfiguracoesPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            porteiroInfo: signal({ nome: 'Ana', turno, id_condominio: 1 }),
            condominioNome: signal('Residencial Demo'),
            token,
            alterarSenha: jest.fn(),
          },
        },
        { provide: ConfirmService, useValue: { ask } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ConfiguracoesPageComponent);
    fixture.detectChanges();
    fixture.componentInstance.currentTab.set('regras');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el };
  }

  const chave = (el: HTMLElement) => el.querySelector('button[data-qr-app-switch]') as HTMLButtonElement | null;
  const opcao = () => http.match((r) => r.url === URL_OPCAO);

  async function estabilizar(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function carregar(fixture: { detectChanges(): void }, valor: boolean) {
    const req = http.expectOne({ method: 'GET', url: URL_OPCAO });
    req.flush({ qr_app_habilitado: valor });
    fixture.detectChanges();
  }

  it('síndico vê a seção com o estado atual vindo da API', () => {
    const { fixture, el } = render(SINDICO);
    carregar(fixture, true);
    expect(el.textContent).toContain('QR no app');
    expect(chave(el)?.getAttribute('aria-checked')).toBe('true');
  });

  it.each([
    ['funcionário do app', FUNCIONARIO, 'Porteiro (App)'],
    ['porteiro com "Síndico" escrito no turno', PORTEIRO, 'Síndico'],
  ])('%s não vê a seção e a tela nem pergunta a opção', (_n, token, turno) => {
    const { el } = render(token, turno);
    expect(opcao()).toHaveLength(0);
    expect(chave(el)).toBeNull();
    expect(el.textContent).not.toContain('QR no app');
  });

  it('ligar pede confirmação com o aviso e só então envia PATCH true', async () => {
    let responder!: (ok: boolean) => void;
    const { fixture, el } = render(SINDICO);
    ask.mockImplementation(() => new Promise<boolean>((r) => (responder = r)));
    carregar(fixture, false);

    chave(el)!.click();
    await estabilizar(fixture);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0].message).toBe(AVISO);
    expect(http.match({ method: 'PATCH', url: URL_OPCAO })).toHaveLength(0);

    responder(true);
    await estabilizar(fixture);
    const req = http.expectOne({ method: 'PATCH', url: URL_OPCAO });
    expect(req.request.body).toEqual({ qr_app_habilitado: true });
    req.flush({ qr_app_habilitado: true });
    fixture.detectChanges();
    expect(chave(el)?.getAttribute('aria-checked')).toBe('true');
  });

  it('cancelar a confirmação não envia nada e mantém desligado', async () => {
    const { fixture, el } = render(SINDICO);
    ask.mockImplementation(() => Promise.resolve(false));
    carregar(fixture, false);

    chave(el)!.click();
    await estabilizar(fixture);
    expect(http.match({ method: 'PATCH', url: URL_OPCAO })).toHaveLength(0);
    expect(chave(el)?.getAttribute('aria-checked')).toBe('false');
  });

  it('desligar envia PATCH false sem confirmação', async () => {
    const { fixture, el } = render(SINDICO);
    carregar(fixture, true);

    chave(el)!.click();
    await estabilizar(fixture);
    expect(ask).not.toHaveBeenCalled();
    const req = http.expectOne({ method: 'PATCH', url: URL_OPCAO });
    expect(req.request.body).toEqual({ qr_app_habilitado: false });
    req.flush({ qr_app_habilitado: false });
    fixture.detectChanges();
    expect(chave(el)?.getAttribute('aria-checked')).toBe('false');
  });

  it('erro do servidor volta o controle ao estado anterior e mostra o motivo', async () => {
    const { fixture, el } = render(SINDICO);
    carregar(fixture, true);

    chave(el)!.click();
    await estabilizar(fixture);
    http
      .expectOne({ method: 'PATCH', url: URL_OPCAO })
      .flush({ message: 'Acesso negado: alterar o QR no app exige síndico.' }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(chave(el)?.getAttribute('aria-checked')).toBe('true');
    expect(el.textContent).toContain('Acesso negado: alterar o QR no app exige síndico.');
  });

  it('erro do servidor ao ligar também volta para desligado', async () => {
    const { fixture, el } = render(SINDICO);
    carregar(fixture, false);

    chave(el)!.click();
    await estabilizar(fixture);
    http.expectOne({ method: 'PATCH', url: URL_OPCAO }).flush({}, { status: 500, statusText: 'Erro' });
    fixture.detectChanges();
    expect(chave(el)?.getAttribute('aria-checked')).toBe('false');
  });

  it('sem conseguir ler a opção, o controle fica indisponível em vez de chutar um estado', () => {
    const { fixture, el } = render(SINDICO);
    http.expectOne({ method: 'GET', url: URL_OPCAO }).flush({}, { status: 500, statusText: 'Erro' });
    fixture.detectChanges();
    expect(chave(el)?.disabled).toBe(true);
    expect(el.textContent).toContain('Não foi possível carregar');
  });
});
