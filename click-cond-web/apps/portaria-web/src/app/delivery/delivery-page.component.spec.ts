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
    nome_entregador: 'Maria Avulsa',
    telefone_entregador: '11888887777',
    modo_entrega: 'PORTARIA',
    apartamento: { id: 11, bloco: 'B', apto: '202' },
    entregador: null,
    eventos: [],
    created_at: '2026-09-27T11:00:00.000Z',
  } as DeliveryAtendimento,
  {
    id: 3,
    status: 'CONCLUIDA',
    estabelecimento: 'Farmácia Histórica',
    nome_entregador: 'Carlos Entregas',
    telefone_entregador: '11777776666',
    modo_entrega: 'UNIDADE',
    apartamento: { id: 12, bloco: 'C', apto: '303' },
    entregador: null,
    eventos: [
      { id: 30, status_novo: 'AGENDADA', created_at: '2026-09-26T10:00:00.000Z' },
      { id: 31, status_anterior: 'AUTORIZADA', status_novo: 'CONCLUIDA', created_at: '2026-09-26T10:30:00.000Z' },
    ],
    created_at: '2026-09-26T10:00:00.000Z',
  } as DeliveryAtendimento,
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
  let authInfo: any;

  beforeEach(async () => {
    authInfo = { id_condominio: 1, nome: 'Síndico', turno: 'Síndico' };
    await TestBed.configureTestingModule({
      imports: [DeliveryPageComponent],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: AuthService, useValue: { porteiroInfo: () => authInfo } },
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

  it('mostra e pesquisa nome e telefone informados pelo morador antes do cadastro', () => {
    component.busca.set('Maria Avulsa');
    expect(component.atendimentosFiltrados()).toEqual([atendimentos[1]]);

    component.busca.set('11 88888-7777');
    expect(component.atendimentosFiltrados()).toEqual([atendimentos[1]]);

    component.busca.set('');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Maria Avulsa');
    expect(fixture.nativeElement.textContent).toContain('11888887777');
  });

  it('retorna zero para um contador de status sem atendimentos', () => {
    expect(component.contador('CHEGOU')).toBe(1);
    expect(component.contador('AUTORIZADA')).toBe(0);
  });

  it('não permite autorizar atendimento com entregador bloqueado', () => {
    component.selecionar(atendimentos[0]);
    fixture.detectChanges();

    const authorizeButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: HTMLButtonElement) => button.textContent?.includes('Autorizar'),
    ) as HTMLButtonElement;

    expect(authorizeButton.disabled).toBe(true);
  });

  it('não permite autorizar atendimento sem entregador associado', () => {
    const semEntregador = { ...atendimentos[1], status: 'CHEGOU' as const };
    component.selecionar(semEntregador);

    expect(component.podeAutorizar(semEntregador)).toBe(false);
  });

  it('não oferece cancelamento à portaria para um aviso agendado', () => {
    expect(component.proximosStatus(atendimentos[1])).not.toContain('CANCELADA');
  });

  it('mostra imediatamente o veículo devolvido no cadastro do entregador', () => {
    const api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    api.criarEntregador.mockReturnValue(of({
      id: 31,
      nome: 'Maria Moto',
      status: 'ATIVO',
      veiculos: [{ id: 81, placa: 'XYZ9A87', tipo: 'Moto' }],
    }));
    component.novoEntregador.nome = 'Maria Moto';

    component.criarEntregador();

    expect(component.entregadores().find((entregador) => entregador.id === 31)?.veiculos).toEqual([
      expect.objectContaining({ placa: 'XYZ9A87' }),
    ]);
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

  it('envia correções dos dados do veículo ao salvar o entregador', () => {
    const api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    const entregador = atendimentos[0].entregador!;
    component.entregadores.set([entregador]);
    component.editarEntregador(entregador);
    component.motivoBloqueio = 'Ocorrência confirmada';
    component.entregadorEmEdicao()!.veiculos[0] = {
      ...component.entregadorEmEdicao()!.veiculos[0],
      placa: 'XYZ9A87',
      tipo: 'Moto',
      modelo: 'CG',
      cor: 'Preta',
    };
    api.atualizarEntregador.mockReturnValue(of({
      ...entregador,
      veiculos: [{ id: 1, placa: 'XYZ9A87', tipo: 'Moto', modelo: 'CG', cor: 'Preta' }],
    }));

    component.salvarEntregador();

    expect(api.atualizarEntregador).toHaveBeenCalledWith(
      entregador.id,
      expect.objectContaining({
        veiculo: { placa: 'XYZ9A87', tipo: 'Moto', modelo: 'CG', cor: 'Preta' },
      }),
    );
    expect(component.entregadores()[0].veiculos[0]).toMatchObject({ placa: 'XYZ9A87', modelo: 'CG' });
  });

  it('não expõe edição e bloqueio de entregador para porteiro', () => {
    authInfo = { id_condominio: 1, nome: 'Porteiro', turno: 'Noturno' };
    component.entregadores.set([atendimentos[0].entregador!]);
    component.aba.set('entregadores');
    fixture.detectChanges();

    const botaoEntregador = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: HTMLButtonElement) => button.textContent?.includes('João Motoboy'),
    ) as HTMLButtonElement;
    botaoEntregador?.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Editar entregador');
    expect(component.entregadorEmEdicao()).toBeNull();
  });

  it('oferece histórico terminal e resumo básico ao síndico', () => {
    component.aba.set('historico' as any);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Relatório básico');
    expect(fixture.nativeElement.textContent).toContain('Farmácia Histórica');
    expect(component.contador('CONCLUIDA')).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('concluído');
    expect(fixture.nativeElement.textContent).not.toContain('Pizzaria Central');
  });
});
