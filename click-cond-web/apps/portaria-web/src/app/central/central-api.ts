import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { MonoTypeOperatorFunction, Observable, catchError, throwError } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import type { DadosEntrada } from '../interfone/interfone.api';
import { CentralAuthService } from './central-auth.service';

export type { DadosEntrada } from '../interfone/interfone.api';

/**
 * Rotas da Central (operadores da Prestare que atendem vários condomínios). Contrato das Tasks 6–8 da
 * portaria autônoma (`/api/central/...`). Toda chamada leva o `central_token` — nunca o do porteiro.
 */

export type TipoChamadaCentral = 'facial_unidade' | 'facial_portaria' | 'unidade_portaria' | 'portaria_unidade';

/** Evento `interfone:chamada` na sala da central e item de `GET central/fila`. */
export interface ChamadaCentral {
  id: number;
  tipo: TipoChamadaCentral | string;
  unidade: string;
  motivo: string | null;
  morador_nome: string | null;
  foto_url: string | null;
  id_condominio: number;
  condominio: string;
  portao: string | null;
  /** ISO 8601. */
  criada_em: string;
}

export type EstadoPedido = 'pendente' | 'autorizado' | 'negado' | 'expirado';
export type TipoPedido = 'visita' | 'entrega' | 'servico' | 'outro';

/** Pedido de autorização ao morador (Interfone_Pedidos). */
export interface PedidoResumo {
  id: number;
  estado: EstadoPedido;
  nome_falado: string;
  motivo: string | null;
  tipo: TipoPedido | string;
  mensagem: string | null;
  respondido_por_nome: string | null;
  respondido_em: string | null;
  portao_aberto: boolean;
}

/** Evento `interfone:pedido`: o pedido + a chamada e o condomínio. */
export interface EventoPedido extends PedidoResumo {
  id_chamada: number;
  id_condominio: number;
}

export interface EsperadoHoje {
  nome: string;
  horario: string | null;
  tipo: 'convite' | 'entrega' | string;
}

/** O que o operador vê ao atender (LGPD: o mínimo; nunca telefone, e-mail ou documento). */
export interface ContextoChamada {
  condominio: string;
  portao: string | null;
  unidade: string;
  moradores: string[];
  esperados_hoje: EsperadoHoje[];
  instrucao_entregas: string | null;
  pedido: PedidoResumo | null;
}

export interface CondominioCentral {
  id: number;
  nome: string;
  /** Para onde vai a portaria agora (agenda + salvaguarda). */
  destino: 'local' | 'central';
}

export interface UnidadeCentral {
  id: number;
  rotulo: string;
}

export interface ItemHistoricoCentral {
  id: number;
  tipo: string;
  inicio: string;
  estado: string;
  resultado: string | null;
  atendida_por_nome: string | null;
  foto_url: string | null;
  porta_aberta: boolean;
  porta_aberta_por_nome: string | null;
  unidade: string;
  id_apartamento: number | null;
  id_condominio: number;
  condominio: string;
  portao: string | null;
}

export interface AlertaCentral {
  id: number;
  id_condominio: number;
  condominio: string;
  tipo: string;
  descricao: string;
  created_at: string;
  visto_em?: string | null;
  visto_por?: string | null;
}

export type MotivoAbertura =
  | 'visitante_identificado'
  | 'entrega'
  | 'prestador'
  | 'morador_sem_acesso'
  | 'emergencia'
  | 'outro';

/** Lista curta de motivos para abrir o portão (vai para a auditoria). `outro` exige o detalhe. */
export const MOTIVOS_ABERTURA: readonly { codigo: MotivoAbertura; rotulo: string }[] = [
  { codigo: 'visitante_identificado', rotulo: 'Visitante identificado' },
  { codigo: 'entrega', rotulo: 'Entrega' },
  { codigo: 'prestador', rotulo: 'Prestador de serviço' },
  { codigo: 'morador_sem_acesso', rotulo: 'Morador sem acesso' },
  { codigo: 'emergencia', rotulo: 'Emergência' },
  { codigo: 'outro', rotulo: 'Outro (descrever)' },
];

export const TIPOS_PEDIDO: readonly { codigo: TipoPedido; rotulo: string }[] = [
  { codigo: 'visita', rotulo: 'Visita' },
  { codigo: 'entrega', rotulo: 'Entrega' },
  { codigo: 'servico', rotulo: 'Serviço' },
  { codigo: 'outro', rotulo: 'Outro' },
];

export interface NovoPedido {
  nome: string;
  motivo?: string;
  tipo: TipoPedido;
  id_apartamento?: number;
}

@Injectable({ providedIn: 'root' })
export class CentralApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(CentralAuthService);
  private readonly router = inject(Router);
  private readonly base = `${API_BASE}/central`;

  condominios(): Observable<CondominioCentral[]> {
    return this.get<CondominioCentral[]>('condominios');
  }

  fila(): Observable<ChamadaCentral[]> {
    return this.get<ChamadaCentral[]>('fila');
  }

  atender(id: number): Observable<DadosEntrada> {
    return this.post<DadosEntrada>(`chamadas/${id}/atender`, {});
  }

  abrir(id: number, codigo: MotivoAbertura, detalhe?: string): Observable<{ ok: boolean; motivo?: string }> {
    return this.post(`chamadas/${id}/abrir`, detalhe ? { codigo, detalhe } : { codigo });
  }

  encerrar(id: number): Observable<{ ok: boolean }> {
    return this.post(`chamadas/${id}/encerrar`, {});
  }

  contexto(id: number): Observable<ContextoChamada> {
    return this.get<ContextoChamada>(`chamadas/${id}/contexto`);
  }

  pedido(id: number, dto: NovoPedido): Observable<PedidoResumo> {
    return this.post<PedidoResumo>(`chamadas/${id}/pedido`, dto);
  }

  ligar(idApartamento: number): Observable<DadosEntrada> {
    return this.post<DadosEntrada>('ligar', { id_apartamento: idApartamento });
  }

  unidades(idCondominio: number, busca: string): Observable<UnidadeCentral[]> {
    return this.get<UnidadeCentral[]>(`condominios/${idCondominio}/unidades`, { busca });
  }

  historico(data: string): Observable<ItemHistoricoCentral[]> {
    return this.get<ItemHistoricoCentral[]>('historico', { data });
  }

  alertas(pendentes = true): Observable<AlertaCentral[]> {
    return this.get<AlertaCentral[]>('alertas', pendentes ? { pendentes: '1' } : {});
  }

  alertaVisto(id: number): Observable<{ ok: boolean }> {
    return this.post(`alertas/${id}/visto`, {});
  }

  // ===================== internos =====================

  private cabecalhos(): HttpHeaders {
    const t = this.auth.token;
    return t ? new HttpHeaders({ Authorization: `Bearer ${t}` }) : new HttpHeaders();
  }

  private get<T>(rota: string, params: Record<string, string> = {}): Observable<T> {
    return this.http.get<T>(`${this.base}/${rota}`, { headers: this.cabecalhos(), params }).pipe(this.tratar<T>());
  }

  private post<T>(rota: string, corpo: unknown): Observable<T> {
    return this.http.post<T>(`${this.base}/${rota}`, corpo, { headers: this.cabecalhos() }).pipe(this.tratar<T>());
  }

  /**
   * 401 = a sessão da central acabou (vencida ou operador desativado): sai e volta ao login.
   * 403 `trocar_senha` = senha temporária ainda não trocada: a página mostra a troca de senha.
   */
  private tratar<T>(): MonoTypeOperatorFunction<T> {
    return catchError((e: HttpErrorResponse) => {
      if (e?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/central/login');
      } else if (e?.status === 403 && e?.error?.motivo === 'trocar_senha') {
        this.auth.marcarTrocarSenha();
      }
      return throwError(() => e);
    });
  }
}
