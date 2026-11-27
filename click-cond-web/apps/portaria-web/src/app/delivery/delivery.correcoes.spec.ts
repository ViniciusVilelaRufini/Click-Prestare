import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ServerClockService } from '../core/server-clock.service';
import { DeliveryAtendimento } from './delivery.model';
import { DeliveryApi } from './delivery.service';
import { DeliveryStore } from './delivery.store';
import { DeliveryApiStub } from './delivery.testing';
import { DeliveryPageComponent } from './delivery-page.component';
import { DeliveryFilaComponent } from './fila/delivery-fila.component';
import { DeliveryTimelineComponent } from './shared/delivery-timeline.component';

const AGORA = new Date('2026-11-27T13:00:00.000Z');
const minAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();

const base = (extra: Partial<DeliveryAtendimento>): DeliveryAtendimento => ({
  id: 50, status: 'CHEGOU', estabelecimento: 'Loja', modo_entrega: 'UNIDADE',
  apartamento: { id: 1, bloco: 'A', apto: '106' }, entregador: null, eventos: [],
  created_at: minAtras(5), ...extra,
});
const ATIVO = { id: 9, nome: 'Zé', telefone: '17999990000', status: 'ATIVO' as const, veiculos: [{ placa: 'TST1C23' }] };
const BLOQ = { ...ATIVO, id: 8, nome: 'Bloq', status: 'BLOQUEADO' as const };

describe('Delivery — correções do teste em produção', () => {
  let api: DeliveryApiStub;
  let store: DeliveryStore;

  function montar(lista: DeliveryAtendimento[], entregadores = [ATIVO, BLOQ] as any[]) {
    TestBed.configureTestingModule({
      imports: [DeliveryFilaComponent],
      providers: [
        DeliveryStore,
        // Relógio do servidor: o do PC pode estar adiantado e não pode vazar.
        { provide: ServerClockService, useValue: { agora: () => new Date(AGORA) } },
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1, turno: 'Síndico' }) } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    });
    api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    api.listAtivos.mockReturnValue(of(lista));
    api.listEntregadores.mockReturnValue(of(entregadores));
    store = TestBed.inject(DeliveryStore);
    store.carregarFila();
    store.carregarEntregadores();
    const fixture = TestBed.createComponent(DeliveryFilaComponent);
    fixture.detectChanges();
    return fixture;
  }
  const botao = (el: HTMLElement, t: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(t)) as HTMLButtonElement;

  it('tempos relativos usam o relógio do servidor e AUTORIZADA diz "Autorizada há", nunca "Subiu"', () => {
    const a = base({ status: 'AUTORIZADA', autorizado_em: minAtras(2), chegou_em: minAtras(4) });
    const fx = montar([a]);
    const txt = fx.nativeElement.textContent as string;
    expect(txt).toContain('Autorizada há 2 min');
    expect(txt).not.toContain('Subiu');
  });

  it('rótulo da unidade, telefone formatado e placa no detalhe', () => {
    const a = base({ entregador: ATIVO as any });
    const fx = montar([a]);
    store.selecionar(a);
    fx.detectChanges();
    const txt = fx.nativeElement.textContent as string;
    expect(txt).toContain('Bloco A · Apto 106');
    expect(txt).not.toContain('Bloco A 106');
    expect(txt).toContain('(17) 99999-0000');
    expect(txt).not.toContain('17999990000');
    expect(fx.nativeElement.querySelector('[data-testid="entregador-placa"]').textContent).toContain('TST1C23');
  });

  it('contagem da aba só considera ativos (não terminais)', () => {
    montar([base({ id: 1 }), base({ id: 2, status: 'RECUSADA' }), base({ id: 3, status: 'CANCELADA' })]);
    expect(store.totalAtivos()).toBe(1);
  });

  it('contagem da aba no cabeçalho da página', () => {
    TestBed.configureTestingModule({
      imports: [DeliveryPageComponent],
      providers: [
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1, turno: 'Síndico' }) } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    });
    (TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub).listAtivos.mockReturnValue(
      of([base({ id: 1 }), base({ id: 2, status: 'RECUSADA' })]));
    const fx = TestBed.createComponent(DeliveryPageComponent);
    fx.detectChanges();
    const aba = Array.from(fx.nativeElement.querySelectorAll('[role="tab"]')).find((b: any) => b.textContent.includes('Fila')) as HTMLElement;
    expect(aba.textContent!.replace(/\s+/g, '')).toBe('Fila1');
  });

  describe('entregador bloqueado / não identificado', () => {
    it('bloqueado: "Pedir autorização" desabilitado com dica', () => {
      const a = base({ entregador: BLOQ as any });
      const fx = montar([a]);
      store.selecionar(a);
      fx.detectChanges();
      const el: HTMLElement = fx.nativeElement;
      expect(botao(el, 'Pedir autorização ao morador').disabled).toBe(true);
      expect(el.querySelector('[data-testid="dica-pedir"]')!.textContent).toContain('Entregador bloqueado: recuse a entrega ou identifique outro entregador.');
    });

    it('bloqueado em CHEGOU mostra só a dica do bloqueio', () => {
      const a = base({ entregador: BLOQ as any });
      const fx = montar([a]);
      store.selecionar(a);
      fx.detectChanges();
      const el: HTMLElement = fx.nativeElement;
      expect(el.querySelector('[data-testid="dica-pedir"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="dica-autorizar"]')).toBeNull();
    });

    it('não identificado: "Autorizar subida" desabilitado com a dica; "Pedir autorização" segue habilitado', () => {
      const a = base({});
      const fx = montar([a]);
      store.selecionar(a);
      fx.detectChanges();
      const el: HTMLElement = fx.nativeElement;
      expect(botao(el, 'Autorizar subida').disabled).toBe(true);
      expect(el.querySelector('[data-testid="dica-autorizar"]')!.textContent).toContain('Identifique um entregador ativo');
      expect(botao(el, 'Pedir autorização ao morador').disabled).toBe(false);
    });

    it('autoatendimento sem entregador cadastrado segue podendo pedir e autorizar', () => {
      const a = base({ origem: 'autoatendimento', pedido_portao: { nome: 'X', status: 'pendente', portao: 'P1' } });
      montar([a]);
      expect(store.podePedirAutorizacao(a)).toBe(true);
      expect(store.podeAutorizar(a)).toBe(true);
    });

    it('store não envia pedido de autorização para bloqueado', () => {
      const a = base({ entregador: BLOQ as any });
      montar([a]);
      store.selecionar(a);
      store.atualizarStatus('AGUARDANDO_AUTORIZACAO');
      expect(api.atualizarStatus).not.toHaveBeenCalled();
      expect(store.erro()).toContain('bloqueado');
    });
  });

  describe('retirada na portaria', () => {
    const naPortaria = () => base({ status: 'RETIRADA_NA_PORTARIA', modo_entrega: 'PORTARIA', entregador: ATIVO as any });

    it('sem nome/relação mostra erro e não envia', () => {
      const a = naPortaria();
      const fx = montar([a]);
      store.selecionar(a);
      fx.detectChanges();
      botao(fx.nativeElement, 'Confirmar retirada').click();
      fx.detectChanges();
      expect(api.atualizarStatus).not.toHaveBeenCalled();
      expect(fx.nativeElement.textContent).toContain('Informe o nome de quem retirou.');
      store.retiradoPor.set('Maria');
      botao(fx.nativeElement, 'Confirmar retirada').click();
      fx.detectChanges();
      expect(api.atualizarStatus).not.toHaveBeenCalled();
      expect(fx.nativeElement.textContent).toContain('Escolha a relação');
    });

    it('envia retirado_por e relacao_retirada com os códigos de Encomendas', () => {
      const a = naPortaria();
      const fx = montar([a]);
      store.selecionar(a);
      fx.detectChanges();
      const opcoes = Array.from(fx.nativeElement.querySelectorAll('select[name="relacaoRetirada"] option')).map((o: any) => o.value);
      expect(opcoes).toEqual(['', 'Morador', 'Familiar', 'Autorizado', 'Funcionario', 'Outro']);
      store.retiradoPor.set(' Maria ');
      store.relacaoRetirada.set('Familiar');
      botao(fx.nativeElement, 'Confirmar retirada').click();
      expect(api.atualizarStatus).toHaveBeenCalledWith(50, 'CONCLUIDA',
        expect.objectContaining({ retirado_por: 'Maria', relacao_retirada: 'Familiar' }));
    });

    it('AUTORIZADA em modo PORTARIA mostra o formulário e envia quem retirou', () => {
      const a = base({ status: 'AUTORIZADA', modo_entrega: 'PORTARIA', autorizado_em: minAtras(1), entregador: ATIVO as any });
      const fx = montar([a]);
      store.selecionar(a);
      fx.detectChanges();
      expect(fx.nativeElement.querySelector('[data-testid="form-retirada"]')).not.toBeNull();
      expect(fx.nativeElement.querySelector('input[name="retiradoPor"]').getAttribute('maxlength')).toBe('120');
      botao(fx.nativeElement, 'Confirmar retirada').click();
      expect(api.atualizarStatus).not.toHaveBeenCalled();
      store.retiradoPor.set('Ana');
      store.relacaoRetirada.set('Outro');
      botao(fx.nativeElement, 'Confirmar retirada').click();
      expect(api.atualizarStatus).toHaveBeenCalledWith(50, 'CONCLUIDA',
        expect.objectContaining({ retirado_por: 'Ana', relacao_retirada: 'Outro' }));
    });

    it('entrega na unidade autorizada conclui sem formulário nem campos de retirada', () => {
      const a = base({ status: 'AUTORIZADA', autorizado_em: minAtras(1), entregador: ATIVO as any });
      const fx = montar([a]);
      store.selecionar(a);
      fx.detectChanges();
      expect(fx.nativeElement.querySelector('[data-testid="form-retirada"]')).toBeNull();
      botao(fx.nativeElement, 'Concluir').click();
      const opts = api.atualizarStatus.mock.calls[0][2] as any;
      expect(opts.retirado_por).toBeUndefined();
      expect(opts.relacao_retirada).toBeUndefined();
    });
  });

  it('depois de concluir, o detalhe mostra os eventos devolvidos pela API', () => {
    const a = base({ status: 'AUTORIZADA', autorizado_em: minAtras(1), entregador: ATIVO as any, eventos: [] });
    const fx = montar([a]);
    store.selecionar(a);
    const evento = { id: 99, status_novo: 'CONCLUIDA' as const, autor_nome: 'Portaria', mensagem: 'Retirado por Ana (Familiar)', created_at: minAtras(0) };
    api.atualizarStatus.mockReturnValueOnce(of({ ...a, status: 'CONCLUIDA', eventos: [evento] } as any));
    api.listAtivos.mockReturnValue(of([]));
    store.atualizarStatus('CONCLUIDA');
    fx.detectChanges();
    expect(store.selecionado()!.eventos).toEqual([evento]);
    expect(fx.nativeElement.textContent).toContain('Retirado por Ana (Familiar)');
  });

  describe('linha do tempo — papel do autor', () => {
    it('mostra nome e papel; sem papel, como antes', () => {
      TestBed.configureTestingModule({ imports: [DeliveryTimelineComponent] });
      const fx = TestBed.createComponent(DeliveryTimelineComponent);
      fx.componentRef.setInput('eventos', [
        { id: 1, status_novo: 'AUTORIZADA', autor_nome: 'Vinicius', autor_papel: 'morador', created_at: '2026-11-27T13:16:00' },
        { id: 2, status_novo: 'CHEGOU', autor_nome: 'Portaria', autor_papel: 'portaria', created_at: '2026-11-27T13:10:00' },
        { id: 3, status_novo: 'AGENDADA', autor_nome: 'Ana', created_at: '2026-11-27T13:00:00' },
      ]);
      fx.detectChanges();
      const txt = fx.nativeElement.textContent as string;
      expect(txt).toContain('Vinicius · Morador · 27/11 13:16');
      expect(txt).toContain('Portaria · 27/11 13:10');
      expect(txt).toContain('Ana · 27/11 13:00');
    });
  });
});
