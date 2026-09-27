import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { appRoutes } from '../app.routes';
import { SidebarComponent } from '../shell/sidebar.component';
import { AuthService } from '../auth/auth.service';
import { ThemeService } from '../shared/theme.service';
import { DeliveryApi, DeliveryAtendimento, DeliveryEntregador } from './delivery.service';
import { DeliveryPageComponent } from './delivery-page.component';

const atendimentos: DeliveryAtendimento[] = [
  {
    id: 1,
    status: 'CHEGOU',
    estabelecimento: 'Pizzaria Central',
    modo_entrega: 'UNIDADE',
    apartamento: { id: 10, bloco: 'A', apto: '101' },
    entregador: {
      id: 20,
      nome: 'João Motoboy',
      telefone: '11999999999',
      status: 'BLOQUEADO',
      veiculos: [{ id: 1, placa: 'ABC1D23' }],
    },
    eventos: [
      {
        id: 1,
        status_anterior: 'AGENDADA',
        status_novo: 'CHEGOU',
        created_at: '2026-09-27T12:00:00.000Z',
        autor_nome: 'Porteiro',
      },
    ],
    created_at: '2026-09-27T11:30:00.000Z',
  },
  {
    id: 2,
    status: 'AGENDADA',
    estabelecimento: 'Mercado',
    modo_entrega: 'PORTARIA',
    apartamento: { id: 11, bloco: 'B', apto: '202' },
    entregador: null,
    eventos: [],
    created_at: '2026-09-27T11:00:00.000Z',
  },
];

class DeliveryApiStub {
  listAtendimentos = jest.fn(() => of(atendimentos));
  listEntregadores = jest.fn(() => of([] as DeliveryEntregador[]));
  atualizarStatus = jest.fn();
  criarEntregador = jest.fn();
  atualizarEntregador = jest.fn();
}

describe('DeliveryPageComponent', () => {
  let fixture: ComponentFixture<DeliveryPageComponent>;
  let component: DeliveryPageComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeliveryPageComponent],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: AuthService, useValue: { porteiroInfo: () => null } },
        { provide: ThemeService, useValue: { isLight: signal(false), toggleTheme: jest.fn() } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeliveryPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('inclui Delivery no menu e rota protegida no shell', () => {
    const deliveryRoute = appRoutes
      .find((route) => route.children?.some((child) => child.path === 'delivery'))
      ?.children?.find((route) => route.path === 'delivery');
    const sidebar = TestBed.runInInjectionContext(() => new SidebarComponent());

    expect(deliveryRoute?.loadComponent).toBeDefined();
    expect(sidebar.menu.flatMap((group) => group.items)).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Delivery', path: '/delivery' })]),
    );
  });

  it('renderiza a fila ativa e mostra a linha do tempo ao selecionar o atendimento', () => {
    expect(fixture.nativeElement.textContent).toContain('Pizzaria Central');
    expect(fixture.nativeElement.textContent).toContain('Mercado');

    component.selecionar(atendimentos[0]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Porteiro');
    expect(fixture.nativeElement.textContent).toContain('AGENDADA');
  });

  it('filtra a fila por unidade e placa', () => {
    component.busca.set('A 101');
    expect(component.atendimentosFiltrados()).toEqual([atendimentos[0]]);

    component.busca.set('abc-1d23');
    expect(component.atendimentosFiltrados()).toEqual([atendimentos[0]]);
  });

  it('não permite autorizar atendimento com entregador bloqueado', () => {
    component.selecionar(atendimentos[0]);
    fixture.detectChanges();

    const authorizeButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: HTMLButtonElement) => button.textContent?.includes('Autorizar'),
    ) as HTMLButtonElement;

    expect(authorizeButton.disabled).toBe(true);
  });

  it('não oferece cancelamento à portaria para um aviso agendado', () => {
    expect(component.proximosStatus(atendimentos[1])).not.toContain('CANCELADA');
  });

  it('normaliza o entregador recém-cadastrado mesmo quando a API não retorna veículos', () => {
    const api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    api.criarEntregador.mockReturnValue(of({ id: 31, nome: 'Maria Moto', status: 'ATIVO' }));
    component.novoEntregador.nome = 'Maria Moto';

    component.criarEntregador();

    expect(component.entregadores().find((entregador) => entregador.id === 31)?.veiculos).toEqual([]);
  });

  it('preserva os veículos na lista quando o PATCH do entregador não os retorna', () => {
    const api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    const entregador = atendimentos[0].entregador!;
    component.entregadores.set([entregador]);
    component.editarEntregador(entregador);
    component.motivoBloqueio = 'Documento inválido';
    api.atualizarEntregador.mockReturnValue(of({
      id: entregador.id,
      nome: entregador.nome,
      status: 'BLOQUEADO',
    }));

    component.salvarEntregador();

    expect(component.entregadores()[0].veiculos).toEqual([{ id: 1, placa: 'ABC1D23' }]);
  });
});
