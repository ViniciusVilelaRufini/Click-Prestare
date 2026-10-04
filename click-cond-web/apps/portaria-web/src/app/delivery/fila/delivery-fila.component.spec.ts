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

  it('lista a fila com rótulo amigável, unidade e modo; painel orienta sem seleção', () => {
    const el: HTMLElement = montar().nativeElement;
    expect(el.textContent).toContain('Pizzaria Central');
    expect(el.textContent).toContain('Maria Avulsa');
    expect(el.textContent).toContain('11888887777');
    expect(el.textContent).toContain('Bloco B 202');
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
});
