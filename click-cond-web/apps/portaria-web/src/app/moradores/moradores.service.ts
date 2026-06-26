import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface Morador {
  id: number;
  nome: string;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  data_nascimento: string | null;
  tipo: string | null;
  bloco: string | null;
  apartamento: string | null;
  id_apartamento: number;
  id_condominio: number;
  photo: string | null;
  foto_pessoa: string | null;
  foto_documento: string | null;
  face_id?: string | null;
  face_sync_status?: string | null;
  tag_rfid?: string | null;
  qrcode_acesso?: string | null;
}

export interface CreateMorador {
  nome: string;
  documento?: string;
  email?: string;
  telefone?: string;
  tipo?: string;
  id_apartamento: number;
  sendCredentials?: boolean;
  foto_pessoa?: string;
  foto_documento?: string;
  tag_rfid?: string;
  qrcode_acesso?: string;
}

@Injectable({ providedIn: 'root' })
export class MoradoresApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return `${API_BASE}/condominios/${cid}/moradores`;
  }

  list(search?: string): Observable<Morador[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);

    return this.http.get<Morador[]>(this.base, { params });
  }

  /** Captura uma foto da câmera do terminal facial (data URL JPEG). */
  capturarFotoFacial(): Observable<{ foto: string }> {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    const params = new HttpParams().set('id_condominio', cid);
    return this.http.post<{ foto: string }>(
      `${API_BASE}/facial/snapshot`,
      {},
      { params },
    );
  }

  create(dto: CreateMorador): Observable<Morador> {
    return this.http.post<Morador>(this.base, dto);
  }

  update(id: number, dto: Partial<CreateMorador>): Observable<Morador> {
    return this.http.put<Morador>(`${this.base}/${id}`, dto);
  }

  remove(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/${id}`);
  }

  sendCredentials(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/${id}/send-credentials`, {});
  }

  atividade(id: number): Observable<MoradorAtividade> {
    return this.http.get<MoradorAtividade>(`${this.base}/${id}/atividade`);
  }

  exportExcel(): Observable<{ base64: string; filename: string }> {
    return this.http.get<{ base64: string; filename: string }>(`${this.base}/export-excel`);
  }

  importBulk(linhas: any[]): Observable<{ ok: boolean; total: number; criados: any[] }> {
    return this.http.post<{ ok: boolean; total: number; criados: any[] }>(`${this.base}/import-bulk`, { linhas });
  }

  // Síndicos do condomínio (para vincular um deles como morador).
  listSindicos(): Observable<SindicoOption[]> {
    return this.http.get<SindicoOption[]>(`${this.base}/sindicos`);
  }

  // Vincula um usuário existente (síndico) a um apartamento como morador.
  linkUser(dto: { id_user: number; id_apartamento: number; tipo?: string }): Observable<any> {
    return this.http.post(`${this.base}/link-user`, dto);
  }
}

export interface SindicoOption {
  id_user: number;
  nome: string;
  email: string | null;
}

// === Tipos da resposta de GET /:id/atividade =====================
// Itens são "shallow" — só os campos que a UI precisa, sem joins pesados.

export interface MoradorVisita {
  id: number;
  nome: string;
  doc_identificacao: string | null;
  foto_pessoa: string | null;
  is_visitante: number | null;
  is_prestador: number | null;
  data_hora_inicio: string | null;
  data_hora_termino: string | null;
  data_entrada: string | null;
  data_saida: string | null;
  codigo_acesso: string | null;
  created_at: string;
  apto: string | null;
  apto_bloco: string | null;
}

export interface MoradorEncomenda {
  id: number;
  descricao: string;
  destinatario_apto: string;
  destinatario_bloco: string | null;
  recebido_de: string | null;
  recebido_em: string;
  retirado_em: string | null;
  retirado_por: string | null;
  status: string;
  foto_volume: string | null;
  recebidoPor?: { name: string | null } | null;
  entreguePor?: { name: string | null } | null;
}

export interface MoradorOcorrencia {
  id: number;
  descricao: string | null;
  status: string;
  resposta: string | null;
  resposta_at: string | null;
  created_at: string;
  categoria?: { nome: string } | null;
}

export interface MoradorAcesso {
  id: number;
  id_device: number;
  tipo_dispositivo: string;
  evento: string;
  confianca: number | null;
  timestamp: string;
  terminalNome: string;
  terminalTipo: string;
}

export interface MoradorAtividadeStats {
  visitasNoLocal: number;
  visitasAgendadas: number;
  visitasHistorico: number;
  encomendasAguardando: number;
  encomendasEntregues: number;
  ocorrenciasPendentes: number;
  ocorrenciasResolvidas: number;
  totalAcessos: number;
}

export interface MoradorAtividade {
  visitas: MoradorVisita[];
  encomendas: MoradorEncomenda[];
  ocorrencias: MoradorOcorrencia[];
  acessos: MoradorAcesso[];
  stats: MoradorAtividadeStats;
}
