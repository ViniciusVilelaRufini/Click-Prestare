import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';

export interface CondominioVinculo {
  id: number;
  nome: string;
}

export interface PorteiroInfo {
  access_token: string;
  id?: number;
  nome: string;
  turno: string | null;
  id_condominio: number;
  condominio_nome?: string;
  /** Preenchido apenas para síndico: todos os condomínios que ele administra. */
  condominios?: CondominioVinculo[];
}

/** Resposta do login quando o síndico precisa confirmar o código enviado por e-mail. */
export interface DesafioMfa {
  mfa_required: true;
  mfa_token: string;
  email_masked: string;
  expires_in_seconds: number;
}

export function ehDesafioMfa(res: PorteiroInfo | DesafioMfa): res is DesafioMfa {
  return (res as DesafioMfa)?.mfa_required === true;
}

const TOKEN_KEY = 'portaria_token';
const INFO_KEY = 'portaria_info';
/** Aparelho confiável do síndico (30 dias). Fica após o logout, como no app. */
const DEVICE_KEY = 'portaria_device_token';

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

  /** Condomínios do síndico logado (vazio para porteiro). */
  readonly condominios = computed<CondominioVinculo[]>(
    () => this._info()?.condominios ?? [],
  );
  readonly temMultiplosCondominios = computed(() => this.condominios().length > 1);

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
      .post<PorteiroInfo | DesafioMfa>('/api/auth/login-portaria', {
        login,
        senha,
        device_token: this._deviceToken() ?? undefined,
      })
      // Desafio de 2 etapas não é sessão: nada é gravado até o código ser confirmado.
      .pipe(tap((res) => { if (!ehDesafioMfa(res)) this._persist(res); }));
  }

  verificarMfa(mfaToken: string, code: string, lembrar: boolean) {
    return this.http
      .post<PorteiroInfo & { device_token?: string }>('/api/auth/login-portaria/mfa', {
        mfa_token: mfaToken,
        code,
        remember_device: lembrar,
      })
      .pipe(
        tap((res) => {
          if (res.device_token) {
            try { localStorage.setItem(DEVICE_KEY, res.device_token); } catch { /* sem storage: pede o código de novo */ }
          }
          this._persist(res);
        }),
      );
  }

  reenviarMfa(mfaToken: string) {
    return this.http.post<{ success: boolean; message: string }>('/api/auth/mfa/resend', { mfa_token: mfaToken });
  }

  private _deviceToken(): string | null {
    try {
      return localStorage.getItem(DEVICE_KEY);
    } catch {
      return null;
    }
  }

  loginComToken(res: PorteiroInfo) {
    this._persist(res);
  }

  /**
   * Troca o condomínio ativo do síndico. O backend emite um token novo com o
   * escopo escolhido — só trocar o nome na tela deixaria as consultas presas ao
   * condomínio anterior, que é o que o token carrega.
   */
  selecionarCondominio(idCondominio: number) {
    return this.http
      .post<PorteiroInfo>('/api/auth/selecionar-condominio', {
        id_condominio: idCondominio,
      })
      .pipe(
        // A resposta da troca não repete a lista de vínculos; preserva a atual
        // para o seletor continuar disponível.
        tap((res) => this._persist({ ...res, condominios: this.condominios() })),
      );
  }

  private _persist(res: PorteiroInfo) {
    localStorage.setItem(TOKEN_KEY, res.access_token);
    const info = {
      id: res.id,
      nome: res.nome,
      turno: res.turno,
      id_condominio: res.id_condominio,
      condominio_nome: res.condominio_nome,
      condominios: res.condominios,
    };
    localStorage.setItem(INFO_KEY, JSON.stringify(info));
    this._info.set(info);
    if (res.condominio_nome) {
      this.condominioNome.set(res.condominio_nome);
    }
  }

  alterarSenha(senhaAtual: string, novaSenha: string) {
    // O id NÃO é mais enviado: o backend identifica o funcionário pelo JWT.
    return this.http
      .post<{ success: boolean; message: string; access_token?: string }>('/api/auth/change-password', {
        senhaAtual,
        novaSenha,
      })
      // A troca de senha do síndico derruba as sessões anteriores; a API devolve o token que continua valendo.
      .pipe(tap((res) => { if (res?.access_token) localStorage.setItem(TOKEN_KEY, res.access_token); }));
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