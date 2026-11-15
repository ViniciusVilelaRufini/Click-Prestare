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
 * "Passe na carteira (iPhone)" mora na seção "QR no app" e viaja na mesma rota
 * de opção (`wallet_habilitado`). Só liga com o QR no app ligado (a API
 * responde 400 "Ligue primeiro o QR no app."), e desligar o QR desliga o passe.
 * Ligar pede confirmação com o aviso sobre o código diário e o cancelamento.
 */

const AVISO =
  'O passe na carteira abre sem o app e, no iPhone, até com a tela bloqueada. O código muda uma vez por dia, então é menos seguro que o QR do app: um print vale até o dia seguinte, e uma cópia do passe continua recebendo o código novo até alguém cancelar. Se um morador perder o celular, cancele o passe dele em Moradores.';

const URL_OPCAO = `${API_BASE}/credenciais/condominio/1/opcao`;

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}

const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });
const PORTEIRO = jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Síndico', tipo_sub: 'funcionario_portaria' });

describe('ConfiguracoesPageComponent — Passe na carteira', () => {
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

  const chave = (el: HTMLElement) => el.querySelector('button[data-wallet-switch]') as HTMLButtonElement | null;
  const chaveQr = (el: HTMLElement) => el.querySelector('button[data-qr-app-switch]') as HTMLButtonElement | null;

  async function estabilizar(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function carregar(fixture: { detectChanges(): void }, qr: boolean, wallet: boolean) {
    http.expectOne({ method: 'GET', url: URL_OPCAO }).flush({ qr_app_habilitado: qr, wallet_habilitado: wallet });
    fixture.detectChanges();
  }

  it('síndico vê a chave com o estado vindo da API', () => {
    const { fixture, el } = render(SINDICO);
    carregar(fixture, true, true);
    expect(el.textContent).toContain('Passe na carteira (iPhone)');
    expect(chave(el)?.getAttribute('aria-checked')).toBe('true');
    expect(chave(el)?.disabled).toBe(false);
  });

  it('porteiro não vê a chave', () => {
    const { el } = render(PORTEIRO);
    expect(chave(el)).toBeNull();
    expect(el.textContent).not.toContain('Passe na carteira');
  });

  it('com o QR no app desligado a chave fica desabilitada, desligada e com a dica', () => {
    const { fixture, el } = render(SINDICO);
    carregar(fixture, false, true);
    expect(chave(el)?.disabled).toBe(true);
    expect(chave(el)?.getAttribute('aria-checked')).toBe('false');
    expect(el.textContent).toContain('Ligue primeiro o QR no app.');
  });

  it('ligar pede confirmação com o aviso e só então envia PATCH { wallet_habilitado: true }', async () => {
    let responder!: (ok: boolean) => void;
    const { fixture, el } = render(SINDICO);
    ask.mockImplementation(() => new Promise<boolean>((r) => (responder = r)));
    carregar(fixture, true, false);

    chave(el)!.click();
    await estabilizar(fixture);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0].message).toBe(AVISO);
    expect(http.match({ method: 'PATCH', url: URL_OPCAO })).toHaveLength(0);

    responder(true);
    await estabilizar(fixture);
    const req = http.expectOne({ method: 'PATCH', url: URL_OPCAO });
    expect(req.request.body).toEqual({ wallet_habilitado: true });
    req.flush({ qr_app_habilitado: true, wallet_habilitado: true });
    fixture.detectChanges();
    expect(chave(el)?.getAttribute('aria-checked')).toBe('true');
  });

  it('recusar a confirmação não envia nada', async () => {
    const { fixture, el } = render(SINDICO);
    ask.mockImplementation(() => Promise.resolve(false));
    carregar(fixture, true, false);

    chave(el)!.click();
    await estabilizar(fixture);
    expect(http.match({ method: 'PATCH', url: URL_OPCAO })).toHaveLength(0);
    expect(chave(el)?.getAttribute('aria-checked')).toBe('false');
  });

  it('desligar envia PATCH { wallet_habilitado: false } sem confirmação', async () => {
    const { fixture, el } = render(SINDICO);
    carregar(fixture, true, true);

    chave(el)!.click();
    await estabilizar(fixture);
    expect(ask).not.toHaveBeenCalled();
    const req = http.expectOne({ method: 'PATCH', url: URL_OPCAO });
    expect(req.request.body).toEqual({ wallet_habilitado: false });
    req.flush({ qr_app_habilitado: true, wallet_habilitado: false });
    fixture.detectChanges();
    expect(chave(el)?.getAttribute('aria-checked')).toBe('false');
  });

  it('erro do servidor volta a chave e mostra a mensagem do servidor', async () => {
    const { fixture, el } = render(SINDICO);
    carregar(fixture, true, false);

    chave(el)!.click();
    await estabilizar(fixture);
    http
      .expectOne({ method: 'PATCH', url: URL_OPCAO })
      .flush({ message: 'Ligue primeiro o QR no app.' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(chave(el)?.getAttribute('aria-checked')).toBe('false');
    expect(el.querySelector('[data-wallet-erro]')?.textContent).toContain('Ligue primeiro o QR no app.');
  });

  it('desligar o QR no app mostra o passe desligado também', async () => {
    const { fixture, el } = render(SINDICO);
    carregar(fixture, true, true);

    chaveQr(el)!.click();
    await estabilizar(fixture);
    const req = http.expectOne({ method: 'PATCH', url: URL_OPCAO });
    expect(req.request.body).toEqual({ qr_app_habilitado: false });
    req.flush({ qr_app_habilitado: false, wallet_habilitado: false });
    fixture.detectChanges();
    expect(chave(el)?.getAttribute('aria-checked')).toBe('false');
    expect(chave(el)?.disabled).toBe(true);
  });
});
