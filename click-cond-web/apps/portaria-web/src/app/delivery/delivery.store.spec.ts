import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { DeliveryApi } from './delivery.service';
import { DeliveryStore } from './delivery.store';
import { ATENDIMENTOS, DeliveryApiStub } from './delivery.testing';

describe('DeliveryStore', () => {
  let store: DeliveryStore;
  let api: DeliveryApiStub;
  let authInfo: any;

  beforeEach(() => {
    authInfo = { id_condominio: 1, nome: 'Síndico', turno: 'Síndico' };
    TestBed.configureTestingModule({
      providers: [
        DeliveryStore,
        { provide: AuthService, useValue: { porteiroInfo: () => authInfo } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    });
    store = TestBed.inject(DeliveryStore);
    api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    store.carregarFila();
  });

  it('carrega só os ativos e conta por status', () => {
    expect(api.listAtivos).toHaveBeenCalled();
    expect(store.contador('CHEGOU')).toBe(1);
    expect(store.contador('AUTORIZADA')).toBe(0);
  });

  it('filtra por unidade, placa, nome e telefone avulsos', () => {
    store.busca.set('A 101');
    expect(store.fila()).toEqual([ATENDIMENTOS[0]]);
    store.busca.set('abc-1d23');
    expect(store.fila()).toEqual([ATENDIMENTOS[0]]);
    store.busca.set('Maria Avulsa');
    expect(store.fila()).toEqual([ATENDIMENTOS[1]]);
    store.busca.set('11 88888-7777');
    expect(store.fila()).toEqual([ATENDIMENTOS[1]]);
  });

  it('alterna filtro de status pelo card', () => {
    store.alternarFiltro('CHEGOU');
    expect(store.fila()).toEqual([ATENDIMENTOS[0]]);
    store.alternarFiltro('CHEGOU');
    expect(store.filtroStatus()).toBe('');
  });

  it('não autoriza com entregador bloqueado ou ausente', () => {
    store.selecionar(ATENDIMENTOS[0]);
    expect(store.podeAutorizar(ATENDIMENTOS[0])).toBe(false);
    const semEntregador = { ...ATENDIMENTOS[1], status: 'CHEGOU' as const };
    store.selecionar(semEntregador);
    expect(store.podeAutorizar(semEntregador)).toBe(false);
    store.atualizarStatus('AUTORIZADA');
    expect(api.atualizarStatus).not.toHaveBeenCalled();
    expect(store.erro()).toBe('Identifique o entregador antes de autorizar.');
  });

  it('exige motivo para recusar', () => {
    store.selecionar(ATENDIMENTOS[0]);
    store.atualizarStatus('RECUSADA');
    expect(api.atualizarStatus).not.toHaveBeenCalled();
    store.motivo.set('Pedido errado');
    store.atualizarStatus('RECUSADA');
    expect(api.atualizarStatus).toHaveBeenCalledWith(1, 'RECUSADA', { id_entregador: 20, motivo: 'Pedido errado' });
  });

  it('recarga silenciosa mantém o painel e o motivo digitado; erro não apaga a lista', () => {
    store.selecionar(ATENDIMENTOS[0]);
    store.motivo.set('rascunho');
    api.listAtivos.mockReturnValueOnce(throwError(() => ({ error: { message: 'offline' } })));
    store.carregarFila({ silencioso: true });
    expect(store.ativos()).toEqual(ATENDIMENTOS);
    expect(store.erro()).toBe('offline');
    store.carregarFila({ silencioso: true });
    expect(store.selecionado()?.id).toBe(1);
    expect(store.motivo()).toBe('rascunho');
  });

  it('mostra o veículo devolvido no cadastro e volta para a fila', () => {
    api.criarEntregador.mockReturnValue(of({ id: 31, nome: 'Maria Moto', status: 'ATIVO', veiculos: [{ id: 81, placa: 'XYZ9A87' }] }));
    store.aba.set('entregadores');
    store.novoEntregador.nome = 'Maria Moto';
    store.criarEntregador();
    expect(store.entregadores().find((e) => e.id === 31)?.veiculos).toEqual([expect.objectContaining({ placa: 'XYZ9A87' })]);
    expect(store.entregadorSelecionadoId()).toBe(31);
    expect(store.aba()).toBe('fila');
  });

  it('preserva veículos quando o PATCH não os devolve', () => {
    const entregador = ATENDIMENTOS[0].entregador!;
    store.entregadores.set([entregador]);
    store.editarEntregador(entregador);
    store.motivoBloqueio = 'Documento inválido';
    api.atualizarEntregador.mockReturnValue(of({ id: 20, nome: entregador.nome, status: 'BLOQUEADO' }));
    store.salvarEntregador();
    expect(store.entregadores()[0].veiculos).toEqual([{ id: 1, placa: 'ABC1D23' }]);
    expect(store.entregadorEmEdicao()).toBeNull();
  });

  it('envia correções do veículo ao salvar', () => {
    const entregador = ATENDIMENTOS[0].entregador!;
    store.entregadores.set([entregador]);
    store.editarEntregador(entregador);
    store.motivoBloqueio = 'Ocorrência confirmada';
    store.entregadorEmEdicao()!.veiculos[0] = { ...store.entregadorEmEdicao()!.veiculos[0], placa: 'XYZ9A87', tipo: 'Moto', modelo: 'CG', cor: 'Preta' };
    api.atualizarEntregador.mockReturnValue(of({ ...entregador, veiculos: [{ id: 1, placa: 'XYZ9A87', tipo: 'Moto', modelo: 'CG', cor: 'Preta' }] }));
    store.salvarEntregador();
    expect(api.atualizarEntregador).toHaveBeenCalledWith(20, expect.objectContaining({ veiculo: { placa: 'XYZ9A87', tipo: 'Moto', modelo: 'CG', cor: 'Preta' } }));
  });

  it('porteiro não gerencia entregadores', () => {
    authInfo = { id_condominio: 1, nome: 'Porteiro', turno: 'Noturno' };
    expect(store.podeGerenciarEntregadores()).toBe(false);
    store.editarEntregador(ATENDIMENTOS[0].entregador!);
    expect(store.entregadorEmEdicao()).toBeNull();
  });

  it('trocar de aba limpa o erro', () => {
    store.erro.set('falhou');
    store.trocarAba('entregadores');
    expect(store.erro()).toBeNull();
  });
});
