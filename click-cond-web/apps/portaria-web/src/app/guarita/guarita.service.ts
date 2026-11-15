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
export const ROTULO_TIPO_GUARITA: { readonly [tipo: number]: string | undefined } = {
  1: 'Controle remoto',
  2: 'TAG ativo',
  3: 'Cartão',
  6: 'TAG passivo',
};
/** Sigla curta usada no visor do Guarita e no histórico. */
export const SIGLA_TIPO_GUARITA: { readonly [tipo: number]: string | undefined } = { 1: 'RF', 2: 'TA', 3: 'CT', 6: 'TP' };

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

/** Estados da tag de Guarita (`Tags.guarita_estado`). */
export type GuaritaEstadoTag =
  | 'aguardando_aprovacao'
  | 'pendente'
  | 'gravado'
  | 'ativo'
  | 'falhou'
  | 'a_vincular'
  | 'removendo'
  /** A portaria recusou a tag do app: não vale para o portão e não volta sozinha para a fila. */
  | 'recusada';

/**
 * Campos de Guarita que a tag pode trazer em `GET condominios/:id/tags` e no
 * `tag` de `GET condominios/:id/veiculos` (colunas novas de `Tags`, Task B1).
 * Todos opcionais: API antiga não manda nada e a tela fica como sempre.
 */
export interface CamposGuaritaDaTag {
  id_device?: number | null;
  guarita_tipo?: number | null;
  guarita_serial?: string | null;
  guarita_estado?: string | null;
  guarita_erro?: string | null;
}

/** Item de `GET …/:deviceId/dispositivos?estado=` (Task B3). */
export interface GuaritaDispositivo {
  /** Id da `Tags` (a API pode chamá-lo `id` ou `id_tag`; o serviço normaliza para `id`). */
  id: number;
  /** Device de onde a lista veio (preenchido pelo serviço). */
  id_device: number;
  codigo?: string | null;
  guarita_tipo: number | null;
  guarita_serial: string | null;
  guarita_estado: string | null;
  guarita_erro?: string | null;
  unidade?: number | string | null;
  bloco?: string | null;
  id_apto?: number | null;
  apartamento?: string | null;
  id_veiculo?: number | null;
  placa?: string | null;
  rotulo?: string | null;
  morador_nome?: string | null;
}

/** Item de `GET …/:deviceId/captura` (Task B6). */
export interface GuaritaCapturado {
  tipo: number;
  serial_hex: string;
  tem_contador: boolean;
  recebido_em: string;
}

/** Selo do estado no Guarita; null = sem selo (estado ausente ou desconhecido). */
export function rotuloEstadoGuarita(
  estado: string | null | undefined,
  erro?: string | null,
): { texto: string; dot: string; dica?: string } | null {
  switch (estado) {
    case 'aguardando_aprovacao':
      return { texto: 'Aguardando aprovação', dot: 'ps-dot-warn' };
    case 'pendente':
      return { texto: 'Pendente', dot: 'ps-dot-warn' };
    case 'gravado':
      return { texto: 'Gravado no Guarita', dot: 'ps-dot-ink', dica: 'Ainda não vale nos portões' };
    case 'ativo':
      return { texto: 'Ativo nos portões', dot: 'ps-dot-ok' };
    case 'falhou': {
      const motivo = (erro ?? '').trim();
      return { texto: motivo ? `Falhou: ${motivo}` : 'Falhou', dot: 'ps-dot-danger' };
    }
    case 'removendo':
      return { texto: 'Removendo', dot: 'ps-dot-warn' };
    case 'a_vincular':
      return { texto: 'A vincular', dot: 'ps-dot-warn' };
    case 'recusada':
      return { texto: 'Recusada pela portaria', dot: 'ps-dot-danger' };
    default:
      return null;
  }
}

/** Mesma mensagem que a API devolve para código impresso inválido. */
export const MSG_CODIGO_IMPRESSO_INVALIDO = 'Código inválido. Use o formato impresso no cartão: 015 02158.';

/**
 * Código impresso na TAG/cartão no formato Wiegand "015 02158" (também
 * "015,02158", "015-02158", com ou sem "W:"): facility 0–255 e número 0–65535.
 * A conversão para o serial fica na API; aqui só barra o que ela recusaria.
 */
export function codigoImpressoValido(codigo: string | null | undefined): boolean {
  const s = String(codigo ?? '').trim().replace(/^W\s*:\s*/i, '');
  const m = /^(\d{1,3})[\s,.-]+(\d{1,5})$/.exec(s);
  return !!m && Number(m[1]) <= 255 && Number(m[2]) <= 65535;
}

/** Controle remoto (RF) sem contador não pode ser gravado: o Guarita exige o contador. */
export function capturadoBloqueado(c: Pick<GuaritaCapturado, 'tipo' | 'tem_contador'>): boolean {
  return Number(c.tipo) === 1 && c.tem_contador !== true;
}

/** Item de `GET condominios/:id/guarita/alertas?pendentes=1` (Task B5). */
export interface GuaritaAlerta {
  id: number;
  id_device: number;
  /** Ex.: 'panico', 'clonagem', 'receptores_desatualizados', 'porta_violada', 'bateria_fraca'… (texto livre da API). */
  tipo: string;
  descricao: string;
  dados?: string | null;
  created_at: string;
  visto_em?: string | null;
}

/** Pânico vai em destaque. A API não fixou o nome do tipo: aceita 'panico' ou a palavra na descrição. */
export function alertaEhPanico(a: Pick<GuaritaAlerta, 'tipo' | 'descricao'>): boolean {
  const semAcento = (s: string | null | undefined) =>
    String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return semAcento(a.tipo).includes('panico') || semAcento(a.descricao).includes('panico');
}

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

  /** Pede de novo o "atualizar receptores" (comando 29) depois de uma falha. API nova; 404 = sem a rota. */
  atualizarReceptores(deviceId: number): Observable<unknown> {
    return this.http.post(`${this.dev(deviceId)}/atualizar-receptores`, {});
  }

  /** Andamento de uma operação. */
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

  // ===================== Veículos (Task C2) =====================

  /** Dispositivos do Guarita conhecidos pelo Prestare; `estado` filtra (ex.: 'a_vincular'). */
  dispositivos(deviceId: number, estado?: string): Observable<GuaritaDispositivo[]> {
    let params = new HttpParams();
    if (estado) params = params.set('estado', estado);
    return this.http.get<any[]>(`${this.dev(deviceId)}/dispositivos`, { params }).pipe(
      map((lista) =>
        (Array.isArray(lista) ? lista : [])
          .map((d) => ({ ...d, id: Number(d?.id_tag ?? d?.id), id_device: deviceId }) as GuaritaDispositivo)
          .filter((d) => Number.isFinite(d.id)),
      ),
    );
  }

  vincular(deviceId: number, idTag: number, idVeiculo: number): Observable<unknown> {
    return this.http.post(`${this.dev(deviceId)}/dispositivos/${idTag}/vincular`, { id_veiculo: idVeiculo });
  }

  /** Tag vinculada pelo morador no app: aprovar enfileira a gravação no Guarita. */
  aprovar(
    deviceId: number,
    idTag: number,
    dto?: { tipo: 2 | 3 | 6; codigo_impresso: string },
  ): Observable<unknown> {
    return this.http.post(`${this.dev(deviceId)}/dispositivos/${idTag}/aprovar`, dto ?? {});
  }

  /** Recusar: a tag não é gravada no Guarita e fica `recusada` (o morador vê no app). */
  recusar(deviceId: number, idTag: number): Observable<unknown> {
    return this.http.post(`${this.dev(deviceId)}/dispositivos/${idTag}/recusar`, {});
  }

  /** Abre a janela de 60 s de captura ("dispositivo não cadastrado") para um veículo. */
  abrirCaptura(deviceId: number, idVeiculo: number): Observable<unknown> {
    return this.http.post(`${this.dev(deviceId)}/captura`, { id_veiculo: idVeiculo });
  }

  /** O que chegou na janela de captura (aceita a lista pura ou `{ recebidos: [...] }`). */
  lerCaptura(deviceId: number): Observable<GuaritaCapturado[]> {
    return this.http.get<unknown>(`${this.dev(deviceId)}/captura`).pipe(
      map((r: any) => {
        const lista = Array.isArray(r) ? r : Array.isArray(r?.recebidos) ? r.recebidos : [];
        return lista.filter((c: any) => c && typeof c.serial_hex === 'string') as GuaritaCapturado[];
      }),
    );
  }

  /**
   * Confirma um serial capturado: a API cria a tag e enfileira o cadastro.
   * `id_veiculo` vai junto por segurança (a janela já o conhece; campo a mais
   * é descartado pelo whitelist da API).
   */
  confirmarCaptura(
    deviceId: number,
    dto: { tipo: number; serial_hex: string; id_veiculo: number },
  ): Observable<unknown> {
    return this.http.post(`${this.dev(deviceId)}/captura/confirmar`, dto);
  }

  // ===================== Portaria (Task C3) =====================

  /** Aciona o relé do portão pela ponte do agente (um pedido = um comando). */
  abrirPortao(deviceId: number, idPortao: number): Observable<{ enviado?: boolean }> {
    return this.http.post<{ enviado?: boolean }>(`${this.dev(deviceId)}/portoes/${idPortao}/abrir`, {});
  }

  /** Alertas do Guarita para a portaria (de todos os Guaritas do condomínio). */
  alertas(pendentes = true): Observable<GuaritaAlerta[]> {
    let params = new HttpParams();
    if (pendentes) params = params.set('pendentes', '1');
    return this.http
      .get<GuaritaAlerta[]>(`${this.base}/alertas`, { params })
      .pipe(map((l) => (Array.isArray(l) ? l : [])));
  }

  marcarAlertaVisto(idAlerta: number): Observable<unknown> {
    return this.http.post(`${this.base}/alertas/${idAlerta}/visto`, {});
  }

  /** TAG ativo (2), cartão (3) ou TAG passivo (6) pelo código impresso (ex.: "015 02158"). */
  cadastrarPorCodigo(
    deviceId: number,
    dto: { id_veiculo: number; tipo: 2 | 3 | 6; codigo_impresso: string },
  ): Observable<unknown> {
    return this.http.post(`${this.dev(deviceId)}/dispositivos`, dto);
  }
}

/** Mensagem de erro da API como veio (texto ou lista do class-validator), ou o padrão. */
export function mensagemDaApiGuarita(e: any, padrao: string): string {
  const m = e?.error?.message;
  if (Array.isArray(m)) return m.join(' ');
  return (typeof m === 'string' && m) || padrao;
}
