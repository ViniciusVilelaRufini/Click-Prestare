import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { DeliveryApi } from '../delivery.service';
import { DeliveryStore } from '../delivery.store';
import { ATENDIMENTOS, DeliveryApiStub } from '../delivery.testing';
import { DeliveryFilaComponent } from './delivery-fila.component';

describe('DeliveryFilaComponent', () => {
  let store: DeliveryStore;

  function montar() {
    TestBed.configureTestingModule({
      imports: [DeliveryFilaComponent],
      providers: [
        DeliveryStore,
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1, turno: 'Síndico' }) } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    });
    store = TestBed.inject(DeliveryStore);
    store.carregarFila();
    const fixture = TestBed.createComponent(DeliveryFilaComponent);
    fixture.detectChanges();
    return fixture;
  }

  const botaoCom = (el: HTMLElement, texto: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(texto)) as HTMLButtonElement;

  it('hosts da fila e do detalhe renderizam como bloco', () => {
    const el: HTMLElement = montar().nativeElement;
    expect(el.classList.contains('block')).toBe(true);
    expect(el.querySelector('app-delivery-detalhe')?.classList.contains('block')).toBe(true);
  });

  it('lista a fila com rótulo amigável, unidade e modo; painel orienta sem seleção', () => {
    const el: HTMLElement = montar().nativeElement;
    expect(el.textContent).toContain('Pizzaria Central');
    expect(el.textContent).toContain('Maria Avulsa');
    expect(el.textContent).toContain('11888887777');
    expect(el.textContent).toContain('Bloco B 202');
    expect(el.textContent).not.toContain('Bloco Bloco');
    expect(el.textContent).toContain('Na portaria');
    expect(el.textContent).toContain('Selecione um atendimento');
  });

  it('card filtra e marca como ativo', () => {
    const fixture = montar();
    const card = botaoCom(fixture.nativeElement, 'Chegou');
    card.click();
    fixture.detectChanges();
    expect(store.filtroStatus()).toBe('CHEGOU');
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.textContent).not.toContain('Mercado');
  });

  it('painel mostra linha do tempo e desabilita autorizar com entregador bloqueado', () => {
    const fixture = montar();
    store.selecionar(ATENDIMENTOS[0]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Porteiro');
    expect(botaoCom(el, 'Autorizar subida').disabled).toBe(true);
    expect(el.textContent).toContain('Identifique um entregador ativo');
  });

  it('recusar abre motivo inline antes de enviar', () => {
    const fixture = montar();
    const api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    store.selecionar(ATENDIMENTOS[0]);
    fixture.detectChanges();
    botaoCom(fixture.nativeElement, 'Recusar').click();
    fixture.detectChanges();
    expect(api.atualizarStatus).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('input[name="motivoRecusa"]')).not.toBeNull();
    store.motivo.set('Pedido errado');
    botaoCom(fixture.nativeElement, 'Confirmar recusa').click();
    expect(api.atualizarStatus).toHaveBeenCalledWith(1, 'RECUSADA', expect.objectContaining({ motivo: 'Pedido errado' }));
  });

  it('trocar de atendimento fecha o formulário de recusa, mesmo se o novo não aceita recusa', () => {
    const fixture = montar();
    store.selecionar(ATENDIMENTOS[0]);
    fixture.detectChanges();
    botaoCom(fixture.nativeElement, 'Recusar').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="motivoRecusa"]')).not.toBeNull();
    store.selecionar({ ...ATENDIMENTOS[1], id: 3, status: 'AUTORIZADA' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="motivoRecusa"]')).toBeNull();
    expect(botaoCom(fixture.nativeElement, 'Confirmar recusa')).toBeUndefined();
    // volta ao primeiro atendimento: o formulário não reaparece sozinho
    store.selecionar(ATENDIMENTOS[0]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="motivoRecusa"]')).toBeNull();
    expect(botaoCom(fixture.nativeElement, 'Recusar entrega')).toBeDefined();
  });

  it('confirmar recusa sem motivo não envia, mostra erro e mantém o formulário aberto; Voltar fecha', () => {
    const fixture = montar();
    const api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    store.selecionar(ATENDIMENTOS[0]);
    fixture.detectChanges();
    botaoCom(fixture.nativeElement, 'Recusar').click();
    fixture.detectChanges();
    botaoCom(fixture.nativeElement, 'Confirmar recusa').click();
    fixture.detectChanges();
    expect(api.atualizarStatus).not.toHaveBeenCalled();
    expect(store.erro()).toBe('Informe o motivo da recusa.');
    expect(fixture.nativeElement.querySelector('input[name="motivoRecusa"]')).not.toBeNull();
    botaoCom(fixture.nativeElement, 'Voltar').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="motivoRecusa"]')).toBeNull();
  });

  it('cabeçalho do painel usa o mesmo texto da lista para o modo de entrega', () => {
    const fixture = montar();
    store.selecionar(ATENDIMENTOS[1]);
    fixture.detectChanges();
    const cabecalho: string = fixture.nativeElement.querySelector('aside header').textContent;
    expect(cabecalho).toContain('Na portaria');
    expect(cabecalho).not.toContain('Deixar na portaria');
    store.selecionar(ATENDIMENTOS[0]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside header').textContent).toContain('Na unidade');
  });

  it('confirmar recusa usa o botao de perigo do tema (texto legivel nos dois temas)', () => {
    const fixture = montar();
    store.selecionar(ATENDIMENTOS[0]);
    fixture.detectChanges();
    botaoCom(fixture.nativeElement, 'Recusar').click();
    fixture.detectChanges();
    expect(botaoCom(fixture.nativeElement, 'Confirmar recusa').classList.contains('ps-btn-danger')).toBe(true);
  });

  it('A2: recusado pelo morador aparece com selo e motivo, sem botões de ação', () => {
    const fixture = montar();
    const recusado = { ...ATENDIMENTOS[0], status: 'RECUSADA' as const, motivo: 'Não pedi nada' };
    store.ativos.set([recusado, ATENDIMENTOS[1]]);
    store.selecionar(recusado);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const painel = el.querySelector('aside') as HTMLElement;
    expect(el.textContent).toContain('Recusada');
    expect(painel.textContent).toContain('Não pedi nada');
    expect(botaoCom(painel, 'Recusar entrega')).toBeUndefined();
    expect(botaoCom(painel, 'Autorizar subida')).toBeUndefined();
  });

  it('B5: aviso agendado mostra a previsão de chegada informada pelo morador', () => {
    const fixture = montar();
    store.ativos.set([{ ...ATENDIMENTOS[1], previsao_em: '2026-09-27T14:30:00' }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Previsto 14:30');
  });

  it('A1: cancelar aviso agendado abre o motivo antes de enviar', () => {
    const fixture = montar();
    const api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    store.selecionar(ATENDIMENTOS[1]);
    fixture.detectChanges();
    botaoCom(fixture.nativeElement, 'Cancelar aviso').click();
    fixture.detectChanges();
    expect(api.atualizarStatus).not.toHaveBeenCalled();
    store.motivo.set('Entregador não apareceu');
    botaoCom(fixture.nativeElement, 'Confirmar cancelamento').click();
    expect(api.atualizarStatus).toHaveBeenCalledWith(2, 'CANCELADA', expect.objectContaining({ motivo: 'Entregador não apareceu' }));
  });

  it('M4: entrega na portaria oferece "Deixar na portaria" como botão principal habilitado', () => {
    const fixture = montar();
    store.selecionar({ ...ATENDIMENTOS[1], status: 'CHEGOU' });
    fixture.detectChanges();
    const principal = botaoCom(fixture.nativeElement.querySelector('aside'), 'Deixar na portaria');
    expect(principal.classList.contains('ps-btn-sec')).toBe(false);
    expect(principal.disabled).toBe(false);
  });

  it('não mostra "Nenhuma entrega na fila" enquanto a primeira carga está em andamento', () => {
    const fixture = montar();
    store.ativos.set([]);
    store.carregando.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Nenhuma entrega na fila');
    store.carregando.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nenhuma entrega na fila');
  });
});
