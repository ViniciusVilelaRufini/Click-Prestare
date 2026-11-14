import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ApartamentosPageComponent } from './apartamentos-page.component';
import { ApartamentosApi } from './apartamentos.service';
import { VagasApi } from './vagas.service';
import { MoradoresApi } from '../moradores/moradores.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';

const APTO = { id: 10, apto: '101', bloco: 'A', qtd_vagas: 0, qtdMoradores: 0 } as any;

/** JWT sem assinatura, só com o payload que a tela lê (papelDoToken). */
function tokenCom(payload: object): string {
  const b64 = btoa(JSON.stringify(payload)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `x.${b64}.y`;
}

function build(opts: { token?: string | null; apiApartamentos?: Record<string, unknown>; moradoresApi?: Record<string, unknown> } = {}) {
  const apiApartamentos = { list: jest.fn(() => of([APTO])), remove: jest.fn(() => of({ success: true })), ...opts.apiApartamentos };
  const moradoresApi = { create: jest.fn(() => of({ id: 1 })), ...opts.moradoresApi };
  TestBed.configureTestingModule({
    imports: [ApartamentosPageComponent],
    providers: [
      { provide: ApartamentosApi, useValue: apiApartamentos },
      { provide: VagasApi, useValue: {} },
      { provide: MoradoresApi, useValue: moradoresApi },
      { provide: HttpClient, useValue: { get: jest.fn(() => of([])) } },
      { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
      { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1, turno: 'Manhã' }), token: opts.token ?? null } },
    ],
  });
  const f = TestBed.createComponent(ApartamentosPageComponent);
  f.detectChanges();
  return { f, tela: f.componentInstance, el: f.nativeElement as HTMLElement, apiApartamentos, moradoresApi };
}

describe('ApartamentosPageComponent — cadastro de unidade e de morador', () => {
  describe('M7: botões de gerenciar unidade seguem a regra da API (assertStaff)', () => {
    it('porteiro de login/senha (token sem typeAccess) não vê Importar, Cadastrar, Editar nem Excluir', () => {
      const { el } = build({ token: tokenCom({ sub: 3, id_condominio: 1, turno: 'Manhã' }) });
      expect(el.textContent).not.toContain('Importar Excel');
      expect(el.textContent).not.toContain('Cadastrar apartamento');
      expect(el.querySelector('button[title="Editar apartamento"]')).toBeNull();
      expect(el.querySelector('button[title="Excluir apartamento"]')).toBeNull();
    });

    it('síndico vê os botões', () => {
      const { f, tela, el } = build({ token: tokenCom({ sub: 3, typeAccess: 'Sindico' }) });
      tela.viewMode.set('tabela');
      f.detectChanges();
      expect(el.textContent).toContain('Importar Excel');
      expect(el.textContent).toContain('Cadastrar apartamento');
      expect(el.querySelector('button[title="Excluir apartamento"]')).toBeTruthy();
    });
  });

  it('M6: excluir que a API recusa mostra a explicação', async () => {
    const { f, tela, el } = build({
      token: tokenCom({ typeAccess: 'Sindico' }),
      apiApartamentos: {
        remove: jest.fn(() => throwError(() => ({ error: { message: 'Este apartamento tem 2 visita(s) no histórico e não pode ser removido.' } }))),
      },
    });
    await tela.remover(APTO);
    f.detectChanges();
    expect(el.textContent).toContain('tem 2 visita(s) no histórico');
  });

  describe('M2: "Adicionar morador" no painel da unidade', () => {
    it('com e-mail e sem nascimento, avisa sem chamar a API', () => {
      const { tela, moradoresApi } = build();
      tela.moradoresApto = APTO;
      tela.novoMorador = { ...tela.novoMorador, nome: 'Maria Souza', email: 'maria@x.com' };
      tela.salvarNovoMorador();
      expect(moradoresApi.create).not.toHaveBeenCalled();
      expect(tela.errorMorador()).toContain('data de nascimento');
    });

    it('com e-mail e nascimento, manda a data em ISO e pede o envio do acesso', () => {
      const { tela, moradoresApi } = build();
      tela.moradoresApto = APTO;
      tela.novoMorador = { ...tela.novoMorador, nome: 'Maria Souza', email: 'maria@x.com', data_nascimento: '19/04/1980' };
      tela.salvarNovoMorador();
      expect(moradoresApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'maria@x.com', data_nascimento: '1980-04-19', sendCredentials: true, id_apartamento: 10 }),
      );
    });

    it('sem e-mail e sem nascimento, cadastra sem pedir credenciais', () => {
      const { tela, moradoresApi } = build();
      tela.moradoresApto = APTO;
      tela.novoMorador = { ...tela.novoMorador, nome: 'Maria Souza' };
      tela.salvarNovoMorador();
      expect(moradoresApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: undefined, data_nascimento: undefined, sendCredentials: false }),
      );
    });
  });
});
