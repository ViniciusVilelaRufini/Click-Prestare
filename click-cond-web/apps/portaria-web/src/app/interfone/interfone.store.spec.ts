import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { RealtimeService } from '../shared/realtime.service';
import { InterfoneApi } from './interfone.api';
import { InterfoneStore } from './interfone.store';
import { SipVoz } from './sip-voz';
import { ToqueInterfone } from './toque';
import {
  CHAMADA_FACIAL,
  CHAMADA_MORADOR,
  DADOS_ENTRADA,
  HOJE,
  InterfoneApiStub,
  RealtimeStub,
  SipVozFalso,
  ToqueFalso,
} from './interfone.testing';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}

const PORTEIRO = jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Manhã', tipo_sub: 'funcionario_portaria' });
const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });

const tique = () => new Promise((r) => setTimeout(r, 0));

describe('InterfoneStore', () => {
  let store: InterfoneStore;
  let api: InterfoneApiStub;
  let rt: RealtimeStub;
  let sip: SipVozFalso;
  let toque: ToqueFalso;

  function montar(token = PORTEIRO, turno: string | null = 'Manhã') {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { token, porteiroInfo: signal({ nome: 'João', turno, id_condominio: 1 }) } },
        { provide: InterfoneApi, useClass: InterfoneApiStub },
        { provide: RealtimeService, useClass: RealtimeStub },
        { provide: SipVoz, useClass: SipVozFalso },
        { provide: ToqueInterfone, useClass: ToqueFalso },
      ],
    });
    store = TestBed.inject(InterfoneStore);
    api = TestBed.inject(InterfoneApi) as unknown as InterfoneApiStub;
    rt = TestBed.inject(RealtimeService) as unknown as RealtimeStub;
    sip = TestBed.inject(SipVoz) as unknown as SipVozFalso;
    toque = TestBed.inject(ToqueInterfone) as unknown as ToqueFalso;
  }

  afterEach(() => {
    store?.parar();
    TestBed.resetTestingModule();
  });

  describe('ligar o painel', () => {
    it('porteiro com o módulo ativo: carrega as chamadas de hoje e ouve os eventos', () => {
      montar();
      store.iniciar();
      expect(api.hoje).toHaveBeenCalled();
      expect(store.ativo()).toBe(true);
      expect(store.hoje()).toEqual(HOJE);
      expect(rt.total('interfone:chamada')).toBe(1);
      expect(rt.total('interfone:fim')).toBe(1);
    });

    it.each([403, 404])('hoje %s = módulo desligado: painel some e nada é ouvido', (status) => {
      montar();
      api.hoje.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status })));
      store.iniciar();
      expect(store.ativo()).toBe(false);
      expect(rt.on).not.toHaveBeenCalled();
    });

    it('síndico não é a portaria: nem consulta', () => {
      montar(SINDICO, 'Síndico');
      store.iniciar();
      expect(api.hoje).not.toHaveBeenCalled();
      expect(store.ativo()).toBe(false);
    });

    it('porteiro com "Síndico" escrito no turno continua sendo a portaria (vale o token)', () => {
      montar(PORTEIRO, 'Síndico');
      store.iniciar();
      expect(store.ativo()).toBe(true);
    });

    it('iniciar duas vezes não duplica ouvintes', () => {
      montar();
      store.iniciar();
      store.iniciar();
      expect(rt.total('interfone:chamada')).toBe(1);
      expect(api.hoje).toHaveBeenCalledTimes(1);
    });

    it('parar tira os ouvintes', () => {
      montar();
      store.iniciar();
      store.parar();
      expect(rt.total('interfone:chamada')).toBe(0);
      expect(store.ativo()).toBe(false);
    });
  });

  describe('toque', () => {
    beforeEach(() => {
      montar();
      store.iniciar();
    });

    it('interfone:chamada entra em tocando e toca o som', () => {
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      expect(store.tocando()).toHaveLength(1);
      expect(store.tocando()[0]).toMatchObject({ id: 41, unidade: 'Bloco A · Apto 106', motivo: 'nao_atendeu' });
      expect(toque.tocando).toBe(true);
    });

    it('interfone:fim do mesmo id tira da lista e o som para', () => {
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      rt.emitir('interfone:fim', { id: 41 });
      expect(store.tocando()).toEqual([]);
      expect(toque.tocando).toBe(false);
    });

    it('evento repetido não duplica; fim de outro id não mexe', () => {
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      rt.emitir('interfone:chamada', { ...CHAMADA_FACIAL, motivo: 'recusou' });
      rt.emitir('interfone:fim', { id: 99 });
      expect(store.tocando()).toHaveLength(1);
      expect(store.tocando()[0].motivo).toBe('recusou');
    });

    it('evento malformado é ignorado', () => {
      rt.emitir('interfone:chamada', { tipo: 'facial_unidade' });
      rt.emitir('interfone:chamada', null);
      expect(store.tocando()).toEqual([]);
    });

    it('tipo desconhecido é ignorado (não vira chamada de facial)', () => {
      rt.emitir('interfone:chamada', { ...CHAMADA_FACIAL, tipo: 'outro' });
      rt.emitir('interfone:chamada', { ...CHAMADA_FACIAL, tipo: undefined });
      expect(store.tocando()).toEqual([]);
    });
  });

  describe('reconciliação (fim perdido)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      montar();
      store.iniciar();
    });
    afterEach(() => {
      store.parar();
      jest.useRealTimers();
    });

    /** As chamadas tocam há mais de 5 s (abaixo disso a lista do dia não derruba). */
    const passar5s = () => jest.advanceTimersByTime(5_000);

    it('socket reconectado recarrega o dia e tira o que já não toca na portaria', () => {
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      rt.emitir('interfone:chamada', CHAMADA_MORADOR);
      rt.emitir('interfone:chamada', { ...CHAMADA_FACIAL, id: 43 });
      passar5s();
      api.hoje.mockClear();
      api.hoje.mockReturnValueOnce(
        of([
          { ...HOJE[0], id: 41, estado: 'atendida' },
          { ...HOJE[0], id: 42, tipo: 'unidade_portaria', estado: 'chamando' },
          { ...HOJE[0], id: 43, estado: 'portaria' },
        ]) as never,
      );
      rt.emitir('connect', undefined);
      expect(api.hoje).toHaveBeenCalledTimes(1);
      expect(store.tocando().map((c) => c.id)).toEqual([42, 43]);
    });

    it('chamada de facial em "chamando" (de volta no apartamento) sai; encerrada também', () => {
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      rt.emitir('interfone:chamada', CHAMADA_MORADOR);
      passar5s();
      api.hoje.mockReturnValueOnce(
        of([
          { ...HOJE[0], id: 41, estado: 'chamando' },
          { ...HOJE[0], id: 42, tipo: 'unidade_portaria', estado: 'encerrada' },
        ]) as never,
      );
      store.recarregarHoje();
      expect(store.tocando()).toEqual([]);
    });

    it('chamada fora da lista do dia ou sem estado continua (o teto local cuida)', () => {
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      passar5s();
      api.hoje.mockReturnValueOnce(of([]) as never);
      store.recarregarHoje();
      expect(store.tocando().map((c) => c.id)).toEqual([41]);
    });

    it('GET disparado antes do interfone:chamada não derruba a chamada recém-transferida', () => {
      const resposta = new Subject<unknown>();
      api.hoje.mockReturnValueOnce(resposta as never);
      store.recarregarHoje(); // sai antes da transferência
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      passar5s();
      resposta.next([{ ...HOJE[0], id: 41, estado: 'chamando' }]); // foto velha: ainda no apartamento
      resposta.complete();
      expect(store.tocando().map((c) => c.id)).toEqual([41]);
    });

    it('evento repetido depois do disparo também protege a chamada', () => {
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      passar5s();
      const resposta = new Subject<unknown>();
      api.hoje.mockReturnValueOnce(resposta as never);
      store.recarregarHoje();
      rt.emitir('interfone:chamada', { ...CHAMADA_FACIAL, motivo: 'recusou' }); // a API reemitiu: toca de novo agora
      passar5s();
      resposta.next([{ ...HOJE[0], id: 41, estado: 'atendida' }]);
      resposta.complete();
      expect(store.tocando().map((c) => c.id)).toEqual([41]);
    });

    it('chamada com menos de 5 s desde o evento nunca é derrubada pela lista', () => {
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      jest.advanceTimersByTime(4_000);
      api.hoje.mockReturnValueOnce(of([{ ...HOJE[0], id: 41, estado: 'atendida' }]) as never);
      store.recarregarHoje();
      expect(store.tocando().map((c) => c.id)).toEqual([41]);
      jest.advanceTimersByTime(1_000);
      api.hoje.mockReturnValueOnce(of([{ ...HOJE[0], id: 41, estado: 'atendida' }]) as never);
      store.recarregarHoje();
      expect(store.tocando()).toEqual([]);
    });
  });

  it('teto local: chamada tocando some depois de 130 s sem fim', () => {
    jest.useFakeTimers();
    try {
      montar();
      store.iniciar();
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      jest.advanceTimersByTime(60_000);
      rt.emitir('interfone:chamada', { ...CHAMADA_FACIAL, motivo: 'recusou' }); // repetido não estende o teto
      jest.advanceTimersByTime(69_000);
      expect(store.tocando()).toHaveLength(1);
      jest.advanceTimersByTime(1_000);
      expect(store.tocando()).toEqual([]);
      expect(toque.tocando).toBe(false);
    } finally {
      store.parar();
      jest.useRealTimers();
    }
  });

  describe('motivos 409 em pt-BR', () => {
    beforeEach(() => {
      montar();
      store.iniciar();
    });

    it.each([
      ['em_andamento', 'Já existe uma ligação em andamento.'],
      ['indisponivel', 'Interfone indisponível no momento.'],
      ['sem_app', 'Ninguém dessa unidade recebe chamadas pelo app.'],
    ])('ligar com 409 %s', async (motivo, texto) => {
      api.ligar.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 409, error: { motivo, message: 'Conflict' } })),
      );
      await store.ligar(10, 'Bloco A · Apto 101');
      expect(store.erro()).toBe(texto);
      expect(sip.entrar).not.toHaveBeenCalled();
    });

    it('atender com 409 indisponivel mostra o texto e tira da lista', async () => {
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      api.atender.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 409, error: { motivo: 'indisponivel' } })),
      );
      await store.atender(41);
      expect(store.aviso()).toBe('Interfone indisponível no momento.');
      expect(store.tocando()).toEqual([]);
    });
  });

  describe('som bloqueado pelo navegador', () => {
    it('o store prepara o desbloqueio, expõe o bloqueio e ativa o som', () => {
      montar();
      store.iniciar();
      expect(toque.preparar).toHaveBeenCalled();
      toque.bloqueado.set(true);
      expect(store.somBloqueado()).toBe(true);
      store.ativarSom();
      expect(toque.desbloquear).toHaveBeenCalled();
    });
  });

  describe('atender', () => {
    beforeEach(() => {
      montar();
      store.iniciar();
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
    });

    it('chama a API, entra na chamada por SIP e move para emChamada', async () => {
      await store.atender(41);
      expect(api.atender).toHaveBeenCalledWith(41);
      expect(sip.entrar).toHaveBeenCalledWith(DADOS_ENTRADA, null, null);
      expect(store.emChamada()).toMatchObject({ id: 41, tipo: 'facial_unidade' });
      expect(store.tocando()).toEqual([]);
      expect(toque.tocando).toBe(false);
      expect(store.estado()).toBe('conectando');
      sip.ultima!.atender();
      expect(store.estado()).toBe('em_chamada');
    });

    it('usa o vídeo e o áudio registrados pelo painel', async () => {
      const video = document.createElement('video');
      const audio = document.createElement('audio');
      store.registrarMidia(video, audio);
      await store.atender(41);
      expect(sip.entrar).toHaveBeenCalledWith(DADOS_ENTRADA, video, audio);
    });

    it('409 ja_atendida: some da lista e avisa', async () => {
      api.atender.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 409, error: { motivo: 'ja_atendida' } })),
      );
      await store.atender(41);
      expect(sip.entrar).not.toHaveBeenCalled();
      expect(store.emChamada()).toBeNull();
      expect(store.tocando()).toEqual([]);
      expect(store.aviso()).toBe('Chamada já atendida.');
    });

    it('interfone:fim durante a própria chamada não derruba a conversa (o fim vem pelo SIP)', async () => {
      await store.atender(41);
      sip.ultima!.atender();
      rt.emitir('interfone:fim', { id: 41 });
      expect(store.emChamada()?.id).toBe(41);
      expect(sip.ultima!.encerrar).not.toHaveBeenCalled();
    });

    it('fim da sessão limpa a chamada e recarrega o dia', async () => {
      await store.atender(41);
      sip.ultima!.atender();
      api.hoje.mockClear();
      sip.ultima!.acabar({ atendida: true });
      expect(store.emChamada()).toBeNull();
      expect(store.estado()).toBeNull();
      expect(api.hoje).toHaveBeenCalled();
    });

    it('microfone negado: avisa e marca o bloqueio', async () => {
      await store.atender(41);
      sip.ultima!.acabar({ atendida: false, causa: 'User Denied Media Access' });
      expect(store.microfoneNegado()).toBe(true);
      expect(store.semChamadas()).toContain('microfone');
      expect(store.emChamada()).toBeNull();
    });

    it('falha ao entrar (central fora): volta a tocar se a chamada não acabou', async () => {
      sip.entrar.mockRejectedValueOnce(new Error('sem_conexao_central'));
      await store.atender(41);
      expect(store.emChamada()).toBeNull();
      expect(store.erro()).toBe('Não foi possível conectar à central de voz.');
      expect(store.tocando().map((c) => c.id)).toEqual([41]);
    });

    it('falha ao entrar depois de a chamada acabar: não volta a tocar', async () => {
      let rejeitar!: (e: Error) => void;
      sip.entrar.mockReturnValueOnce(new Promise((_, rej) => (rejeitar = rej)) as never);
      const p = store.atender(41);
      await tique();
      rt.emitir('interfone:fim', { id: 41 });
      rejeitar(new Error('sem_conexao_central'));
      await p;
      expect(store.tocando()).toEqual([]);
    });

    it('não atende outra com uma chamada em andamento', async () => {
      rt.emitir('interfone:chamada', CHAMADA_MORADOR);
      await store.atender(41);
      await store.atender(42);
      expect(api.atender).toHaveBeenCalledTimes(1);
      expect(store.tocando().map((c) => c.id)).toEqual([42]);
      expect(toque.tocando).toBe(false); // em conversa não toca por cima
    });

    it('encerrar desliga a sessão e avisa a API', async () => {
      await store.atender(41);
      const sessao = sip.ultima!;
      store.encerrar();
      expect(sessao.encerrar).toHaveBeenCalled();
      expect(api.encerrar).toHaveBeenCalledWith(41);
      expect(store.emChamada()).toBeNull();
    });

    it('mudo liga e desliga o microfone da sessão', async () => {
      await store.atender(41);
      store.alternarMudo();
      expect(sip.ultima!.mudo).toHaveBeenLastCalledWith(true);
      expect(store.mudo()).toBe(true);
      store.alternarMudo();
      expect(sip.ultima!.mudo).toHaveBeenLastCalledWith(false);
    });
  });

  describe('abrir', () => {
    beforeEach(() => {
      montar();
      store.iniciar();
    });

    it('chamada de facial atendida abre o portão', async () => {
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      await store.atender(41);
      sip.ultima!.atender();
      expect(store.podeAbrir()).toBe(true);
      store.abrir();
      await tique();
      expect(api.abrir).toHaveBeenCalledWith(41);
      expect(store.aviso()).toBe('Portão aberto.');
    });

    it.each([
      ['chamada_nao_encontrada', 'A chamada já terminou.'],
      ['chamada_nao_atendida', 'A chamada não está mais em conversa.'],
      ['atendida_por_outro', 'Outra pessoa atendeu esta chamada.'],
      ['sem_portao', 'Esta chamada não tem portão para abrir.'],
      ['indisponivel', 'Abertura do portão indisponível agora.'],
      ['falha_ao_abrir', 'Não foi possível abrir o portão.'],
      ['chamada_expirada', 'A chamada já terminou.'],
      ['aguarde', 'Aguarde alguns segundos para abrir de novo.'],
      ['codigo_novo_da_api', 'Não foi possível abrir o portão.'],
    ])('recusa %s da API vira texto em pt-BR (nunca o código cru)', async (motivo, texto) => {
      api.abrir.mockReturnValueOnce(of({ ok: false, motivo }) as never);
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      await store.atender(41);
      sip.ultima!.atender();
      store.abrir();
      await tique();
      expect(store.aviso()).toBe(texto);
    });

    it('erro HTTP do abrir: 403 do módulo desligado vira texto; sem corpo, a mensagem genérica', async () => {
      api.abrir.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 403, error: { motivo: 'modulo_desligado', message: 'x' } })) as never,
      );
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      await store.atender(41);
      sip.ultima!.atender();
      store.abrir();
      await tique();
      expect(store.aviso()).toBe('O interfone não está ligado neste condomínio.');
      api.abrir.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })) as never);
      store.abrir();
      await tique();
      expect(store.aviso()).toBe('Não foi possível abrir o portão.');
    });

    it('antes de a conversa começar não abre', async () => {
      rt.emitir('interfone:chamada', CHAMADA_FACIAL);
      await store.atender(41);
      expect(store.podeAbrir()).toBe(false);
      store.abrir();
      expect(api.abrir).not.toHaveBeenCalled();
    });

    it('chamada do morador (sem facial) não abre', async () => {
      rt.emitir('interfone:chamada', CHAMADA_MORADOR);
      await store.atender(42);
      sip.ultima!.atender();
      expect(store.podeAbrir()).toBe(false);
      store.abrir();
      expect(api.abrir).not.toHaveBeenCalled();
    });
  });

  describe('ligar para a unidade', () => {
    beforeEach(() => {
      montar();
      store.iniciar();
    });

    it('pede a entrada à API e disca', async () => {
      await store.ligar(10, 'Bloco A · Apto 101');
      expect(api.ligar).toHaveBeenCalledWith(10);
      expect(sip.entrar).toHaveBeenCalledWith({ ...DADOS_ENTRADA, id: 60 }, null, null);
      expect(store.emChamada()).toMatchObject({ id: 60, tipo: 'portaria_unidade', unidade: 'Bloco A · Apto 101' });
      expect(store.estado()).toBe('conectando');
    });

    it('acabou sem ninguém atender: "Ninguém atendeu"', async () => {
      await store.ligar(10, 'Bloco A · Apto 101');
      sip.ultima!.acabar({ atendida: false, causa: 'Canceled' });
      expect(store.emChamada()).toBeNull();
      expect(store.aviso()).toBe('Ninguém atendeu.');
    });

    it('erro da API vira mensagem e não disca', async () => {
      api.ligar.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Unidade sem ramal.' } })),
      );
      await store.ligar(10, 'Bloco A · Apto 101');
      expect(sip.entrar).not.toHaveBeenCalled();
      expect(store.erro()).toBe('Unidade sem ramal.');
    });
  });

  it('socket caído avisa que não vai receber chamadas (depois da carência de abertura)', () => {
    jest.useFakeTimers();
    try {
      montar();
      store.iniciar();
      expect(store.semChamadas()).toBeNull();
      rt.conectado.set(false);
      expect(store.semChamadas()).toBeNull(); // ainda conectando ao abrir a tela
      jest.advanceTimersByTime(5_000);
      expect(store.semChamadas()).toContain('central');
      rt.conectado.set(true);
      expect(store.semChamadas()).toBeNull();
    } finally {
      store.parar();
      jest.useRealTimers();
    }
  });
});
