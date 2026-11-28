import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { SipVoz } from '../interfone/sip-voz';
import { ToqueInterfone } from '../interfone/toque';
import { SipVozFalso, ToqueFalso } from '../interfone/interfone.testing';
import { AlarmeCentral } from './central-alarme';
import { CentralApi, ChamadaCentral } from './central-api';
import { CentralRealtimeService } from './central-realtime.service';
import { CentralStore } from './central.store';
import {
  AlarmeFalso,
  CHAMADA_A,
  CHAMADA_B,
  CONTEXTO,
  CentralApiStub,
  CentralRealtimeStub,
  PANICO,
  PEDIDO,
} from './central.testing';

const tique = () => new Promise((r) => setTimeout(r, 0));

describe('CentralStore', () => {
  let store: CentralStore;
  let api: CentralApiStub;
  let rt: CentralRealtimeStub;
  let sip: SipVozFalso;
  let toque: ToqueFalso;
  let alarme: AlarmeFalso;

  function montar() {
    TestBed.configureTestingModule({
      providers: [
        { provide: CentralApi, useClass: CentralApiStub },
        { provide: CentralRealtimeService, useClass: CentralRealtimeStub },
        { provide: SipVoz, useClass: SipVozFalso },
        { provide: ToqueInterfone, useClass: ToqueFalso },
        { provide: AlarmeCentral, useClass: AlarmeFalso },
      ],
    });
    store = TestBed.inject(CentralStore);
    api = TestBed.inject(CentralApi) as unknown as CentralApiStub;
    rt = TestBed.inject(CentralRealtimeService) as unknown as CentralRealtimeStub;
    sip = TestBed.inject(SipVoz) as unknown as SipVozFalso;
    toque = TestBed.inject(ToqueInterfone) as unknown as ToqueFalso;
    alarme = TestBed.inject(AlarmeCentral) as unknown as AlarmeFalso;
  }

  afterEach(() => {
    store?.parar();
    TestBed.resetTestingModule();
  });

  /** Atende a chamada A e deixa a conversa em curso. */
  async function emConversa(c: ChamadaCentral = CHAMADA_A) {
    rt.emitir('interfone:chamada', c);
    await store.atender(c.id);
    sip.ultima!.atender();
    await tique();
  }

  describe('início', () => {
    it('carrega fila, alertas pendentes e condomínios, e ouve os eventos da central', () => {
      montar();
      store.iniciar();
      expect(api.fila).toHaveBeenCalled();
      expect(api.alertas).toHaveBeenCalledWith(true);
      expect(api.condominios).toHaveBeenCalled();
      for (const ev of ['interfone:chamada', 'interfone:fim', 'interfone:pedido', 'alerta:novo', 'alerta:visto']) expect(rt.total(ev)).toBe(1);
    });

    it('parar tira os ouvintes, para o toque e o alarme e fecha o socket', () => {
      montar();
      store.iniciar();
      store.parar();
      expect(rt.total('interfone:chamada')).toBe(0);
      expect(toque.descartar).toHaveBeenCalled();
      expect(alarme.descartar).toHaveBeenCalled();
      expect(rt.desconectar).toHaveBeenCalled();
    });
  });

  describe('fila', () => {
    it('fila ordena pela mais antiga e remove no fim', () => {
      montar();
      api.fila.mockReturnValueOnce(of([CHAMADA_B]));
      store.iniciar();
      expect(store.fila().map((c) => c.id)).toEqual([42]);
      rt.emitir('interfone:chamada', CHAMADA_A); // criada antes da B
      expect(store.fila().map((c) => c.id)).toEqual([41, 42]);
      expect(toque.tocando).toBe(true);
      rt.emitir('interfone:fim', { id: 41 });
      expect(store.fila().map((c) => c.id)).toEqual([42]);
      rt.emitir('interfone:fim', { id: 42 });
      expect(store.fila()).toEqual([]);
      expect(toque.tocando).toBe(false);
    });

    it('evento repetido não duplica; evento sem id é ignorado', () => {
      montar();
      store.iniciar();
      rt.emitir('interfone:chamada', CHAMADA_A);
      rt.emitir('interfone:chamada', { ...CHAMADA_A, unidade: 'Bloco A · Apto 106 (2)' });
      rt.emitir('interfone:chamada', { tipo: 'facial_unidade' });
      expect(store.fila()).toHaveLength(1);
      expect(store.fila()[0].unidade).toBe('Bloco A · Apto 106 (2)');
    });

    it('recarregar a fila não traz de volta a chamada encerrada nem derruba a que chegou depois do pedido', () => {
      montar();
      store.iniciar();
      const resposta = new Subject<ChamadaCentral[]>();
      api.fila.mockReturnValueOnce(resposta);
      store.recarregarFila();
      rt.emitir('interfone:chamada', CHAMADA_B); // chegou depois do GET sair
      rt.emitir('interfone:fim', { id: 41 }); // encerrada depois do GET sair
      resposta.next([CHAMADA_A]);
      expect(store.fila().map((c) => c.id)).toEqual([42]);
    });

    it('reconectar o socket recarrega fila e alertas', () => {
      montar();
      store.iniciar();
      api.fila.mockClear();
      api.alertas.mockClear();
      rt.emitir('connect', undefined);
      expect(api.fila).toHaveBeenCalled();
      expect(api.alertas).toHaveBeenCalled();
    });
  });

  describe('atender', () => {
    it('atende, tira da fila, carrega o contexto e entra na voz', async () => {
      montar();
      store.iniciar();
      rt.emitir('interfone:chamada', CHAMADA_A);
      await store.atender(41);
      expect(api.atender).toHaveBeenCalledWith(41);
      expect(api.contexto).toHaveBeenCalledWith(41);
      expect(store.fila()).toEqual([]);
      expect(store.emChamada()?.id).toBe(41);
      expect(store.contexto()).toEqual(CONTEXTO);
      expect(sip.entrar).toHaveBeenCalled();
      expect(toque.tocando).toBe(false);
    });

    it('409 atendida_por_outro: some da fila e avisa em pt-BR', async () => {
      montar();
      store.iniciar();
      rt.emitir('interfone:chamada', CHAMADA_A);
      api.atender.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 409, error: { motivo: 'atendida_por_outro' } })),
      );
      await store.atender(41);
      expect(store.fila()).toEqual([]);
      expect(store.aviso()).toBe('Outra pessoa já atendeu esta chamada.');
      expect(sip.entrar).not.toHaveBeenCalled();
    });

    it('a voz não conecta: a chamada volta para a fila', async () => {
      montar();
      store.iniciar();
      rt.emitir('interfone:chamada', CHAMADA_A);
      sip.entrar.mockRejectedValueOnce(new Error('sem_conexao_central'));
      await store.atender(41);
      expect(store.emChamada()).toBeNull();
      expect(store.fila().map((c) => c.id)).toEqual([41]);
      expect(store.erro()).toBe('Não foi possível conectar à central de voz.');
    });

    it('a outra ponta desliga: a chamada sai, o contexto fica marcado como encerrado até Fechar', async () => {
      montar();
      store.iniciar();
      await emConversa();
      sip.ultima!.acabar({ atendida: true });
      expect(store.emChamada()).toBeNull();
      expect(store.contextoEncerrado()).toBe(true);
      expect(store.chamadaDoContexto()?.id).toBe(41);
      expect(store.contexto()).toEqual(CONTEXTO);
      store.fecharContexto();
      expect(store.contexto()).toBeNull();
      expect(store.chamadaDoContexto()).toBeNull();
      expect(store.contextoEncerrado()).toBe(false);
    });

    it('a voz não conecta: o contexto não fica (a chamada nem foi atendida)', async () => {
      montar();
      store.iniciar();
      rt.emitir('interfone:chamada', CHAMADA_A);
      sip.entrar.mockRejectedValueOnce(new Error('sem_conexao_central'));
      await store.atender(41);
      expect(store.contexto()).toBeNull();
      expect(store.chamadaDoContexto()).toBeNull();
    });
  });

  describe('abrir portão com motivo', () => {
    it('abrir sem motivo não chama a API', async () => {
      montar();
      store.iniciar();
      await emConversa();
      expect(await store.abrir('' as never)).toBe(false);
      expect(await store.abrir('outro', '   ')).toBe(false);
      expect(api.abrir).not.toHaveBeenCalled();
      expect(store.erro()).toBeTruthy();
    });

    it('com motivo da lista abre e avisa; "outro" leva o detalhe', async () => {
      montar();
      store.iniciar();
      await emConversa();
      expect(await store.abrir('entrega')).toBe(true);
      expect(api.abrir).toHaveBeenCalledWith(41, 'entrega', undefined);
      expect(store.aviso()).toBe('Portão aberto.');
      await store.abrir('outro', '  Técnico da operadora  ');
      expect(api.abrir).toHaveBeenLastCalledWith(41, 'outro', 'Técnico da operadora');
    });

    it('recusa da API vira texto em pt-BR', async () => {
      montar();
      store.iniciar();
      await emConversa();
      api.abrir.mockReturnValueOnce(of({ ok: false, motivo: 'aguarde' }));
      expect(await store.abrir('entrega')).toBe(false);
      expect(store.aviso()).toBe('Aguarde alguns segundos para abrir de novo.');
    });

    it('fora de conversa não abre', async () => {
      montar();
      store.iniciar();
      expect(await store.abrir('entrega')).toBe(false);
      expect(api.abrir).not.toHaveBeenCalled();
    });
  });

  describe('pedido ao morador', () => {
    it('pedirAutorizacao cria o pedido e mostra no contexto', async () => {
      montar();
      store.iniciar();
      await emConversa();
      expect(await store.pedirAutorizacao('Rodrigo', 'Visita', 'visita')).toBe(true);
      expect(api.pedido).toHaveBeenCalledWith(41, { nome: 'Rodrigo', motivo: 'Visita', tipo: 'visita' });
      expect(store.contexto()?.pedido).toEqual(PEDIDO);
    });

    it('sem nome não chama a API; facial_portaria manda a unidade escolhida', async () => {
      montar();
      store.iniciar();
      await emConversa(CHAMADA_B);
      expect(await store.pedirAutorizacao('  ', null, 'visita')).toBe(false);
      expect(api.pedido).not.toHaveBeenCalled();
      await store.pedirAutorizacao('Zé', null, 'entrega', 100);
      expect(api.pedido).toHaveBeenCalledWith(42, { nome: 'Zé', tipo: 'entrega', id_apartamento: 100 });
    });

    it('pedido atualiza o contexto ao receber interfone:pedido', async () => {
      montar();
      store.iniciar();
      await emConversa();
      await store.pedirAutorizacao('Rodrigo', 'Visita', 'visita');
      // Evento de outra chamada: ignorado.
      rt.emitir('interfone:pedido', { ...PEDIDO, id: 99, estado: 'negado', id_chamada: 77, id_condominio: 1 });
      expect(store.contexto()?.pedido?.estado).toBe('pendente');
      rt.emitir('interfone:pedido', {
        ...PEDIDO,
        estado: 'autorizado',
        mensagem: 'Já desço',
        respondido_por_nome: 'Ana',
        portao_aberto: true,
        id_chamada: 41,
        id_condominio: 1,
      });
      expect(store.contexto()?.pedido).toEqual(
        expect.objectContaining({ estado: 'autorizado', mensagem: 'Já desço', respondido_por_nome: 'Ana', portao_aberto: true }),
      );
      expect(store.contexto()?.pedido).not.toHaveProperty('id_chamada');
    });

    it('chamada encerrada: a resposta do morador que chega depois ainda aparece; atender outra troca o contexto', async () => {
      montar();
      store.iniciar();
      await emConversa();
      await store.pedirAutorizacao('Rodrigo', 'Visita', 'visita');
      store.encerrar();
      expect(store.emChamada()).toBeNull();
      expect(store.contextoEncerrado()).toBe(true);
      expect(store.contexto()?.pedido?.estado).toBe('pendente');
      rt.emitir('interfone:pedido', { ...PEDIDO, estado: 'autorizado', respondido_por_nome: 'Ana', portao_aberto: true, id_chamada: 41, id_condominio: 1 });
      expect(store.contexto()?.pedido).toEqual(expect.objectContaining({ estado: 'autorizado', portao_aberto: true }));
      // Outra chamada atendida: o contexto passa a ser dela.
      api.contexto.mockReturnValueOnce(of({ ...CONTEXTO, unidade: 'Portaria', pedido: null }));
      rt.emitir('interfone:chamada', CHAMADA_B);
      await store.atender(42);
      expect(store.contextoEncerrado()).toBe(false);
      expect(store.chamadaDoContexto()?.id).toBe(42);
      expect(store.contexto()?.pedido).toBeNull();
      rt.emitir('interfone:pedido', { ...PEDIDO, estado: 'negado', id_chamada: 41, id_condominio: 1 });
      expect(store.contexto()?.pedido).toBeNull();
    });

    it('alcance do push vem no pedido e no evento', async () => {
      montar();
      store.iniciar();
      await emConversa();
      await store.pedirAutorizacao('Rodrigo', null, 'visita');
      rt.emitir('interfone:pedido', { ...PEDIDO, alcance: { apps: 2, antigos: 1 }, id_chamada: 41, id_condominio: 1 });
      expect(store.contexto()?.pedido?.alcance).toEqual({ apps: 2, antigos: 1 });
    });

    it.each([
      ['limite_pedidos', 'Limite de 3 pedidos nesta chamada.'],
      ['pedido_pendente', 'Já há um pedido esperando a resposta do morador.'],
    ])('409 %s ao pedir vira texto em pt-BR', async (motivo, texto) => {
      montar();
      store.iniciar();
      await emConversa();
      api.pedido.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: { motivo, message: 'Conflict' } })));
      expect(await store.pedirAutorizacao('Rodrigo', null, 'visita')).toBe(false);
      expect(store.erro()).toBe(texto);
    });
  });

  describe('alertas', () => {
    it('alerta de pânico liga som até marcarVisto', async () => {
      montar();
      store.iniciar();
      rt.emitir('alerta:novo', { ...PANICO });
      expect(store.alertasAbertos().map((a) => a.id)).toEqual([7]);
      expect(store.somAlerta()).toBe(true);
      expect(alarme.tocando).toBe(true);
      await store.marcarVisto(7);
      expect(api.alertaVisto).toHaveBeenCalledWith(7);
      expect(store.alertasAbertos()).toEqual([]);
      expect(store.somAlerta()).toBe(false);
      expect(alarme.tocando).toBe(false);
    });

    it('alerta:visto de outro operador tira o alerta e para a sirene na hora', () => {
      montar();
      store.iniciar();
      rt.emitir('alerta:novo', { ...PANICO });
      expect(alarme.tocando).toBe(true);
      rt.emitir('alerta:visto', { id: 99, id_condominio: 1, visto_por: 'Central: Outro', visto_em: '2026-11-28T13:06:00.000Z' });
      expect(store.alertasAbertos()).toHaveLength(1);
      rt.emitir('alerta:visto', { id: 7, id_condominio: 1, visto_por: 'Central: Outro', visto_em: '2026-11-28T13:06:00.000Z' });
      expect(store.alertasAbertos()).toEqual([]);
      expect(store.somAlerta()).toBe(false);
      expect(alarme.tocando).toBe(false);
    });

    it('alerta que não é pânico entra na lista sem alarme', () => {
      montar();
      store.iniciar();
      rt.emitir('alerta:novo', { ...PANICO, id: 8, tipo: 'porta_aberta', descricao: 'Porta aberta' });
      expect(store.alertasAbertos()).toHaveLength(1);
      expect(store.somAlerta()).toBe(false);
      expect(alarme.tocar).not.toHaveBeenCalled();
    });

    it('pânico pendente que veio do GET também toca', () => {
      montar();
      api.alertas.mockReturnValueOnce(of([{ ...PANICO }]));
      store.iniciar();
      expect(alarme.tocando).toBe(true);
    });

    it('marcarVisto que falha mantém o alerta e o som', async () => {
      montar();
      store.iniciar();
      rt.emitir('alerta:novo', { ...PANICO });
      api.alertaVisto.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
      await store.marcarVisto(7);
      expect(store.alertasAbertos()).toHaveLength(1);
      expect(alarme.tocando).toBe(true);
      expect(store.erro()).toBeTruthy();
    });
  });

  describe('ligar e encerrar', () => {
    it('ligar para uma unidade entra na chamada que sai, com o condomínio', async () => {
      montar();
      store.iniciar();
      await store.ligar(1, 100, 'Bloco A · Apto 106');
      expect(api.ligar).toHaveBeenCalledWith(100);
      expect(store.emChamada()).toEqual(
        expect.objectContaining({ id: 600, tipo: 'portaria_unidade', unidade: 'Bloco A · Apto 106', condominio: 'Residencial Boa Vista', saindo: true }),
      );
      expect(sip.entrar).toHaveBeenCalled();
    });

    it('ligar com 409 sem_app mostra o texto', async () => {
      montar();
      store.iniciar();
      api.ligar.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: { motivo: 'sem_app' } })));
      await store.ligar(1, 100, 'Bloco A · Apto 106');
      expect(store.erro()).toBe('Ninguém dessa unidade recebe chamadas pelo app.');
      expect(sip.entrar).not.toHaveBeenCalled();
    });

    it('encerrar desliga a voz e avisa a API', async () => {
      montar();
      store.iniciar();
      await emConversa();
      const sessao = sip.ultima!;
      store.encerrar();
      expect(sessao.encerrar).toHaveBeenCalled();
      expect(api.encerrar).toHaveBeenCalledWith(41);
      expect(store.emChamada()).toBeNull();
    });

    it('mudo alterna o microfone da sessão', async () => {
      montar();
      store.iniciar();
      await emConversa();
      store.alternarMudo();
      expect(sip.ultima!.mudo).toHaveBeenCalledWith(true);
      expect(store.mudo()).toBe(true);
    });
  });
});
