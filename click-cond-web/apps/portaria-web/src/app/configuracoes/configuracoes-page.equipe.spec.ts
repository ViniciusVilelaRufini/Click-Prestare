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
 * A aba "Equipe da portaria" é do síndico: a API exige typeAccess 'sindico' (assertSindicoEstrito). Porteiro (mesmo
 * com "Síndico" escrito no turno) e funcionário que entrou pelo QR não veem a aba nem disparam a leitura.
 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}

const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });
const FUNCIONARIO = jwt({ sub: 20, nome: 'Func', id_condominio: 1, typeAccess: 'Funcionario' });
const PORTEIRO = jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Síndico', tipo_sub: 'funcionario_portaria' });
const URL_EQUIPE = `${API_BASE}/condominios/1/portaria/equipe`;

describe('ConfiguracoesPageComponent — aba Equipe da portaria', () => {
  let http: HttpTestingController;
  afterEach(() => TestBed.resetTestingModule());

  function render(token: string, turno: string | null) {
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
        { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ConfiguracoesPageComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const aba = (el: HTMLElement) => el.querySelector('button[data-aba-equipe]') as HTMLButtonElement | null;

  it('síndico vê a aba e, ao abrir, a lista é carregada', () => {
    const { fixture, el } = render(SINDICO, 'Síndico');
    expect(aba(el)?.textContent).toContain('Equipe da portaria');
    expect(http.match(URL_EQUIPE)).toHaveLength(0); // só carrega ao abrir a aba
    aba(el)!.click();
    fixture.detectChanges();
    http.expectOne({ method: 'GET', url: URL_EQUIPE }).flush([]);
    fixture.detectChanges();
    expect(el.textContent).toContain('Nenhum login de portaria neste condomínio.');
  });

  it.each([
    ['funcionário do QR', FUNCIONARIO, 'Porteiro (App)'],
    ['porteiro com "Síndico" no turno', PORTEIRO, 'Síndico'],
  ])('%s não vê a aba nem abre a lista mudando a aba à mão', (_n, token, turno) => {
    const { fixture, el } = render(token, turno);
    expect(aba(el)).toBeNull();
    fixture.componentInstance.currentTab.set('equipe');
    fixture.detectChanges();
    expect(el.querySelector('app-equipe-portaria')).toBeNull();
    expect(http.match(URL_EQUIPE)).toHaveLength(0);
  });
});
