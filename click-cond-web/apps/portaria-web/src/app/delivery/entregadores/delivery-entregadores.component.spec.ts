import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { DeliveryApi } from '../delivery.service';
import { DeliveryStore } from '../delivery.store';
import { ATENDIMENTOS, DeliveryApiStub } from '../delivery.testing';
import { DeliveryEntregadoresComponent } from './delivery-entregadores.component';

describe('DeliveryEntregadoresComponent', () => {
  function montar(turno: string) {
    TestBed.configureTestingModule({
      imports: [DeliveryEntregadoresComponent],
      providers: [
        DeliveryStore,
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1, turno }) } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    });
    const store = TestBed.inject(DeliveryStore);
    store.entregadores.set([ATENDIMENTOS[0].entregador!]);
    const fixture = TestBed.createComponent(DeliveryEntregadoresComponent);
    fixture.detectChanges();
    return { fixture, store };
  }

  it('host renderiza como bloco para respeitar o espaçamento do casco', () => {
    const { fixture } = montar('Síndico');
    expect(fixture.nativeElement.classList.contains('block')).toBe(true);
  });

  it('lista com selo de bloqueado e formulário de novo cadastro', () => {
    const { fixture } = montar('Síndico');
    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('João Motoboy');
    expect(texto).toContain('Bloqueado');
    expect(texto).toContain('ABC1D23');
    expect(texto).toContain('Novo entregador');
  });

  it('síndico alterna o formulário para edição no mesmo lugar', () => {
    const { fixture, store } = montar('Síndico');
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => b.textContent?.includes('Editar'))!.click();
    fixture.detectChanges();
    expect(store.entregadorEmEdicao()?.id).toBe(20);
    expect(fixture.nativeElement.textContent).toContain('Editar entregador');
    expect(fixture.nativeElement.textContent).not.toContain('Novo entregador');
  });

  it('porteiro não vê edição', () => {
    const { fixture } = montar('Noturno');
    const botoes = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    expect(botoes.some((b) => b.textContent?.includes('Editar'))).toBe(false);
  });

  it('pesquisar mostra o resultado filtrado sem encolher a lista da store', () => {
    const { fixture, store } = montar('Síndico');
    const api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    const outro = { id: 31, nome: 'Maria Moto', status: 'ATIVO' as const, veiculos: [] };
    store.entregadores.set([ATENDIMENTOS[0].entregador!, outro]);
    api.listEntregadores.mockReturnValueOnce(of([outro]));
    fixture.detectChanges();
    const campo: HTMLInputElement = fixture.nativeElement.querySelector('input');
    campo.value = 'mar';
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Maria Moto');
    expect(fixture.nativeElement.textContent).not.toContain('João Motoboy');
    expect(store.entregadores().length).toBe(2);
    fixture.destroy();
    expect(store.entregadoresBusca()).toBeNull();
  });
});
