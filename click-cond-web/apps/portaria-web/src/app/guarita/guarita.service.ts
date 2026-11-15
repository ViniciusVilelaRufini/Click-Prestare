import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

/**
 * Integração com o Módulo Guarita (Nice / Linear-HCS).
 *
 * TODO o acesso do console às rotas do Guarita passa por aqui. A integração
 * foi construída contra a documentação do protocolo e um simulador: nenhum
 * aparelho real respondeu a ela ainda. Enquanto isso for verdade, a tela
 * mostra o aviso fixo abaixo (constante no código, sem configuração).
 */
export const GUARITA_VALIDADA_EM_APARELHO = false;
export const AVISO_GUARITA_NAO_VALIDADA = 'Integração não validada em aparelho';

/** Valor de `Facial_Devices.tipo` / `fabricante` do Módulo Guarita. */
export const TIPO_DEVICE_GUARITA = 'guarita';
export const FABRICANTE_GUARITA = 'linear';
/** Porta principal TCP do Guarita (a secundária, 9001, o instalador habilita no aparelho). */
export const PORTA_PADRAO_GUARITA = 9000;
/** Acima disto (em segundos) a diferença de relógio Guarita × agente vira aviso. */
export const LIMITE_DELTA_RELOGIO_S = 120;

/** Tipos de dispositivo do Guarita: 1 RF (controle), 2 TA, 3 CT (cartão), 6 TP. */
export type GuaritaTipo = 1 | 2 | 3 | 6;
export const ROTULO_TIPO_GUARITA: Record<number, string> = {
  1: 'Controle remoto',
  2: 'TAG ativo',
  3: 'Cartão',
  6: 'TAG passivo',
};
/** Sigla curta usada no visor do Guarita e no histórico. */
export const SIGLA_TIPO_GUARITA: Record<number, string> = { 1: 'RF', 2: 'TA', 3: 'CT', 6: 'TP' };

/** O aparelho do tipo `guarita`, como vem de `GET /facial/devices`. */
export interface GuaritaDevice {
  id: number;
  nome: string;
  tipo: string;
  fabricante: string;
  ip: string;
  porta: number;
  ativo?: number;
}

/** `GET condominios/:id/guarita/:deviceId/estado` (Task B6). Todos os campos tolerados ausentes. */
export interface GuaritaEstado {
  conectado?: boolean | null;
  autorizado?: boolean | null;
  firmware?: string | null;
  total_dispositivos?: number | null;
  relogio_delta_s?: number | null;
  ultima_comunicacao?: string | null;
  pendentes?: number | null;
  falhas?: number | null;
  a_vincular?: number | null;
  aguardando_aprovacao?: number | null;
  /** Motivo da última falha reportada pelo agente (ex.: palavra recusada). Assumido; opcional. */
  erro?: string | null;
}

export type GuaritaEstadoOperacao = 'pendente' | 'enviada' | 'ok' | 'falhou' | 'cancelada';

/**
 * Uma operação da fila do Guarita (`Guarita_Operacoes`). É o que o console
 * assume receber de `POST …/importar`, `POST …/conferir` e
 * `GET …/operacoes/:idOperacao`.
 */
export interface GuaritaOperacao {
  id: number;
  tipo: string;
  estado: GuaritaEstadoOperacao;
  erro?: string | null;
  codigo?: number | null;
  created_at?: string | null;
  concluida_em?: string | null;
  /** Só na conferência: quantas diferenças foram achadas (assumido; opcional). */
  resumo?: {
    so_no_guarita?: number;
    so_no_prestare?: number;
    divergente?: number;
  } | null;
}

/** Item de `GET …/backups`. */
export interface GuaritaBackup {
  id: number;
  motivo: string;
  total: number;
  created_at: string;
}

/** Portão: (receptor, botão) → nome no histórico; (receptor, relé) → botão de abrir. */
export interface GuaritaPortao {
  id: number;
  nome: string;
  /** 1 RF, 2 TA, 3 CT, 6 TP. */
  tipo_receptor: number;
  /** Endereço CAN do receptor como aparece no Guarita: 1 a 8. */
  num_receptor: number;
  /** Botão/leitora do receptor (1 a 4); null = qualquer. */
  botao: number | null;
  /** Relé/saída acionado pelo botão de abrir (1 a 4); null = portão sem abertura pelo Prestare. */
  rele: number | null;
  /** 'entrada' | 'saida' | null. */
  sentido: string | null;
}

export type GuaritaPortaoDto = Omit<GuaritaPortao, 'id'>;

@Injectable({ providedIn: 'root' })
export class GuaritaService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get cid(): number {
    return this.auth.porteiroInfo()?.id_condominio ?? 1;
  }

  /** `…/condominios/:id/guarita` */
  private get base(): string {
    return `${API_BASE}/condominios/${this.cid}/guarita`;
  }

  private dev(deviceId: number): string {
    return `${this.base}/${deviceId}`;
  }

  /**
   * Guaritas ativos do condomínio, lidos da lista de aparelhos que já existe.
   * Falha na consulta = nenhum Guarita: as telas ficam como sempre foram.
   */
  listarGuaritas(): Observable<GuaritaDevice[]> {
    const params = new HttpParams().set('id_condominio', this.cid);
    return this.http.get<GuaritaDevice[]>(`${API_BASE}/facial/devices`, { params }).pipe(
      map((lista) =>
        (Array.isArray(lista) ? lista : []).filter((d) => d?.tipo === TIPO_DEVICE_GUARITA && d.ativo !== 0),
      ),
      catchError(() => of([] as GuaritaDevice[])),
    );
  }

  estado(deviceId: number): Observable<GuaritaEstado> {
    return this.http.get<GuaritaEstado>(`${this.dev(deviceId)}/estado`);
  }

  /** Cria a operação `importar` (409 se já houver uma em andamento). */
  importar(deviceId: number): Observable<GuaritaOperacao> {
    return this.http.post<GuaritaOperacao>(`${this.dev(deviceId)}/importar`, {});
  }

  /** Cria a operação `conferir` (409 se já houver uma em andamento). */
  conferir(deviceId: number): Observable<GuaritaOperacao> {
    return this.http.post<GuaritaOperacao>(`${this.dev(deviceId)}/conferir`, {});
  }

  /** Andamento de uma operação (rota assumida pelo console). */
  operacao(deviceId: number, idOperacao: number): Observable<GuaritaOperacao> {
    return this.http.get<GuaritaOperacao>(`${this.dev(deviceId)}/operacoes/${idOperacao}`);
  }

  backups(deviceId: number): Observable<GuaritaBackup[]> {
    return this.http.get<GuaritaBackup[]>(`${this.dev(deviceId)}/backups`);
  }

  /** Download do JSON da cópia (array de frames em hex). */
  baixarBackup(deviceId: number, idBackup: number): Observable<Blob> {
    return this.http.get(`${this.dev(deviceId)}/backups/${idBackup}`, { responseType: 'blob' });
  }

  portoes(deviceId: number): Observable<GuaritaPortao[]> {
    return this.http.get<GuaritaPortao[]>(`${this.dev(deviceId)}/portoes`);
  }

  criarPortao(deviceId: number, dto: GuaritaPortaoDto): Observable<GuaritaPortao> {
    return this.http.post<GuaritaPortao>(`${this.dev(deviceId)}/portoes`, dto);
  }

  atualizarPortao(deviceId: number, idPortao: number, dto: GuaritaPortaoDto): Observable<GuaritaPortao> {
    return this.http.put<GuaritaPortao>(`${this.dev(deviceId)}/portoes/${idPortao}`, dto);
  }

  removerPortao(deviceId: number, idPortao: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.dev(deviceId)}/portoes/${idPortao}`);
  }
}

/** Mensagem de erro da API como veio (texto ou lista do class-validator), ou o padrão. */
export function mensagemDaApiGuarita(e: any, padrao: string): string {
  const m = e?.error?.message;
  if (Array.isArray(m)) return m.join(' ');
  return (typeof m === 'string' && m) || padrao;
}
