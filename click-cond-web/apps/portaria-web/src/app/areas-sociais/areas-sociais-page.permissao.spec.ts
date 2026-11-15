import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AreasSociaisPageComponent } from './areas-sociais-page.component';
import { AreaSocial, AreasSociaisApi } from './areas-sociais.service';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';

/**
 * Decisão do dono (rodada 4): o porteiro do console agenda, aprova, recusa,
 * cancela e confirma reserva, mas não cria, edita nem exclui espaço — a API
 * recusa com assertStaff. A tela decide pelo papel do token (typeAccess
 * carimbado no login), como em comunicados; o `turno` é texto livre.
 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}

const AREA: AreaSocial = { id: 30, nome: 'Salão', imagem: '', exige_confirmacao: 0 } as AreaSocial;

function render(token: string | null) {
  TestBed.configureTestingModule({
    imports: [AreasSociaisPageComponent],
    providers: [
      {
        provide: AreasSociaisApi,
        useValue: { listAreas: jest.fn(() => of([AREA])), listAgendamentos: jest.fn(() => of([])) },
      },
      { provide: ApartamentosApi, useValue: { list: jest.fn(() => of([])) } },
      { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
      { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno: 'Diurno', id_condominio: 1 }), token } },
    ],
  });
  const f = TestBed.createComponent(AreasSociaisPageComponent);
  f.detectChanges();
  return { el: f.nativeElement as HTMLElement, tela: f.componentInstance };
}

const botao = (el: HTMLElement, texto: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === texto);

describe('AreasSociaisPageComponent — quem gerencia o espaço', () => {
  it('porteiro: vê Agendar, mas não Cadastrar Espaço, Editar nem a lixeira', () => {
    const { el, tela } = render(jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' }));
    expect(tela.podeGerirEspacos()).toBe(false);
    expect(botao(el, 'Agendar')).toBeTruthy();
    expect(botao(el, 'Cadastrar Espaço')).toBeUndefined();
    expect(botao(el, 'Editar')).toBeUndefined();
    expect(el.querySelector('button[title="Excluir Espaço"]')).toBeNull();
  });

  it('porteiro com turno "Síndico" no cadastro continua sem os botões', () => {
    const { el } = render(jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Síndico', tipo_sub: 'funcionario_portaria' }));
    expect(botao(el, 'Cadastrar Espaço')).toBeUndefined();
  });

  it('síndico: vê Cadastrar Espaço, Editar e a lixeira', () => {
    const { el } = render(jwt({ sub: 7, nome: 'Ana', id_condominio: 1, typeAccess: 'Sindico' }));
    expect(botao(el, 'Cadastrar Espaço')).toBeTruthy();
    expect(botao(el, 'Editar')).toBeTruthy();
    expect(el.querySelector('button[title="Excluir Espaço"]')).toBeTruthy();
  });

  it('funcionário no console (typeAccess Funcionario): vê os botões; a flag a API confere', () => {
    const { el } = render(jwt({ sub: 20, nome: 'Func', id_condominio: 1, typeAccess: 'Funcionario' }));
    expect(botao(el, 'Cadastrar Espaço')).toBeTruthy();
  });
});
