import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CreateVisitante, Visitante } from './visitante.model';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface VisitanteTimelineEntry {
  evento: 'entrada' | 'saida' | 'negado';
  timestamp: string;
  metodo: 'facial' | 'pin';
  metodoLabel: string;
  confianca?: number;
  terminalNome?: string;
  idApartamento?: number;
  blocoApto?: string;
  idVisitanteRegistro: number;
  observacao?: string;
}

export interface VisitanteDetalhes {
  visitante: {
    id: number;
    nome: string;
    doc_identificacao: string | null;
    foto_pessoa: string | null;
    foto_documento: string | null;
    is_visitante: number | null;
    is_prestador: number | null;
    id_apartamento: number;
    blocoAptoAtual: string | null;
    face_id: string | null;
    face_sync_status: string | null;
    condominio: {
      nome: string;
      enderecoRel: {
        cep: string | null;
        rua: string | null;
        numero: string | null;
        complemento: string | null;
        bairro: string | null;
        cidade: string | null;
        uf: string | null;
      } | null;
    } | null;
    criadoPor: string | null;
    data_hora_inicio: string | null;
    data_hora_termino: string | null;
    codigo_acesso: string | null;
    data_entrada: string | null;
    data_saida: string | null;
    tag_rfid: string | null;
    dias_semana?: string | null;
    categorias?: string | null;
    created_at: string;
  };
  stats: {
    totalEntradas: number;
    totalSaidas: number;
    totalNegados: number;
    primeiraVisita: string | null;
    ultimaVisita: string | null;
    acessosFaciais: number;
    acessosPin: number;
    tempoMedioMs: number | null;
    permanenciaCount: number;
    apartamentosVisitados: { id: number; blocoApto: string; visitas: number }[];
  };
  timeline: VisitanteTimelineEntry[];
}

export interface PessoaEncontrada {
  id: number;
  nome: string;
  doc_identificacao: string | null;
  foto_pessoa: string | null;
  foto_documento: string | null;
  face_id: string | null;
  face_sync_status: string | null;
  face_enrolled_at: string | null;
  totalVisitasAnteriores: number;
}

/** 1 pessoa = 1 linha. Substitui Visitante[] na página /visitantes. */
export interface Pessoa {
  id: number; // id do registro principal (compatível com endpoints antigos)
  nome: string;
  doc_identificacao: string | null;
  foto_pessoa: string | null;
  foto_documento: string | null;
  is_visitante: number | null;
  is_prestador: number | null;
  face_id: string | null;
  face_sync_status: string | null;

  noLocal: boolean;
  temPinAtivo: boolean;
  statusLabel: 'No condomínio' | 'Liberado' | 'Agendado' | 'Histórico';
  liberado?: number;

  totalVisitas: number;
  visitasAnteriores: number;
  apartamentosVisitados: { id: number; label: string }[];

  id_apartamento: number;
  apartamentoAtual: string | null;

  // tag_rfid herdada do registro principal (não é alias — é dado real)
  tag_rfid?: string | null;
  dias_semana?: string | null;
  categorias?: string | null;

  ultEntrada: string | null;
  ultSaida: string | null;
  data_entrada: string | null;
  data_saida: string | null;
  data_hora_inicio: string | null;
  data_hora_termino: string | null;
  codigo_acesso: string | null;

  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class VisitantesService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return `${API_BASE}/condominios/${cid}/visitantes`;
  }

  /**
   * Lista bruta de TODOS os registros de visita (não agrega por pessoa).
   * Usado por componentes externos que precisam de pickers — ex:
   * /prestadores/relacionar-visita, /simulador-dispositivos. NÃO usar na
   * página principal /visitantes (use listarPessoas, agregado por pessoa).
   */
  list(search?: string): Observable<Visitante[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    return this.http.get<Visitante[]>(this.base, { params });
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

  /**
   * Cria um cadastro novo (pessoa + 1ª visita ao mesmo tempo). Mapeia para
   * POST /condominios/:id/visitantes — quando o operador cadastra uma
   * pessoa que NÃO existe no condomínio.
   *
   * Para reutilizar identidade de pessoa já cadastrada, prefira
   * novaVisitaPessoa() — endpoint dedicado que herda foto/face_id.
   */
  create(dto: CreateVisitante): Observable<Visitante> {
    return this.http.post<Visitante>(this.base, dto);
  }

  detalhes(id: number): Observable<VisitanteDetalhes> {
    return this.http.get<VisitanteDetalhes>(`${this.base}/${id}/detalhes`);
  }

  buscarPessoa(doc?: string, nome?: string): Observable<PessoaEncontrada | null> {
    let params = new HttpParams();
    if (doc) params = params.set('doc', doc);
    if (nome) params = params.set('nome', nome);
    return this.http.get<PessoaEncontrada | null>(`${this.base}/buscar/pessoa`, { params });
  }

  listarPessoas(search?: string): Observable<Pessoa[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    return this.http.get<Pessoa[]>(`${this.base}/pessoas`, { params });
  }

  novaVisitaPessoa(
    idRef: number,
    dto: { id_apartamento: number; data_hora_inicio?: string; data_hora_termino?: string },
  ): Observable<Visitante> {
    return this.http.post<Visitante>(`${this.base}/pessoa/${idRef}/nova-visita`, dto);
  }

  atualizarPessoa(
    idRef: number,
    dto: Partial<{
      nome: string;
      doc_identificacao: string;
      foto_pessoa: string;
      foto_documento: string;
      is_visitante: number;
      is_prestador: number;
      tag_rfid: string | null;
      dias_semana?: string | null;
      categorias?: string | null;
    }>,
  ): Observable<{ ok: boolean; atualizados: number }> {
    return this.http.put<{ ok: boolean; atualizados: number }>(`${this.base}/pessoa/${idRef}`, dto);
  }

  removerPessoa(idRef: number): Observable<{ ok: boolean; removidos: number }> {
    return this.http.delete<{ ok: boolean; removidos: number }>(`${this.base}/pessoa/${idRef}`);
  }

  validarCodigo(codigo: string): Observable<any> {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return this.http.get<any>(`${API_BASE}/visitantes/validar/${codigo}`, {
      params: new HttpParams().set('id_condominio', cid.toString())
    });
  }

  checkIn(id: number): Observable<any> {
    return this.http.post<any>(`${API_BASE}/visitantes/check-in`, { id });
  }

  liberar(id: number): Observable<any> {
    return this.http.post<any>(`${API_BASE}/visitantes/liberar`, { id });
  }

  checkOut(id: number): Observable<any> {
    return this.http.post<any>(`${API_BASE}/visitantes/check-out`, { id });
  }
}
