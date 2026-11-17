import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ClienteDrawerComponent } from './cliente-drawer.component';
import { CrmApi } from '../crm.service';
import { CrmStore } from '../crm.store';
import { ToastService } from '../../shared/toast.service';

/**
 * Condomínio sem síndico: o drawer oferece "Vincular síndico". Conta nova devolve a senha única;
 * 409 de substituição pergunta antes de reenviar com substituirAtual.
 */
describe('ClienteDrawerComponent: vincular síndico', () => {
  function montar(vincular: jest.Mock, contatoPrincipal: any = null) {
    const api = { vincularSindico: vincular };
    const toast = { trigger: jest.fn() };
    const store = {
      clienteSelecionado: signal<any>({
        id: 1, nome: 'Cond Teste', identificacao: null, ativo: true, estagio: 'ativo', plano: null, mrr: 0,
        vencimento: null, diasParaVencer: null, healthScore: 0, riscoChurn: { nivel: 'baixo', score: 0, motivos: [] }, totalApartamentos: 0, totalMoradores: 0,
        contatoPrincipal,
      }),
      clientes: signal<any[]>([]),
      salvando: signal(false),
      abrirCliente: jest.fn(),
      fecharCliente: jest.fn(),
      carregar: jest.fn(),
      dbHealth: signal<any>(null),
      waLink: jest.fn(() => ''),
    };
    TestBed.configureTestingModule({
      imports: [ClienteDrawerComponent],
      providers: [
        provideRouter([]),
        { provide: CrmApi, useValue: api },
        { provide: CrmStore, useValue: store },
        { provide: ToastService, useValue: toast },
      ],
    });
    const fixture = TestBed.createComponent(ClienteDrawerComponent);
    return { fixture, comp: fixture.componentInstance, api, toast, store };
  }

  function preencher(comp: ClienteDrawerComponent) {
    comp.abrirVincularSindico();
    comp.formVincularSindico = { nome: 'Ana', email: 'Ana@X.com', telefone: '', documento: '' };
  }

  it('estado vazio mostra o botão "Vincular síndico"', () => {
    const { fixture } = montar(jest.fn());
    fixture.detectChanges();
    const textos = Array.from(fixture.nativeElement.querySelectorAll('button')).map((b: any) =>
      (b.textContent ?? '').trim(),
    );
    expect(textos).toContain('Vincular síndico');
  });

  it('resposta com senhaSindico abre o painel de senha única', () => {
    const { comp, api, store } = montar(jest.fn(() => of({ id_user: 7, contaExistente: false, senhaSindico: 'abc123' })));
    preencher(comp);
    comp.vincularSindico();

    expect(api.vincularSindico).toHaveBeenCalledWith(1, { nome: 'Ana', email: 'Ana@X.com', telefone: undefined, documento: undefined });
    expect(comp.modalVincularSindico()).toBe(false);
    expect(comp.modalSenhaSindico()).toBe(true);
    expect(comp.senhaSindicoNova()).toEqual({ login: 'ana@x.com', senha: 'abc123' });
    expect(store.carregar).toHaveBeenCalled();
  });

  it('conta existente: sem painel de senha', () => {
    const { comp } = montar(jest.fn(() => of({ id_user: 7, contaExistente: true })));
    preencher(comp);
    comp.vincularSindico();
    expect(comp.modalSenhaSindico()).toBe(false);
    expect(comp.senhaSindicoNova()).toBeNull();
  });

  it('409 de substituição pergunta e reenvia com substituirAtual', () => {
    const vincular = jest
      .fn()
      .mockReturnValueOnce(
        throwError(() => ({
          status: 409,
          error: { message: 'Este condomínio já tem síndico (Beto). Confirme a substituição.' },
        })),
      )
      .mockReturnValueOnce(of({ id_user: 7, contaExistente: true, anteriorRemovido: { id_user: 5, nome: 'Beto' } }));
    const { comp } = montar(vincular);
    preencher(comp);
    comp.vincularSindico();

    expect(comp.substituirSindicoNome()).toBe('Beto');
    expect(comp.modalVincularSindico()).toBe(true);

    comp.vincularSindico(true);
    expect(vincular).toHaveBeenLastCalledWith(1, expect.objectContaining({ substituirAtual: true }));
    expect(comp.modalVincularSindico()).toBe(false);
  });

  it('outro erro aparece no diálogo', () => {
    const { comp } = montar(
      jest.fn(() => throwError(() => ({ status: 409, error: { message: 'Essa pessoa já é síndica deste condomínio.' } }))),
    );
    preencher(comp);
    comp.vincularSindico();
    expect(comp.erroVincularSindico()).toBe('Essa pessoa já é síndica deste condomínio.');
  });
  it('síndico presente: botão "Trocar síndico" abre o mesmo modal e a troca confirma com o código estruturado', () => {
    const vincular = jest
      .fn()
      .mockReturnValueOnce(
        throwError(() => ({
          status: 409,
          error: { message: 'texto qualquer', code: 'SINDICO_EXISTENTE', nomeAtual: 'Beto' },
        })),
      )
      .mockReturnValueOnce(of({ id_user: 7, contaExistente: false, senhaSindico: 'x1y2z3' }));
    const { fixture, comp } = montar(vincular, { nome: 'Beto', email: 'b@x.com', telefone: null, papel: 'Síndico' });
    fixture.detectChanges();
    const botoes: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
    const trocar = botoes.find((b) => (b.textContent ?? '').trim() === 'Trocar síndico');
    expect(trocar).toBeTruthy();
    trocar!.click();
    expect(comp.modalVincularSindico()).toBe(true);

    comp.formVincularSindico = { nome: 'Ana', email: 'ana@x.com', telefone: '', documento: '' };
    comp.vincularSindico();
    expect(comp.substituirSindicoNome()).toBe('Beto');
    comp.vincularSindico(true);
    expect(vincular).toHaveBeenLastCalledWith(1, expect.objectContaining({ substituirAtual: true }));
  });

  it('conta existente: o aviso mostra o nome da conta ligada', () => {
    const { comp, toast } = montar(jest.fn(() => of({ id_user: 7, contaExistente: true, nomeConta: 'Ana Souza' })));
    preencher(comp);
    comp.vincularSindico();
    expect(toast.trigger).toHaveBeenCalledWith(
      'Síndico vinculado: Ana Souza. A senha continua a mesma.',
      'success',
    );
  });

  it('salvar edição com erro mostra a mensagem do servidor', () => {
    const { comp, toast, api } = montar(jest.fn());
    (api as any).atualizar = jest.fn(() =>
      throwError(() => ({ status: 422, error: { message: 'Este condomínio ainda não tem síndico.' } })),
    );
    comp.iniciarEdicao();
    comp.salvarEdicao();
    expect(toast.trigger).toHaveBeenCalledWith('Este condomínio ainda não tem síndico.', 'error');
  });
});
