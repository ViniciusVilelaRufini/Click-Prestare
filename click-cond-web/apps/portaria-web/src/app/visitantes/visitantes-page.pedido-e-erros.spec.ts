import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { VisitantesPageComponent } from './visitantes-page.component';
import { VisitantesService, Pessoa } from './visitantes.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Rodada 3 (Visitantes):
 *  - item 2: pedido a uma unidade sem ninguém para receber — a janela dizia
 *    "o morador foi notificado". Com `avisados: 0` a tela marca o pedido.
 *  - item 4A: a entrada manda o `auth_status` que o modal viu; no 409 (o
 *    morador negou com o modal aberto) a lista e o modal são recarregados.
 *  - item 9: os erros do formulário e dos modais ficavam na página, atrás do
 *    scrim. Agora vão para `erroForm` (gaveta) e `erroModal` (modais).
 */
describe('VisitantesPageComponent — pedido sem aviso e erros dentro do modal', () => {
  let service: any;

  function build(): VisitantesPageComponent {
    service = {
      listarPessoas: jest.fn(() => of([])),
      solicitarAutorizacao: jest.fn(() => of({ ok: true, avisados: 1 })),
      checkIn: jest.fn(() => of({ ok: true })),
      create: jest.fn(() => of({ id: 1000009 })),
      liberar: jest.fn(() => of({ ok: true })),
    };
    TestBed.configureTestingModule({
      imports: [VisitantesPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: VisitantesService, useValue: service },
        { provide: ActivatedRoute, useValue: { data: of({}), queryParams: of({}) } },
        { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
      ],
    });
    return TestBed.createComponent(VisitantesPageComponent).componentInstance;
  }

  const pessoa = (apto: Record<string, unknown> = {}) =>
    ({
      id: 1000004,
      id_pessoa: 2000001,
      nome: 'QA_Pedido',
      totalVisitas: 1,
      liberado: 0,
      data_entrada: null,
      data_saida: null,
      id_apartamento: 106,
      apartamentosVisitados: [
        { id: 106, label: '106/A', visitanteId: 1000004, liberado: false, auth_status: 'pendente', ...apto },
      ],
    }) as unknown as Pessoa;

  describe('item 2 — ninguém avisado', () => {
    it('Solicitar com avisados 0 marca a pessoa como "ninguém avisado"', () => {
      const tela = build();
      service.solicitarAutorizacao.mockReturnValue(of({ ok: true, avisados: 0 }));
      const p = pessoa();
      tela.abrirSolicitar(p);
      tela.confirmarSolicitar();
      expect(tela.pedidoSemAviso()).toBe(2000001);
    });

    it('Solicitar com alguém avisado não marca', () => {
      const tela = build();
      tela.abrirSolicitar(pessoa());
      tela.confirmarSolicitar();
      expect(tela.pedidoSemAviso()).toBeNull();
    });

    it('"Cadastrar e pedir" com avisados 0 também marca', () => {
      const tela = build();
      service.create.mockReturnValue(of({ id: 1000009, avisados: 0 }));
      service.listarPessoas.mockReturnValue(
        of([{ ...pessoa(), id: 1000009, apartamentosVisitados: [{ id: 106, label: '106/A', visitanteId: 1000009 }] }]),
      );
      tela.abrirNovo();
      tela.novo.nome = 'QA_Novo';
      tela.novo.id_apartamento = 106;
      tela.salvar('pedir');
      expect(tela.pedidoSemAviso()).toBe(2000001);
    });

    it('erro do Solicitar aparece no modal do pedido, não na página', () => {
      const tela = build();
      service.solicitarAutorizacao.mockReturnValue(
        throwError(() => ({ status: 409, error: { message: 'O morador já autorizou esta visita. Atualize a lista.' } })),
      );
      tela.abrirSolicitar(pessoa());
      tela.confirmarSolicitar();
      expect(tela.erroModal()).toContain('O morador já autorizou');
      expect(tela.error()).toBeNull();
    });
  });

  describe('item 3 — liberar com o pedido em andamento', () => {
    it('libera a unidade do pedido, não a outra já liberada', () => {
      const tela = build();
      const p = {
        ...pessoa(),
        auth_status: 'pendente',
        apartamentosVisitados: [
          { id: 105, label: '105/A', visitanteId: 1000001, liberado: true, auth_status: null },
          { id: 106, label: '106/A', visitanteId: 1000004, liberado: false, auth_status: 'pendente' },
        ],
      } as unknown as Pessoa;
      tela.liberarAcessoEFechar(p);
      // Manda o estado visto: o morador pode ter negado antes da recarga (revisão I-1).
      expect(service.liberar).toHaveBeenCalledWith(1000004, 106, 'pendente');
    });

    it('409 no liberar (morador negou): erro na janela e a lista recarrega', () => {
      const tela = build();
      service.liberar.mockReturnValue(
        throwError(() => ({ status: 409, error: { message: 'O morador acabou de negar esta entrada.' } })),
      );
      const antes = service.listarPessoas.mock.calls.length;
      tela.liberarAcessoEFechar({ ...pessoa(), auth_status: 'pendente' } as unknown as Pessoa);
      expect(tela.erroModal()).toContain('acabou de negar');
      expect(service.listarPessoas.mock.calls.length).toBeGreaterThan(antes);
    });

    it('Registrar Entrada prefere a unidade do pedido em aberto (revisão M-2)', () => {
      const tela = build();
      tela.registrarEntradaManual({
        ...pessoa(),
        auth_status: 'pendente',
        apartamentosVisitados: [
          { id: 105, label: '105/A', visitanteId: 1000001, liberado: true, auth_status: null },
          { id: 106, label: '106/A', visitanteId: 1000004, liberado: false, auth_status: 'pendente' },
        ],
      } as unknown as Pessoa);
      expect(tela.entradaModalAptoSelecionado()?.id).toBe(106);
    });
  });

  describe('item 4A — entrada sobre pedido desatualizado', () => {
    it('a entrada manda o auth_status que o modal viu', () => {
      const tela = build();
      tela.registrarEntradaManual(pessoa());
      tela.confirmarEntradaModal();
      expect(service.checkIn).toHaveBeenCalledWith(1000004, 106, 'pendente');
    });

    it('409 (morador negou): erro no modal e a lista é recarregada com o estado novo', () => {
      const tela = build();
      service.checkIn.mockReturnValue(
        throwError(() => ({ status: 409, error: { message: 'O morador acabou de negar esta entrada.' } })),
      );
      const negado = pessoa({ auth_status: 'negado' });
      tela.registrarEntradaManual(pessoa());
      service.listarPessoas.mockReturnValue(of([negado]));
      tela.confirmarEntradaModal();
      expect(tela.erroModal()).toContain('acabou de negar');
      expect(tela.error()).toBeNull();
      expect(tela.entradaModalAptoSelecionado()?.auth_status).toBe('negado');
    });
  });

  describe('item 9 — erros dentro da gaveta e dos modais', () => {
    it('validação do cadastro vai para a gaveta', () => {
      const tela = build();
      tela.abrirNovo();
      tela.novo.nome = '';
      tela.salvar();
      expect(tela.erroForm()).toBe('Informe nome e selecione o apartamento.');
      expect(tela.error()).toBeNull();
    });

    it('falha do servidor ao salvar vai para a gaveta', () => {
      const tela = build();
      service.create.mockReturnValue(throwError(() => ({ status: 400, error: { message: 'Documento inválido' } })));
      tela.abrirNovo();
      tela.novo.nome = 'QA';
      tela.novo.id_apartamento = 106;
      tela.salvar();
      expect(tela.erroForm()).toContain('Documento inválido');
      expect(tela.saving()).toBe(false);
    });

    it('janela inválida no modal de entrada aparece no modal', () => {
      const tela = build();
      tela.registrarEntradaManual(pessoa({ auth_status: null, autorizacao_expirada: true }));
      tela.entradaJanelaInicio.set('2026-09-23T12:00');
      tela.entradaJanelaFim.set('2026-09-23T08:00');
      tela.confirmarEntradaModal();
      expect(tela.erroModal()).toContain('janela válida');
      expect(tela.error()).toBeNull();
    });

    it('fechar o modal limpa o erro dele', () => {
      const tela = build();
      tela.registrarEntradaManual(pessoa());
      tela.erroModal.set('x');
      tela.fecharEntradaModal();
      expect(tela.erroModal()).toBeNull();
    });
  });
});
