import { signal } from '@angular/core';
import { of } from 'rxjs';
import type { AlertaCentral, ChamadaCentral, ContextoChamada, DadosEntrada, PedidoResumo } from './central-api';

export const ENTRADA: DadosEntrada = {
  id: 41,
  token: 'tok-voz-central',
  wss: 'wss://voz.prestarecondominios.com.br:8089/ws',
  sip_uri: 'sip:entrar@voz.prestarecondominios.com.br',
  ice: [{ urls: ['stun:voz.prestarecondominios.com.br:3478'] }],
};

export const CHAMADA_A: ChamadaCentral = {
  id: 41,
  tipo: 'facial_unidade',
  unidade: 'Bloco A · Apto 106',
  motivo: 'nao_atendeu',
  morador_nome: null,
  foto_url: 'https://s3/foto.jpg',
  id_condominio: 1,
  condominio: 'Residencial Boa Vista',
  portao: 'Portão social',
  criada_em: '2026-11-28T13:00:00.000Z',
};

export const CHAMADA_B: ChamadaCentral = {
  id: 42,
  tipo: 'facial_portaria',
  unidade: '',
  motivo: null,
  morador_nome: null,
  foto_url: null,
  id_condominio: 4,
  condominio: 'Torre Dois',
  portao: 'Portão de serviço',
  criada_em: '2026-11-28T13:02:00.000Z',
};

export const CONTEXTO: ContextoChamada = {
  condominio: 'Residencial Boa Vista',
  portao: 'Portão social',
  unidade: 'Bloco A · Apto 106',
  moradores: ['Ana', 'Bruno'],
  esperados_hoje: [{ nome: 'Rodrigo', horario: '15:30', tipo: 'convite' }],
  instrucao_entregas: 'Deixe no armário 3.',
  pedido: null,
};

export const PEDIDO: PedidoResumo = {
  id: 9,
  estado: 'pendente',
  nome_falado: 'Rodrigo',
  motivo: 'Visita',
  tipo: 'visita',
  mensagem: null,
  respondido_por_nome: null,
  respondido_em: null,
  portao_aberto: false,
  alcance: null,
};

export const PANICO: AlertaCentral = {
  id: 7,
  id_condominio: 1,
  condominio: 'Residencial Boa Vista',
  tipo: 'panico',
  descricao: 'Pânico acionado no Guarita',
  created_at: '2026-11-28T13:05:00.000Z',
  visto_em: null,
  visto_por: null,
};

export class CentralApiStub {
  condominios = jest.fn(() => of([{ id: 1, nome: 'Residencial Boa Vista', destino: 'central' as const }]));
  fila = jest.fn(() => of([] as ChamadaCentral[]));
  atender = jest.fn((id: number) => of({ ...ENTRADA, id }));
  abrir = jest.fn(() => of({ ok: true }));
  encerrar = jest.fn(() => of({ ok: true }));
  contexto = jest.fn(() => of({ ...CONTEXTO }));
  pedido = jest.fn(() => of({ ...PEDIDO }));
  ligar = jest.fn((id: number) => of({ ...ENTRADA, id: 500 + id }));
  unidades = jest.fn(() => of([{ id: 100, rotulo: 'Bloco A · Apto 106' }]));
  historico = jest.fn(() => of([]));
  alertas = jest.fn(() => of([] as AlertaCentral[]));
  alertaVisto = jest.fn(() => of({ ok: true }));
}

/** CentralRealtimeService falso: guarda os ouvintes e deixa o teste emitir eventos. */
export class CentralRealtimeStub {
  readonly conectado = signal(true);
  readonly reconectando = signal(false);
  readonly ouvintes = new Map<string, Set<(d: any) => void>>();
  on = jest.fn((ev: string, cb: (d: any) => void) => {
    if (!this.ouvintes.has(ev)) this.ouvintes.set(ev, new Set());
    this.ouvintes.get(ev)!.add(cb);
    return () => this.ouvintes.get(ev)?.delete(cb);
  });
  desconectar = jest.fn();
  emitir(ev: string, dados: unknown) {
    this.ouvintes.get(ev)?.forEach((cb) => cb(dados));
  }
  total(ev: string): number {
    return this.ouvintes.get(ev)?.size ?? 0;
  }
}

export class AlarmeFalso {
  tocando = false;
  readonly bloqueado = signal(false);
  tocar = jest.fn(() => { this.tocando = true; });
  parar = jest.fn(() => { this.tocando = false; });
  preparar = jest.fn();
  desbloquear = jest.fn();
  descartar = jest.fn(() => { this.tocando = false; });
}

/** JWT de operador da central (assinatura falsa: o console só lê o payload). */
export function tokenDeTeste(extra: Record<string, unknown> = {}): string {
  const payload: Record<string, unknown> = {
    sub: 5,
    nome: 'Olga Operadora',
    papel: 'operador_central',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
  };
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}
