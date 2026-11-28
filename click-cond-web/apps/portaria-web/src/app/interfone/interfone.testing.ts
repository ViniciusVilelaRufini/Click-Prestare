import { signal } from '@angular/core';
import { of } from 'rxjs';
import type { ChamadaHoje, DadosEntrada, EventoChamada } from './interfone.api';
import type { EstadoSessao, FimSessao, SessaoVoz } from './sip-voz';

export const DADOS_ENTRADA: DadosEntrada = {
  id: 41,
  token: 'tok-voz',
  wss: 'wss://voz.prestarecondominios.com.br:8089/ws',
  sip_uri: 'sip:entrar@voz.prestarecondominios.com.br',
  ice: [{ urls: ['stun:voz.prestarecondominios.com.br:3478'] }],
};

export const CHAMADA_FACIAL: EventoChamada = {
  id: 41,
  tipo: 'facial_unidade',
  unidade: 'Bloco A · Apto 106',
  motivo: 'nao_atendeu',
  morador_nome: null,
  foto_url: 'https://s3/foto.jpg',
};

export const CHAMADA_MORADOR: EventoChamada = {
  id: 42,
  tipo: 'unidade_portaria',
  unidade: 'Bloco B · Apto 201',
  motivo: null,
  morador_nome: 'Ana Souza',
  foto_url: null,
};

export const HOJE: ChamadaHoje[] = [
  {
    id: 30, tipo: 'facial_unidade', inicio: '2026-11-27T13:00:00.000Z', resultado: 'atendida_morador',
    atendida_por_nome: 'Ana Souza', foto_url: null, porta_aberta: true, unidade: 'Bloco A · Apto 106',
  },
];

export class InterfoneApiStub {
  atender = jest.fn(() => of({ ...DADOS_ENTRADA }));
  ligar = jest.fn((id: number) => of({ ...DADOS_ENTRADA, id: 50 + id }));
  abrir = jest.fn(() => of({ ok: true }));
  encerrar = jest.fn(() => of({ ok: true }));
  hoje = jest.fn(() => of([...HOJE]));
  config = jest.fn();
  salvarConfig = jest.fn();
  ramais = jest.fn();
  salvarRamais = jest.fn();
  faciais = jest.fn();
  salvarFacial = jest.fn();
  novaSenhaFacial = jest.fn();
  listaTelefonica = jest.fn();
  monitores = jest.fn();
  criarMonitor = jest.fn();
  removerMonitor = jest.fn();
}

/** RealtimeService falso: guarda os ouvintes e deixa o teste emitir eventos. */
export class RealtimeStub {
  readonly conectado = signal(true);
  readonly ouvintes = new Map<string, Set<(d: any) => void>>();
  on = jest.fn((ev: string, cb: (d: any) => void) => {
    if (!this.ouvintes.has(ev)) this.ouvintes.set(ev, new Set());
    this.ouvintes.get(ev)!.add(cb);
    return () => this.ouvintes.get(ev)?.delete(cb);
  });
  connect = jest.fn(() => null);
  disconnect = jest.fn();
  emitir(ev: string, dados: unknown) {
    this.ouvintes.get(ev)?.forEach((cb) => cb(dados));
  }
  total(ev: string): number {
    return this.ouvintes.get(ev)?.size ?? 0;
  }
}

/** Sessão SIP falsa: o teste decide quando a outra ponta atende e quando a chamada acaba. */
export class SessaoFalsa implements SessaoVoz {
  estado: EstadoSessao = 'conectando';
  encerrar = jest.fn(() => this.acabar({ atendida: this.estado === 'em_chamada', causa: 'Terminated' }));
  mudo = jest.fn();
  private ouvEstado: ((e: EstadoSessao) => void)[] = [];
  private ouvFim: ((f: FimSessao) => void)[] = [];
  aoEstado(cb: (e: EstadoSessao) => void) { this.ouvEstado.push(cb); }
  aoEncerrar(cb: (f: FimSessao) => void) { this.ouvFim.push(cb); }
  atender() {
    this.estado = 'em_chamada';
    this.ouvEstado.forEach((cb) => cb('em_chamada'));
  }
  acabar(fim: FimSessao) {
    if (this.estado === 'encerrada') return;
    this.estado = 'encerrada';
    this.ouvEstado.forEach((cb) => cb('encerrada'));
    this.ouvFim.forEach((cb) => cb(fim));
  }
}

export class SipVozFalso {
  ultima: SessaoFalsa | null = null;
  entrar = jest.fn(async () => {
    this.ultima = new SessaoFalsa();
    return this.ultima;
  });
}

export class ToqueFalso {
  tocando = false;
  readonly bloqueado = signal(false);
  tocar = jest.fn(() => { this.tocando = true; });
  parar = jest.fn(() => { this.tocando = false; });
  preparar = jest.fn();
  desbloquear = jest.fn(() => this.bloqueado.set(false));
  descartar = jest.fn();
}
