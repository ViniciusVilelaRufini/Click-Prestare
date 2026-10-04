import { TestBed } from '@angular/core/testing';
import { NEVER, Subject, of, throwError } from 'rxjs';
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

  it('limpa erro antigo ao iniciar uma nova ação de status', () => {
    store.selecionar(ATENDIMENTOS[0]);
    store.erro.set('erro antigo');
    store.motivo.set('Pedido errado');
    api.atualizarStatus.mockReturnValueOnce(NEVER); // requisição ainda em andamento
    store.atualizarStatus('RECUSADA');
    expect(api.atualizarStatus).toHaveBeenCalled();
    expect(store.erro()).toBeNull();
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

  it('recarga silenciosa bem-sucedida limpa o aviso de erro; carga normal mantém o comportamento', () => {
    store.erro.set('offline');
    store.carregarFila({ silencioso: true });
    expect(store.erro()).toBeNull();
    store.erro.set('outro erro');
    store.carregarFila();
    expect(store.erro()).toBe('outro erro');
  });

  it('recarga silenciosa não liga carregando; se cancela uma carga normal, quem terminar desliga', () => {
    const normal = new Subject<typeof ATENDIMENTOS>();
    api.listAtivos.mockReturnValueOnce(normal as any);
    store.carregarFila(); // carga normal pendente
    expect(store.carregando()).toBe(true);
    const silenciosa = new Subject<typeof ATENDIMENTOS>();
    api.listAtivos.mockReturnValueOnce(silenciosa as any);
    store.carregarFila({ silencioso: true });
    expect(store.carregando()).toBe(true); // ainda esperando a resposta
    silenciosa.next([ATENDIMENTOS[1]]);
    expect(store.ativos()).toEqual([ATENDIMENTOS[1]]);
    expect(store.carregando()).toBe(false); // não fica girando para sempre
    normal.next(ATENDIMENTOS); // resposta atrasada da carga cancelada é ignorada
    expect(store.ativos()).toEqual([ATENDIMENTOS[1]]);
  });

  it('resposta atrasada de uma carga antiga não sobrescreve a mais nova', () => {
    const antiga = new Subject<typeof ATENDIMENTOS>();
    const nova = new Subject<typeof ATENDIMENTOS>();
    api.listAtivos.mockReturnValueOnce(antiga as any).mockReturnValueOnce(nova as any);
    store.carregarFila({ silencioso: true });
    store.carregarFila({ silencioso: true });
    nova.next([ATENDIMENTOS[1]]);
    antiga.next(ATENDIMENTOS);
    expect(store.ativos()).toEqual([ATENDIMENTOS[1]]);
  });

  it('erro de recarga silenciosa não apaga a lista nem liga carregando', () => {
    api.listAtivos.mockReturnValueOnce(throwError(() => ({ error: { message: 'offline' } })));
    store.carregarFila({ silencioso: true });
    expect(store.carregando()).toBe(false);
    expect(store.erro()).toBe('offline');
    expect(store.ativos()).toEqual(ATENDIMENTOS);
  });

  it('recarga silenciosa não liga carregando quando ocioso', () => {
    expect(store.carregando()).toBe(false);
    store.carregarFila({ silencioso: true });
    expect(store.carregando()).toBe(false);
    api.listAtivos.mockReturnValueOnce(throwError(() => ({ error: { message: 'offline' } })));
    store.carregarFila({ silencioso: true });
    expect(store.carregando()).toBe(false);
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

  it('voltar para a aba Fila recarrega a lista em silêncio', () => {
    store.trocarAba('entregadores');
    api.listAtivos.mockClear();
    store.trocarAba('fila');
    expect(api.listAtivos).toHaveBeenCalledTimes(1);
    expect(store.carregando()).toBe(false);
    store.trocarAba('historico');
    expect(api.listAtivos).toHaveBeenCalledTimes(1);
  });

  describe('busca de entregadores', () => {
    const maria = { id: 31, nome: 'Maria Moto', status: 'ATIVO' as const, veiculos: [] };

    beforeEach(() => {
      store.entregadores.set([ATENDIMENTOS[0].entregador!, maria]);
    });

    it('a pesquisa não altera a lista completa', () => {
      api.listEntregadores.mockReturnValueOnce(of([maria]));
      store.buscarEntregadores('mar');
      expect(api.listEntregadores).toHaveBeenCalledWith('mar');
      expect(store.entregadoresBusca()).toEqual([maria]);
      expect(store.entregadores().length).toBe(2);
      expect(store.entregadoresVisiveis()).toEqual([maria]);
    });

    it('texto vazio volta à lista completa sem chamar a API', () => {
      api.listEntregadores.mockReturnValueOnce(of([maria]));
      store.buscarEntregadores('mar');
      api.listEntregadores.mockClear();
      store.buscarEntregadores('   ');
      expect(api.listEntregadores).not.toHaveBeenCalled();
      expect(store.entregadoresBusca()).toBeNull();
      expect(store.entregadoresVisiveis().length).toBe(2);
    });

    it('trocar de aba descarta o filtro; resposta atrasada de busca antiga é ignorada', () => {
      const antiga = new Subject<any[]>();
      api.listEntregadores.mockReturnValueOnce(antiga as any);
      store.buscarEntregadores('ma');
      api.listEntregadores.mockReturnValueOnce(of([maria]));
      store.buscarEntregadores('mar');
      antiga.next([]);
      expect(store.entregadoresBusca()).toEqual([maria]);
      store.trocarAba('fila');
      expect(store.entregadoresBusca()).toBeNull();
    });

    it('editar durante a busca atualiza a lista filtrada também', () => {
      api.listEntregadores.mockReturnValueOnce(of([maria]));
      store.buscarEntregadores('mar');
      api.atualizarEntregador.mockReturnValue(of({ ...maria, nome: 'Maria Silva' }));
      store.editarEntregador(maria);
      store.salvarEntregador();
      expect(store.entregadoresBusca()![0].nome).toBe('Maria Silva');
      expect(store.entregadores().find((e) => e.id === 31)!.nome).toBe('Maria Silva');
    });
  });
});
