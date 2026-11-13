import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { EncomendasPageComponent } from './encomendas-page.component';
import { Encomenda, EncomendasApi } from './encomendas.service';

/** Ciclos do porteiro nas encomendas (auditoria de 13/11). */
describe('EncomendasPageComponent — ciclos do porteiro', () => {
  const enc = (over: Partial<Encomenda>): Encomenda => ({
    id: 1, descricao: 'Caixa', destinatario_apto: '101', destinatario_bloco: 'A',
    recebido_de: null, recebido_em: '2026-10-05T14:30:00', retirado_em: null, retirado_por: null,
    status: 'Aguardando', ...over,
  });
  const aptos = [{ id: 1, bloco: 'A', apto: '101' }, { id: 2, bloco: 'B', apto: '202' }];
  let api: any;
  let params: BehaviorSubject<Record<string, string>>;
  let confirmar: jest.Mock;

  function montar(lista: Encomenda[]) {
    api = {
      list: jest.fn(() => of(lista)),
      create: jest.fn(() => of({ avisados: 1 })),
      notificar: jest.fn(() => of({ avisados: 1 })),
      retirar: jest.fn((id: number) => of({ ...enc({ id }), status: 'Retirada' })),
      remove: jest.fn(() => of({ ok: true })),
      corrigirUnidade: jest.fn(() => of({ avisados: 1 })),
      receber: jest.fn(() => of({ avisados: 1 })),
    };
    params = new BehaviorSubject<Record<string, string>>({});
    confirmar = jest.fn(async () => true);
    TestBed.configureTestingModule({
      imports: [EncomendasPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParams: params } },
        { provide: EncomendasApi, useValue: api },
        { provide: ApartamentosApi, useValue: { list: () => of(aptos.map((a) => ({ ...a }))) } },
        { provide: ConfirmService, useValue: { ask: confirmar } },
      ],
    });
    const fixture = TestBed.createComponent(EncomendasPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  const botao = (raiz: Element, rotulo: string) =>
    (Array.from(raiz.querySelectorAll('button')) as HTMLButtonElement[]).filter((b) => b.textContent?.trim() === rotulo).pop();
  const modal = (f: ComponentFixture<EncomendasPageComponent>) => f.nativeElement.querySelector('.ps-modal') as HTMLElement;

  // jsdom não desenha canvas: a assinatura vazia basta para os testes.
  beforeEach(() => jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:,'));
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('A5: Confirmar recebimento não duplica', () => {
    it('segundo clique enquanto salva não chama a API de novo e o botão fica desabilitado', () => {
      const f = montar([]);
      const c = f.componentInstance;
      const pendente = new Subject<any>();
      api.create.mockReturnValue(pendente);
      botao(f.nativeElement, 'Receber encomenda')!.click();
      f.detectChanges();
      c.novo.descricao = 'Caixa';
      c.selectedApto = aptos[0] as any;
      c.registrar();
      c.registrar();
      f.detectChanges();
      expect(api.create).toHaveBeenCalledTimes(1);
      expect(botao(f.nativeElement, 'Salvando…')?.disabled).toBe(true);
      pendente.next({ avisados: 1 });
      pendente.complete();
      expect(c.salvando()).toBe(false);
    });

    it('erro do create libera o botão de novo', () => {
      const f = montar([]);
      const c = f.componentInstance;
      api.create.mockReturnValue(throwError(() => ({ error: { message: 'Falhou' } })));
      c.novo.descricao = 'Caixa';
      c.selectedApto = aptos[0] as any;
      c.registrar();
      expect(c.salvando()).toBe(false);
      expect(c.formError()).toBe('Falhou');
    });
  });

  describe('A4: ninguém avisado', () => {
    it('Notificar sem ninguém alcançado mostra "Ninguém foi avisado"', () => {
      const f = montar([enc({ id: 7 })]);
      api.notificar.mockReturnValue(of({ avisados: 0 }));
      f.componentInstance.notificar(f.componentInstance.encomendas()[0]);
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('Ninguém foi avisado');
    });

    it('recebimento sem ninguém alcançado também avisa o porteiro', () => {
      const f = montar([]);
      const c = f.componentInstance;
      api.create.mockReturnValue(of({ avisados: 0 }));
      c.novo.descricao = 'Caixa';
      c.selectedApto = aptos[0] as any;
      c.registrar();
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('Ninguém foi avisado');
    });

    it('cartão estreito mostra Notificar também quando já foi notificada', () => {
      const f = montar([enc({ id: 7, notificado: 1, notificado_em: '2026-10-05T15:00:00' })]);
      const cartoes = f.nativeElement.querySelector('.lg\\:hidden') as HTMLElement;
      expect(botao(cartoes, 'Notificar')).toBeDefined();
    });
  });

  describe('A3/M11: retirada', () => {
    function abrir(f: ComponentFixture<EncomendasPageComponent>) {
      const c = f.componentInstance;
      c.abrirRetirada(c.encomendas()[0]);
      c.retiranteNome = 'Ana';
      f.detectChanges();
    }

    it('erro aparece dentro do modal e o botão volta a funcionar', () => {
      const f = montar([enc({ id: 7 })]);
      abrir(f);
      api.retirar.mockReturnValue(throwError(() => ({ status: 500, error: { message: 'Falha no servidor' } })));
      f.componentInstance.confirmarRetirada();
      f.detectChanges();
      expect(modal(f).textContent).toContain('Falha no servidor');
      expect(f.componentInstance.retirando()).toBe(false);
      expect(botao(modal(f), 'Confirmar Retirada')?.disabled).toBe(false);
    });

    it('Confirmar fica desabilitado durante o envio e o duplo clique não envia duas vezes', () => {
      const f = montar([enc({ id: 7 })]);
      abrir(f);
      const pendente = new Subject<any>();
      api.retirar.mockReturnValue(pendente);
      f.componentInstance.confirmarRetirada();
      f.componentInstance.confirmarRetirada();
      f.detectChanges();
      expect(api.retirar).toHaveBeenCalledTimes(1);
      expect(botao(modal(f), 'Registrando…')?.disabled).toBe(true);
    });

    it('nome vazio mostra o aviso no modal (sem alert)', () => {
      const f = montar([enc({ id: 7 })]);
      const alerta = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
      f.componentInstance.abrirRetirada(f.componentInstance.encomendas()[0]);
      f.componentInstance.confirmarRetirada();
      f.detectChanges();
      expect(alerta).not.toHaveBeenCalled();
      expect(modal(f).textContent).toContain('Nome do retirante é obrigatório.');
    });

    it('409: fecha o modal, recarrega a lista e explica', () => {
      const f = montar([enc({ id: 7 })]);
      abrir(f);
      api.list.mockClear();
      api.retirar.mockReturnValue(throwError(() => ({ status: 409, error: { message: 'Esta encomenda ja foi retirada.' } })));
      f.componentInstance.confirmarRetirada();
      f.detectChanges();
      expect(f.componentInstance.retirandoEncomenda()).toBeNull();
      expect(api.list).toHaveBeenCalled();
      expect(f.nativeElement.textContent).toContain('Esta encomenda ja foi retirada.');
    });

    it('lote pula as já retiradas (409), tira da seleção e termina com resumo', async () => {
      const f = montar([enc({ id: 1 }), enc({ id: 2 }), enc({ id: 3 })]);
      const c = f.componentInstance;
      c.selecionadas.set(new Set([1, 2, 3]));
      c.abrirRetiradaLote();
      c.retiranteNome = 'Ana';
      api.retirar.mockImplementation((id: number) =>
        id === 2 ? throwError(() => ({ status: 409, error: { message: 'já retirada' } })) : of({ ...enc({ id }), status: 'Retirada' }));
      await c.confirmarRetirada();
      f.detectChanges();
      expect(api.retirar).toHaveBeenCalledTimes(3);
      expect(c.selecionadas().size).toBe(0);
      expect(c.isBatchRetirada).toBe(false);
      expect(f.nativeElement.textContent).toContain('2 retiradas, 1 já estava retirada');
    });

    it('lote com erro que não é 409 para, mostra no modal e tira da seleção o que já saiu', async () => {
      const f = montar([enc({ id: 1 }), enc({ id: 2 }), enc({ id: 3 })]);
      const c = f.componentInstance;
      c.selecionadas.set(new Set([1, 2, 3]));
      c.abrirRetiradaLote();
      c.retiranteNome = 'Ana';
      api.retirar.mockImplementation((id: number) =>
        id === 2 ? throwError(() => ({ status: 500, error: { message: 'Falha no servidor' } })) : of({ ...enc({ id }), status: 'Retirada' }));
      await c.confirmarRetirada();
      f.detectChanges();
      expect(api.retirar).toHaveBeenCalledTimes(2);
      expect([...c.selecionadas()]).toEqual([2, 3]);
      expect(modal(f).textContent).toContain('Falha no servidor');
      expect(c.retirando()).toBe(false);
    });

    it('B2: fechar o modal pelo X desliga a câmera', () => {
      const f = montar([enc({ id: 7 })]);
      abrir(f);
      const parar = jest.spyOn(f.componentInstance, 'stopCamera');
      (f.nativeElement.querySelector('[aria-label="Fechar modal"]') as HTMLButtonElement).click();
      expect(parar).toHaveBeenCalled();
      expect(f.componentInstance.retirandoEncomenda()).toBeNull();
    });
  });

  describe('B1: selecionar todas', () => {
    it('com duas unidades, o segundo clique desmarca (não trava)', () => {
      const f = montar([enc({ id: 1 }), enc({ id: 2, destinatario_apto: '202', destinatario_bloco: 'B' }), enc({ id: 3 })]);
      const c = f.componentInstance;
      c.toggleSelecionarTodos();
      expect([...c.selecionadas()].sort()).toEqual([1, 3]);
      expect(c.todasSelecionadas()).toBe(true);
      c.toggleSelecionarTodos();
      expect(c.selecionadas().size).toBe(0);
    });
  });

  it('B3: falha ao remover aparece no banner', async () => {
    const f = montar([enc({ id: 7 })]);
    api.remove.mockReturnValue(throwError(() => ({ error: { message: 'Não foi possível remover' } })));
    await f.componentInstance.remover(f.componentInstance.encomendas()[0]);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Não foi possível remover');
  });

  it('B4: "há 1 dia" conta dias do calendário, não blocos de 24 h', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 13, 8, 0));
    const f = montar([]);
    const e = enc({ recebido_em: new Date(2026, 10, 12, 23, 0).toISOString() });
    expect(f.componentInstance.textoArmazenada(e)).toBe('há 1 dia');
  });

  describe('M7: recarga silenciosa', () => {
    it('mantém página, seleção e modal; tira da seleção o que não está mais aguardando', () => {
      const lista = Array.from({ length: 25 }, (_, i) => enc({ id: i + 1 }));
      const f = montar(lista);
      const c = f.componentInstance;
      c.pagina.set(2);
      c.selecionadas.set(new Set([1, 2]));
      c.abrirRetirada(c.encomendas()[0]);
      api.list.mockReturnValue(of(lista.map((e) => (e.id === 2 ? { ...e, status: 'Retirada' as const } : e))));
      c.recarregarSilencioso();
      expect(c.pagina()).toBe(2);
      expect([...c.selecionadas()]).toEqual([1]);
      expect(c.retirandoEncomenda()?.id).toBe(1);
      expect(c.loading()).toBe(false);
    });

    it('erro na recarga silenciosa não apaga a lista nem mostra banner', () => {
      const f = montar([enc({ id: 7 })]);
      const c = f.componentInstance;
      api.list.mockReturnValue(throwError(() => ({ message: 'offline' })));
      c.recarregarSilencioso();
      expect(c.encomendas().length).toBe(1);
      expect(c.error()).toBeNull();
    });
  });

  it('M8: abre filtrado por status quando a rota pede', () => {
    const f = montar([enc({ id: 1 }), enc({ id: 2, status: 'Retirada' })]);
    params.next({ status: 'Aguardando' });
    expect(f.componentInstance.filtro()).toBe('Aguardando');
  });

  describe('M2: corrigir unidade', () => {
    it('salva a nova unidade, recarrega e mostra se alguém foi avisado', () => {
      const f = montar([enc({ id: 7 })]);
      const c = f.componentInstance;
      c.abrirCorrecao(c.encomendas()[0]);
      c.novaUnidade = aptos[1] as any;
      api.corrigirUnidade.mockReturnValue(of({ avisados: 0 }));
      c.salvarCorrecao();
      f.detectChanges();
      expect(api.corrigirUnidade).toHaveBeenCalledWith(7, { destinatario_apto: '202', destinatario_bloco: 'B' });
      expect(c.corrigindo()).toBeNull();
      expect(f.nativeElement.textContent).toContain('Ninguém foi avisado');
    });

    it('erro fica dentro do formulário de correção', () => {
      const f = montar([enc({ id: 7 })]);
      const c = f.componentInstance;
      c.abrirCorrecao(c.encomendas()[0]);
      c.novaUnidade = aptos[1] as any;
      api.corrigirUnidade.mockReturnValue(throwError(() => ({ error: { message: 'Só é possível corrigir a unidade de encomenda aguardando retirada.' } })));
      c.salvarCorrecao();
      f.detectChanges();
      expect(modal(f).textContent).toContain('Só é possível corrigir');
      expect(c.corrigindo()?.id).toBe(7);
    });

    it('linha de encomenda aguardando tem a ação Corrigir unidade', () => {
      const f = montar([enc({ id: 7 })]);
      expect(f.nativeElement.querySelector('[aria-label="Corrigir unidade"]')).not.toBeNull();
    });
  });
});
