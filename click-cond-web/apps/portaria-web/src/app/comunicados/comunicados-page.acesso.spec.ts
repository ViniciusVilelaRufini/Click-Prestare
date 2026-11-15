import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ComunicadosPageComponent } from './comunicados-page.component';
import { ComunicadosApi } from './comunicados.service';
import { AuthService } from '../auth/auth.service';

/**
 * Rodada 4: o funcionário do app que entra no console sem a permissão
 * `comunicados` via Novo/Editar/Excluir e tomava 403. A tela pergunta à API
 * (`comunicados/acesso`) e só mostra os botões com `gerenciar: true`.
 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}

describe('ComunicadosPageComponent — permissão comunicados', () => {
  const funcionario = jwt({ sub: 20, nome: 'Func', id_condominio: 1, typeAccess: 'Funcionario' });
  const porteiro = jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' });

  function render(token: string, acesso: jest.Mock) {
    TestBed.configureTestingModule({
      imports: [ComunicadosPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ComunicadosApi,
          useValue: { list: () => of([{ id: 1, titulo: 'Aviso', descricao: 'Texto', created_at: '2026-10-05T14:30:00' }]), acesso },
        },
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno: 'Diurno', id_condominio: 1 }), token } },
      ],
    });
    const fixture = TestBed.createComponent(ComunicadosPageComponent);
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, comp: fixture.componentInstance };
  }

  afterEach(() => TestBed.resetTestingModule());

  const botoes = (el: HTMLElement) => ({
    novo: Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Novo comunicado')),
    editar: el.querySelector('button[title="Editar"]'),
    excluir: el.querySelector('button[title="Excluir"]'),
  });

  it('funcionário sem a flag: sem Novo, Editar e Excluir (lê os comunicados)', () => {
    const { el, comp } = render(funcionario, jest.fn(() => of({ gerenciar: false })));
    const b = botoes(el);
    expect(b.novo).toBeUndefined();
    expect(b.editar).toBeNull();
    expect(b.excluir).toBeNull();
    expect(el.textContent).toContain('Aviso');
    comp.abrirNovo();
    expect(comp.showForm).toBe(false);
  });

  it('funcionário com a flag: vê os botões', () => {
    const { el } = render(funcionario, jest.fn(() => of({ gerenciar: true })));
    const b = botoes(el);
    expect(b.novo).toBeTruthy();
    expect(b.editar).toBeTruthy();
    expect(b.excluir).toBeTruthy();
  });

  it('porteiro: nem consulta, continua só leitura', () => {
    const acesso = jest.fn(() => of({ gerenciar: true }));
    const { el } = render(porteiro, acesso);
    expect(acesso).not.toHaveBeenCalled();
    expect(botoes(el).novo).toBeUndefined();
  });

  it('consulta falhou: vale o papel (a API decide ao salvar)', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { el } = render(funcionario, jest.fn(() => throwError(() => ({ status: 500 }))));
    expect(botoes(el).novo).toBeTruthy();
  });
});
