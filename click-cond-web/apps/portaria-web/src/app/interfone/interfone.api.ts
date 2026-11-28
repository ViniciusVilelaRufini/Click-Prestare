import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';

/**
 * Interfone pelo app — rotas do console (portaria e síndico). Contrato em
 * docs/superpowers/plans/2026-11-27-interfone-pelo-app.md ("Contrato da API").
 */

/** `facial_portaria`: o visitante discou a portaria no facial (portaria autônoma) — tem portão e vídeo, sem unidade. */
export type TipoChamada = 'facial_unidade' | 'facial_portaria' | 'portaria_unidade' | 'unidade_portaria';
/** `portaria`: a chamada nasceu na portaria (facial_portaria), não veio da unidade. */
export type MotivoPortaria = 'nao_atendeu' | 'recusou' | 'sem_app' | 'portaria' | null;

/** Chamadas de facial: têm portão para abrir e vídeo do visitante. */
export const TIPOS_COM_PORTAO: readonly TipoChamada[] = ['facial_unidade', 'facial_portaria'];
export function temPortao(tipo: TipoChamada | null | undefined): boolean {
  return !!tipo && TIPOS_COM_PORTAO.includes(tipo);
}
export type ResultadoChamada =
  | 'atendida_morador'
  | 'atendida_portaria'
  | 'nao_atendida'
  | 'recusada'
  | 'falha'
  | 'cancelada';

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Resposta de todo "atender"/"ligar": o suficiente para entrar na chamada por WebRTC. */
export interface DadosEntrada {
  id: number;
  token: string;
  wss: string;
  sip_uri: string;
  ice: IceServer[];
}

/** Evento `interfone:chamada` (Socket.IO, sala dos porteiros do condomínio). */
export interface EventoChamada {
  id: number;
  tipo: TipoChamada;
  unidade: string;
  motivo: MotivoPortaria;
  morador_nome: string | null;
  foto_url: string | null;
}

/** Item de `GET /interfone/portaria/hoje` (o do histórico do app + a unidade). */
export interface ChamadaHoje {
  id: number;
  tipo: TipoChamada;
  inicio: string;
  resultado: ResultadoChamada | null;
  atendida_por_nome: string | null;
  foto_url: string | null;
  porta_aberta: boolean;
  /** Quem abriu o portão nesta chamada (null se não abriu ou se a API não informou). */
  porta_aberta_por_nome?: string | null;
  unidade: string;
  /** Unidade da chamada, para ligar de volta (null: sem unidade). */
  id_apartamento?: number | null;
  /** Estado atual da chamada (a API manda no item de hoje): reconcilia o toque quando um `interfone:fim` se perde. */
  estado?: EstadoChamada;
}

export type EstadoChamada = 'chamando' | 'portaria' | 'atendida' | 'encerrada';

export interface ResultadoAbrir {
  ok: boolean;
  motivo?: string;
}

/** Faixa da agenda da portaria (0 = domingo; fim pode ser "24:00"). Quem edita é a Prestare, no CRM. */
export interface FaixaAgendaPortaria {
  dia_semana: number;
  inicio: string;
  fim: string;
  destino: 'local' | 'central';
}

export interface ConfigInterfone {
  contratado: boolean;
  ativo: boolean;
  toque_apto_s: number;
  transferir: boolean;
  toque_portaria_s: number;
  /** Central Prestare contratada (liga no CRM). */
  central_contratada?: boolean;
  /** Com a central, "Transferir para a portaria" é do contrato: o síndico não muda. */
  transferir_travado?: boolean;
  /** Agenda da central (só leitura no console). */
  agenda?: FaixaAgendaPortaria[];
}

/** O que o síndico grava. Com a central contratada o `transferir` não vai (a API ignora). */
export interface ConfigInterfoneEdicao {
  ativo: boolean;
  toque_apto_s: number;
  transferir?: boolean;
  toque_portaria_s: number;
}

export interface RamalUnidade {
  id_apartamento: number;
  unidade: string;
  ramal: string | null;
  sugestao: string | null;
  conflito: boolean;
}

export interface FacialInterfone {
  id: number;
  nome: string;
  modelo: string | null;
  habilitado: boolean;
  blocos: string[] | null;
  dtmf: string | null;
  conta: string;
  senha: string | null;
  servidor: string;
  porta: number;
  registrado: boolean;
  registrado_em: string | null;
  /** Intelbras: dá para mandar o Agente Local gravar conta SIP e lista telefônica no aparelho. */
  config_automatica?: boolean;
}

/**
 * Resposta de "Configurar automaticamente": falha do aparelho vem como `ok:false` com o motivo.
 * `erro:'sip_de_outro_servidor'` = o facial já usa a conta SIP de `servidor_atual` (o console pergunta antes de forçar).
 */
export interface ResultadoConfigFacial {
  ok: boolean;
  erro?: string;
  servidor_atual?: string;
  /** Ficou trabalho (prazo ou lote): clicar de novo continua de onde parou. */
  parcial?: boolean;
  restantes?: number;
  /** Números que o instalador já cadastrou à mão no facial (não mexidos). */
  conflitos?: string[];
  avisos?: string[];
}

export interface FacialInterfoneEdicao {
  habilitado: boolean;
  blocos: string[] | null;
  dtmf: string | null;
}

/**
 * Monitor IP da unidade. O contrato só fixa as rotas (`GET|POST /interfone/monitores`, `DELETE .../:id`); os campos
 * seguem os do facial (conta/senha/servidor/porta para o instalador).
 */
export interface MonitorInterfone {
  id: number;
  id_apartamento: number;
  unidade?: string | null;
  nome: string;
  conta: string;
  senha: string | null;
  servidor?: string | null;
  porta?: number | null;
  registrado?: boolean;
}

export interface NovoMonitor {
  id_apartamento: number;
  nome: string;
}

@Injectable({ providedIn: 'root' })
export class InterfoneApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE}/interfone`;

  // ===== Portaria (login de porteiro) =====

  atender(id: number): Observable<DadosEntrada> {
    return this.http.post<DadosEntrada>(`${this.base}/portaria/chamadas/${id}/atender`, {});
  }

  ligar(idApartamento: number): Observable<DadosEntrada> {
    return this.http.post<DadosEntrada>(`${this.base}/portaria/ligar`, { id_apartamento: idApartamento });
  }

  abrir(id: number): Observable<ResultadoAbrir> {
    return this.http.post<ResultadoAbrir>(`${this.base}/portaria/chamadas/${id}/abrir`, {});
  }

  encerrar(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/portaria/chamadas/${id}/encerrar`, {});
  }

  /** Chamadas de hoje. 403/404 = módulo desligado para esta sessão (o painel some). */
  hoje(): Observable<ChamadaHoje[]> {
    return this.http.get<ChamadaHoje[]>(`${this.base}/portaria/hoje`);
  }

  /** Chamadas de um dia anterior (AAAA-MM-DD, até 30 dias atrás). Só leitura, sem atualização ao vivo. */
  dia(data: string): Observable<ChamadaHoje[]> {
    return this.http.get<ChamadaHoje[]>(`${this.base}/portaria/dia`, { params: { data } });
  }

  // ===== Síndico =====

  config(): Observable<ConfigInterfone> {
    return this.http.get<ConfigInterfone>(`${this.base}/config`);
  }

  salvarConfig(c: ConfigInterfoneEdicao): Observable<ConfigInterfone> {
    return this.http.put<ConfigInterfone>(`${this.base}/config`, c);
  }

  ramais(): Observable<RamalUnidade[]> {
    return this.http.get<RamalUnidade[]>(`${this.base}/ramais`);
  }

  salvarRamais(lista: { id_apartamento: number; ramal: string | null }[]): Observable<RamalUnidade[]> {
    return this.http.put<RamalUnidade[]>(`${this.base}/ramais`, lista);
  }

  faciais(): Observable<FacialInterfone[]> {
    return this.http.get<FacialInterfone[]>(`${this.base}/faciais`);
  }

  salvarFacial(id: number, dto: FacialInterfoneEdicao): Observable<FacialInterfone> {
    return this.http.put<FacialInterfone>(`${this.base}/faciais/${id}`, dto);
  }

  /** A API devolve só a senha nova. */
  novaSenhaFacial(id: number): Observable<{ senha: string }> {
    return this.http.post<{ senha: string }>(`${this.base}/faciais/${id}/nova-senha`, {});
  }

  /** Agente Local grava a conta SIP e a lista telefônica no facial Intelbras. */
  configurarFacial(id: number, forcar = false): Observable<ResultadoConfigFacial> {
    return this.http.post<ResultadoConfigFacial>(`${this.base}/faciais/${id}/configurar`, { forcar });
  }

  /** CSV no modelo da Intelbras. Vem como blob: a rota exige o token, então não dá para abrir por link. */
  listaTelefonica(id: number): Observable<Blob> {
    return this.http.get(`${this.base}/faciais/${id}/lista-telefonica.csv`, { responseType: 'blob' });
  }

  monitores(): Observable<MonitorInterfone[]> {
    return this.http.get<MonitorInterfone[]>(`${this.base}/monitores`);
  }

  criarMonitor(dto: NovoMonitor): Observable<MonitorInterfone> {
    return this.http.post<MonitorInterfone>(`${this.base}/monitores`, dto);
  }

  removerMonitor(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/monitores/${id}`);
  }
}
