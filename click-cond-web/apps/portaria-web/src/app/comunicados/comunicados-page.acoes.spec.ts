import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ComunicadosPageComponent } from './comunicados-page.component';
import { ComunicadosApi } from './comunicados.service';
import { AuthService } from '../auth/auth.service';

/**
 * Editar/Excluir ficavam com opacity-0 até o hover: em tela de toque ficavam
 * invisíveis. Agora os dois botões ficam sempre visíveis — para o síndico.
 *
 * Publicar, editar e excluir comunicado é do síndico e do funcionário do app
 * (a API recusa o porteiro com assertStaff): o porteiro via Novo/Editar/Excluir
 * e tomava 403. A tela decide pelo papel do token (typeAccess carimbado no
 * login), não pelo `turno`, que é texto livre do cadastro do porteiro.
 */

/** JWT de mentira (só o payload importa para a tela). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}
describe('ComunicadosPageComponent — botões Novo/Editar/Excluir', () => {
  function render(turno: string | null, token: string | null = null) {
    TestBed.configureTestingModule({
      imports: [ComunicadosPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ComunicadosApi,
          useValue: {
            list: () => of([{ id: 1, titulo: 'Aviso', descricao: 'Texto', created_at: '2026-10-05T14:30:00' }]),
          },
        },
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno, id_condominio: 1 }), token } },
      ],
    });
    const fixture = TestBed.createComponent(ComunicadosPageComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const novo = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Novo comunicado'));

  it('síndico: Editar e Excluir existem e não estão escondidos por opacity-0', () => {
    const el = render('Síndico', jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' }));
    const editar = el.querySelector('button[title="Editar"]') as HTMLElement;
    const excluir = el.querySelector('button[title="Excluir"]') as HTMLElement;
    expect(editar).toBeTruthy();
    expect(excluir).toBeTruthy();
    expect(novo(el)).toBeTruthy();
    for (const b of [editar, excluir]) {
      expect(b.classList.contains('opacity-0')).toBe(false);
      expect(b.className).not.toContain('group-hover:opacity-100');
    }
  });

  it('funcionário no console por QR (typeAccess Funcionario): vê os botões', () => {
    const el = render('Porteiro (App)', jwt({ sub: 20, nome: 'Func', id_condominio: 1, typeAccess: 'Funcionario' }));
    expect(novo(el)).toBeTruthy();
    expect(el.querySelector('button[title="Editar"]')).toBeTruthy();
  });

  it('porteiro com turno "Síndico" escrito no cadastro: continua sem os botões', () => {
    const el = render('Síndico', jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Síndico', tipo_sub: 'funcionario_portaria' }));
    expect(novo(el)).toBeUndefined();
    expect(el.querySelector('button[title="Editar"]')).toBeNull();
  });

  it('porteiro: sem Novo comunicado, Editar e Excluir', () => {
    const el = render('Diurno', jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' }));
    expect(el.querySelector('button[title="Editar"]')).toBeNull();
    expect(el.querySelector('button[title="Excluir"]')).toBeNull();
    expect(novo(el)).toBeUndefined();
    expect(el.textContent).toContain('Aviso');
  });
});
