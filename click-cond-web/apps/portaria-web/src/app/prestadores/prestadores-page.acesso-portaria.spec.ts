import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { PrestadoresPageComponent } from './prestadores-page.component';
import { PrestadoresApi } from './prestadores.service';
import { VisitantesService } from '../visitantes/visitantes.service';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ConsentimentosApi } from '../core/consentimentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';

/**
 * Criar, mudar e revogar o login de portaria é do síndico (a API recusa o resto, como o app já fazia).
 * O porteiro via a chave "Acesso Portaria Web", criava logins e removia o cadastro de colegas com login.
 * A tela decide pelo papel do token (typeAccess carimbado no login), não pelo `turno`, que é texto livre.
 */

/** JWT de mentira (só o payload importa para a tela). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}

const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });
const PORTEIRO = jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' });
const PORTEIRO_TURNO_SINDICO = jwt({ sub: 4, nome: 'Zé', id_condominio: 1, turno: 'Síndico', tipo_sub: 'funcionario_portaria' });

const comLogin = { id: 1, nome: 'Eletricista', telefone: null, email: 'p@x.com', categorias: '', id_condominio: 1, hasPortariaAccess: true };
const semLogin = { id: 2, nome: 'Jardineiro', telefone: null, email: null, categorias: '', id_condominio: 1, hasPortariaAccess: false };

describe('PrestadoresPageComponent — acesso à portaria só para o síndico', () => {
  function render(token: string, turno: string | null) {
    const api = {
      list: jest.fn(() => of([comLogin, semLogin])),
      create: jest.fn(() => of({ id: 3 })),
      update: jest.fn(() => of({ id: 1 })),
      remove: jest.fn(() => of({ ok: true })),
      clearFoto: jest.fn(),
    };
    TestBed.configureTestingModule({
      imports: [PrestadoresPageComponent],
      providers: [
        provideRouter([]),
        { provide: PrestadoresApi, useValue: api },
        { provide: VisitantesService, useValue: { list: () => of([]), listarPessoas: () => of([]) } },
        { provide: ApartamentosApi, useValue: { list: () => of([]) } },
        { provide: ConsentimentosApi, useValue: { registrarTerceiro: () => of({}) } },
        { provide: ConfirmService, useValue: { ask: jest.fn(async () => true) } },
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno, id_condominio: 1 }), token } },
      ],
    });
    const fixture = TestBed.createComponent(PrestadoresPageComponent);
    fixture.detectChanges();
    // showForm/novo são campos comuns (não signals): sem marcar a view, o zoneless não a refaz.
    const atualizar = () => {
      fixture.componentRef.changeDetectorRef.markForCheck();
      fixture.detectChanges();
    };
    return { atualizar, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, api };
  }

  const temChave = (el: HTMLElement) => (el.textContent ?? '').includes('Acesso Portaria Web');
  const botoesExcluir = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('button')).filter((b) => b.textContent?.includes('Excluir'));

  it('síndico vê a chave "Acesso Portaria Web" no formulário', () => {
    const { atualizar, cmp, el } = render(SINDICO, 'Síndico');
    cmp.abrirNovo();
    atualizar();
    expect(temChave(el)).toBe(true);
  });

  it.each([
    ['porteiro', PORTEIRO, 'Diurno'],
    ['porteiro com turno "Síndico" escrito no cadastro', PORTEIRO_TURNO_SINDICO, 'Síndico'],
  ])('%s não vê a chave "Acesso Portaria Web"', (_n, token, turno) => {
    const { atualizar, cmp, el } = render(token, turno);
    cmp.abrirEditar(comLogin as any);
    atualizar();
    expect(temChave(el)).toBe(false);
  });

  it('porteiro salva a edição sem mandar a chave nem senha (a API não mexe no login)', () => {
    const { atualizar, cmp, api } = render(PORTEIRO, 'Diurno');
    cmp.abrirEditar(comLogin as any);
    atualizar();
    cmp.salvar();
    const enviado = (api.update.mock.calls[0] as any[])[1];
    expect(enviado).not.toHaveProperty('hasPortariaAccess');
    expect(enviado).not.toHaveProperty('senha');
    expect(enviado.nome).toBe('Eletricista');
  });

  it('síndico salva com a chave', () => {
    const { atualizar, cmp, api } = render(SINDICO, 'Síndico');
    cmp.abrirEditar(comLogin as any);
    atualizar();
    cmp.salvar();
    expect((api.update.mock.calls[0] as any[])[1]).toHaveProperty('hasPortariaAccess', true);
  });

  it('porteiro não vê Excluir no prestador que tem login; nos outros, vê', () => {
    const { el } = render(PORTEIRO, 'Diurno');
    expect(botoesExcluir(el)).toHaveLength(1);
  });

  it('síndico vê Excluir em todos', () => {
    const { el } = render(SINDICO, 'Síndico');
    expect(botoesExcluir(el)).toHaveLength(2);
  });

  it('erro ao remover aparece na tela', async () => {
    const { atualizar, cmp, el, api } = render(SINDICO, 'Síndico');
    api.remove.mockReturnValue(throwError(() => ({ error: { message: 'Acesso negado: remover exige síndico.' } })));
    await cmp.remover(semLogin as any);
    atualizar();
    expect(el.textContent).toContain('Acesso negado: remover exige síndico.');
  });
});
