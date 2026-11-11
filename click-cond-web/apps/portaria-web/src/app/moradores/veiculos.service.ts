import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface Tag {
  id: number;
  id_condominio: number;
  codigo: string;
  tipo: string;
  descricao: string | null;
  /** 1 = ativa, 0 = bloqueada (não abre no leitor, mas segue vinculada). */
  ativo?: number;
}

export interface Veiculo {
  id: number;
  id_morador: number;
  id_condominio: number;
  placa: string;
  cor: string | null;
  marca_modelo: string | null;
  id_tag: number | null;
  tag?: Tag | null;
}

export interface VeiculoComMorador extends Veiculo {
  morador?: { id: number; nome: string; bloco: string | null; apartamento: string | null } | null;
}

export interface CreateVeiculo {
  placa: string;
  cor?: string | null;
  marca_modelo?: string | null;
  id_tag?: number | null;
}

@Injectable({ providedIn: 'root' })
export class VeiculosApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get cid() {
    return this.auth.porteiroInfo()?.id_condominio ?? 1;
  }
  private get base() {
    return `${API_BASE}/condominios/${this.cid}`;
  }

  listByMorador(idMorador: number): Observable<Veiculo[]> {
    return this.http.get<Veiculo[]>(`${this.base}/moradores/${idMorador}/veiculos`);
  }

  /** Todos os veículos ativos do condomínio, com o morador titular — tela da portaria. */
  listAll(): Observable<VeiculoComMorador[]> {
    return this.http.get<VeiculoComMorador[]>(`${this.base}/veiculos`);
  }

  create(idMorador: number, dto: CreateVeiculo): Observable<Veiculo> {
    return this.http.post<Veiculo>(`${this.base}/moradores/${idMorador}/veiculos`, dto);
  }

  update(id: number, dto: CreateVeiculo): Observable<Veiculo> {
    return this.http.put<Veiculo>(`${this.base}/veiculos/${id}`, dto);
  }

  remove(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/veiculos/${id}`);
  }

  /**
   * Tags do condomínio. `livres` traz só as sem veículo ativo; `inativas`
   * inclui as bloqueadas (por padrão a API devolve só as ativas).
   */
  listTags(livres = false, inativas = false): Observable<Tag[]> {
    let params = new HttpParams();
    if (livres) params = params.set('livres', 'true');
    if (inativas) params = params.set('inativas', 'true');
    return this.http.get<Tag[]>(`${this.base}/tags`, { params });
  }

  createTag(dto: { codigo: string; tipo?: string; descricao?: string }): Observable<Tag> {
    return this.http.post<Tag>(`${this.base}/tags`, dto);
  }

  /** Bloqueia (`false`) ou reativa (`true`) a tag. */
  setTagAtivo(id: number, ativo: boolean): Observable<Tag> {
    return this.http.patch<Tag>(`${this.base}/tags/${id}`, { ativo });
  }

  /** Exclui a tag; a API a desvincula do veículo antes. */
  removeTag(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/tags/${id}`);
  }
}
