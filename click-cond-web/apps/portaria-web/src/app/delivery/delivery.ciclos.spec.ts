import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { DeliveryApi } from './delivery.service';
import { DeliveryStore } from './delivery.store';
import { ATENDIMENTOS, DeliveryApiStub } from './delivery.testing';
import { DeliveryFilaComponent } from './fila/delivery-fila.component';
import { textoEspera } from './shared/tempo';

/**
 * Ciclos do delivery:
 *  - pedido de autorização que ninguém recebe (avisados 0): a tela manda interfonar;
 *  - a recarga de 20 s não apaga o erro da ação (ex.: entregador bloqueado, 409);
 *  - a previsão de outro dia mostra a data;
 *  - espera de dias aparece em dias, não "há 1104 h".
 */
describe('Delivery — ciclos', () => {
  let store: DeliveryStore;
  let api: DeliveryApiStub;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DeliveryStore,
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1, nome: 'Portaria', turno: 'Diurno' }) } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    });
    store = TestBed.inject(DeliveryStore);
    api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    store.carregarFila();
  });

  it('pedido de autorização sem ninguém para receber: aviso para interfonar', () => {
    const a = { ...ATENDIMENTOS[0], entregador: null };
    store.selecionar(a);
    api.atualizarStatus.mockReturnValueOnce(of({ ...a, status: 'AGUARDANDO_AUTORIZACAO', avisados: 0 } as any));
    store.atualizarStatus('AGUARDANDO_AUTORIZACAO');
    expect(store.aviso()).toContain('interfone');
    expect(store.aviso()).toContain('Bloco A 101');
  });

  it('pedido com alguém para receber: sem aviso', () => {
    const a = { ...ATENDIMENTOS[0], entregador: null };
    store.selecionar(a);
    api.atualizarStatus.mockReturnValueOnce(of({ ...a, status: 'AGUARDANDO_AUTORIZACAO', avisados: 2 } as any));
    store.atualizarStatus('AGUARDANDO_AUTORIZACAO');
    expect(store.aviso()).toBeNull();
  });

  it('a recarga silenciosa não apaga o erro da ação', () => {
    store.selecionar(ATENDIMENTOS[0]);
    api.atualizarStatus.mockReturnValueOnce(throwError(() => ({ status: 409, error: { message: 'Entregador bloqueado não pode ser autorizado.' } })));
    store.atualizarStatus('RETIRADA_NA_PORTARIA');
    expect(store.erro()).toBe('Entregador bloqueado não pode ser autorizado.');
    store.carregarFila({ silencioso: true });
    expect(store.erro()).toBe('Entregador bloqueado não pode ser autorizado.');
  });

  it('a recarga silenciosa que volta a funcionar apaga o erro da própria recarga', () => {
    api.listAtivos.mockReturnValueOnce(throwError(() => ({ status: 0, message: 'Sem conexão' })));
    store.carregarFila({ silencioso: true });
    expect(store.erro()).toBe('Sem conexão');
    store.carregarFila({ silencioso: true });
    expect(store.erro()).toBeNull();
  });

  it('espera de mais de 48 h aparece em dias', () => {
    expect(textoEspera(47 * 60)).toBe('há 47 h 00 min');
    expect(textoEspera(48 * 60)).toBe('há 2 dias');
    expect(textoEspera(1104 * 60)).toBe('há 46 dias');
  });

  it('previsão de outro dia mostra a data; a de hoje, só a hora', () => {
    const fixture = TestBed.createComponent(DeliveryFilaComponent);
    const comp = fixture.componentInstance;
    store.agora.set(new Date(2026, 10, 14, 10, 0));
    expect(comp.formatoPrevisao(new Date(2026, 10, 14, 19, 0).toISOString())).toBe('HH:mm');
    expect(comp.formatoPrevisao(new Date(2026, 10, 15, 19, 0).toISOString())).toBe('dd/MM HH:mm');
  });
});
