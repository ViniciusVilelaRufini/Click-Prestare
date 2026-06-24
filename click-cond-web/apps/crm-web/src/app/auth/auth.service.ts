import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';

export interface AdminInfo {
  access_token: string;
  id: number;
  nome: string;
  role: string;
}

const TOKEN_KEY = 'crm_token';
const INFO_KEY = 'crm_info';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private _info = signal<Omit<AdminInfo, 'access_token'> | null>(this._loadInfo());

  readonly adminInfo = this._info.asReadonly();
  readonly isLoggedIn = computed(() => !!this._info() && !!this.token);

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  login(login: string, senha: string) {
    return this.http
      .post<AdminInfo>('/api/crm/auth/login', { login, senha })
      .pipe(
        tap((res) => {
          localStorage.setItem(TOKEN_KEY, res.access_token);
          const info = { id: res.id, nome: res.nome, role: res.role };
          localStorage.setItem(INFO_KEY, JSON.stringify(info));
          this._info.set(info);
        }),
      );
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(INFO_KEY);
    this._info.set(null);
    this.router.navigate(['/login']);
  }

  private _loadInfo(): Omit<AdminInfo, 'access_token'> | null {
    try {
      const raw = localStorage.getItem(INFO_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}
