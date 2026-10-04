import { TestBed } from '@angular/core/testing';
import { DeliveryStatusBadgeComponent } from './delivery-status-badge.component';
import { DeliveryTimelineComponent } from './delivery-timeline.component';

describe('componentes compartilhados de delivery', () => {
  it('selo mostra rótulo amigável com a cor do status', () => {
    const fixture = TestBed.createComponent(DeliveryStatusBadgeComponent);
    fixture.componentRef.setInput('status', 'AGUARDANDO_AUTORIZACAO');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent?.trim()).toBe('Aguardando autorização');
    expect(el.querySelector('span')?.className).toContain('text-sky-700');
  });

  it('host da linha do tempo renderiza como bloco', () => {
    const fixture = TestBed.createComponent(DeliveryTimelineComponent);
    expect(fixture.nativeElement.classList.contains('block')).toBe(true);
  });

  it('linha do tempo lista eventos com autor e mensagem; vazio orienta', () => {
    const fixture = TestBed.createComponent(DeliveryTimelineComponent);
    fixture.componentRef.setInput('eventos', [
      { id: 1, status_novo: 'CHEGOU', autor_nome: 'Porteiro', mensagem: 'No portão', created_at: '2026-10-04T12:00:00Z' },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Chegou');
    expect(fixture.nativeElement.textContent).toContain('Porteiro');
    expect(fixture.nativeElement.textContent).toContain('No portão');

    fixture.componentRef.setInput('eventos', []);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sem eventos registrados');
  });
});
