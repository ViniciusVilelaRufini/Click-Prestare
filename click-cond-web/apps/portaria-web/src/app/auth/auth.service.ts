import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';

export interface PorteiroInfo {
  access_token: string;
  id?: number;
  nome: string;
  turno: string | null;
  id_condominio: number;
  condominio_nome?: string;
}

const TOKEN_KEY = 'portaria_token';
const INFO_KEY = 'portaria_info';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private _info = signal<Omit<PorteiroInfo, 'access_token'> | null>(
    this._loadInfo(),
  );

  readonly porteiroInfo = this._info.asReadonly();
  readonly isLoggedIn = computed(() => !!this._info() && !!this.token);
  readonly condominioNome = signal<string>('Carregando...');

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  constructor() {
    const saved = this._info();
    if (saved) {
      if (saved.condominio_nome) {
        this.condominioNome.set(saved.condominio_nome);
      } else {
        this.buscarCondominioNome(saved.id_condominio);
      }
    }
  }

  buscarCondominioNome(id: number) {
    this.http.get<{ nome: string }>(`/api/auth/condominio/${id}`).subscribe({
      next: (res) => {
        this.condominioNome.set(res.nome);
        const info = this._info();
        if (info) {
          const updated = { ...info, condominio_nome: res.nome };
          localStorage.setItem(INFO_KEY, JSON.stringify(updated));
          this._info.set(updated);
        }
      },
      error: () => this.condominioNome.set('Click Condomínio')
    });
  }

  login(login: string, senha: string) {
    return this.http
      .post<PorteiroInfo>('/api/auth/login-portaria', { login, senha })
      .pipe(
        tap((res) => {
          localStorage.setItem(TOKEN_KEY, res.access_token);
          const info = {
            id: res.id,
            nome: res.nome,
            turno: res.turno,
            id_condominio: res.id_condominio,
            condominio_nome: res.condominio_nome
          };
          localStorage.setItem(INFO_KEY, JSON.stringify(info));
          this._info.set(info);
          if (res.condominio_nome) {
            this.condominioNome.set(res.condominio_nome);
          }
        }),
      );
  }

  loginComToken(res: PorteiroInfo) {
    localStorage.setItem(TOKEN_KEY, res.access_token);
    const info = {
      id: res.id,
      nome: res.nome,
      turno: res.turno,
      id_condominio: res.id_condominio,
      condominio_nome: res.condominio_nome
    };
    localStorage.setItem(INFO_KEY, JSON.stringify(info));
    this._info.set(info);
    if (res.condominio_nome) {
      this.condominioNome.set(res.condominio_nome);
    }
  }

  alterarSenha(senhaAtual: string, novaSenha: string) {
    // O id NÃO é mais enviado: o backend identifica o funcionário pelo JWT.
    return this.http.post<{ success: boolean; message: string }>('/api/auth/change-password', {
      senhaAtual,
      novaSenha
    });
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(INFO_KEY);
    this._info.set(null);
    this.router.navigate(['/login']);
  }

  private _loadInfo(): Omit<PorteiroInfo, 'access_token'> | null {
    try {
      const raw = localStorage.getItem(INFO_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}