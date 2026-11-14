import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ComunicadosPageComponent } from './comunicados-page.component';
import { ComunicadosApi } from './comunicados.service';
import { AuthService } from '../auth/auth.service';

/**
 * B1: ao publicar, o erro da API (ex.: funcionário do app sem a permissão
 * "comunicados" → 403) ia para o aviso do corpo da página, atrás do scrim e
 * do drawer: o drawer só parava o spinner. Agora aparece dentro do drawer.
 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}

describe('ComunicadosPageComponent — erro ao salvar dentro do drawer', () => {
  function render(create: jest.Mock) {
    TestBed.configureTestingModule({
      imports: [ComunicadosPageComponent],
      providers: [
        provideRouter([]),
        { provide: ComunicadosApi, useValue: { list: () => of([]), create, update: create } },
        {
          provide: AuthService,
          useValue: {
            porteiroInfo: signal({ nome: 'F', turno: 'Porteiro (App)', id_condominio: 1 }),
            token: jwt({ sub: 20, nome: 'Func', id_condominio: 1, typeAccess: 'Funcionario' }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ComunicadosPageComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, comp: fixture.componentInstance };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('403 da API: o drawer fica aberto e mostra a mensagem dentro dele', () => {
    const { fixture, el, comp } = render(
      jest.fn(() => throwError(() => ({ status: 403, error: { message: 'Acesso negado: sem permissão para comunicados.' } }))),
    );
    comp.abrirNovo();
    comp.form = { titulo: 'Piscina', descricao: '' };
    comp.salvar();
    fixture.detectChanges();
    expect(comp.showForm).toBe(true);
    expect(el.querySelector('.ps-drawer')?.textContent).toContain('Acesso negado: sem permissão para comunicados.');
  });

  it('título vazio: o aviso também aparece dentro do drawer', () => {
    const { fixture, el, comp } = render(jest.fn());
    comp.abrirNovo();
    comp.salvar();
    fixture.detectChanges();
    expect(el.querySelector('.ps-drawer')?.textContent).toContain('Título é obrigatório.');
  });

  it('sem mensagem da API: usa a do cliente', () => {
    const { fixture, el, comp } = render(jest.fn(() => throwError(() => ({ message: 'Http failure response' }))));
    comp.abrirNovo();
    comp.form = { titulo: 'Piscina', descricao: '' };
    comp.salvar();
    fixture.detectChanges();
    expect(el.querySelector('.ps-drawer')?.textContent).toContain('Http failure response');
  });
});
