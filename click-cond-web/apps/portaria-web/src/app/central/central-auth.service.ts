import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, Subject, tap, throwError } from 'rxjs';
import { API_BASE } from '../shared/api.config';

/** Chave própria: a sessão do operador nunca se mistura com a do porteiro/síndico (`portaria_token`). */
export const CENTRAL_TOKEN_KEY = 'central_token';
export const SENHA_MIN = 10;

export interface OperadorCentral {
  nome: string;
  /** Senha temporária ainda não trocada: nenhuma rota da central vale até trocar. */
  trocar_senha: boolean;
}

export interface DesafioLogin {
  desafio: string;
  email_mascarado: string;
}

interface RespostaToken {
  access_token: string;
  nome: string;
  trocar_senha?: boolean;
}

interface PayloadCentral {
  sub?: unknown;
  nome?: unknown;
  papel?: unknown;
  exp?: unknown;
  trocar_senha?: unknown;
  id_condominio?: unknown;
}

function lerPayload(token: string | null): PayloadCentral | null {
  if (!token) return null;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const p = JSON.parse(json);
    return p && typeof p === 'object' ? (p as PayloadCentral) : null;
  } catch {
    return null;
  }
}

/** Token de operador da central, bem formado e dentro da validade (a assinatura quem confere é a API). */
export function tokenCentralValido(token: string | null, agoraMs = Date.now()): boolean {
  const p = lerPayload(token);
  if (!p || p.papel !== 'operador_central' || p.id_condominio) return false;
  if (typeof p.exp === 'number' && p.exp * 1000 <= agoraMs) return false;
  return true;
}

function lerToken(): string | null {
  try {
    return localStorage.getItem(CENTRAL_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Sessão do operador da central: senha → código por e-mail → token (`papel: 'operador_central'`, sem
 * condomínio). Fica em `central_token` no localStorage. Depois da troca de senha a API devolve outro
 * token (o antigo deixa de valer, inclusive no socket): `tokenRenovado$` avisa o CentralRealtimeService.
 */
@Injectable({ providedIn: 'root' })
export class CentralAuthService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE}/central/auth`;

  private readonly _operador = signal<OperadorCentral | null>(null);
  readonly operador = this._operador.asReadonly();
  readonly logado = computed(() => !!this._operador());
  /** Token novo da mesma sessão (troca de senha): quem mantém socket aberto reconecta. */
  readonly tokenRenovado$ = new Subject<string>();

  constructor() {
    this.recarregar();
  }

  get token(): string | null {
    return lerToken();
  }

  /** Relê o token guardado (vencido ou de outro papel: apaga). */
  recarregar(): void {
    const t = lerToken();
    if (!tokenCentralValido(t)) {
      if (t) this.apagar();
      this._operador.set(null);
      return;
    }
    const p = lerPayload(t)!;
    this._operador.set({ nome: String(p.nome ?? '').trim(), trocar_senha: !!p.trocar_senha });
  }

  /** A sessão ainda vale agora (o guard confere a cada navegação). */
  sessaoValida(): boolean {
    const ok = tokenCentralValido(lerToken());
    if (!ok) {
      if (lerToken()) this.apagar();
      this._operador.set(null);
    } else if (!this._operador()) {
      this.recarregar();
    }
    return ok;
  }

  login(email: string, senha: string): Observable<DesafioLogin> {
    return this.http.post<DesafioLogin>(`${this.base}/login`, { email: String(email ?? '').trim(), senha });
  }

  verificar(desafio: string, codigo: string): Observable<RespostaToken> {
    return this.http
      .post<RespostaToken>(`${this.base}/verificar`, { desafio, codigo: String(codigo ?? '').trim() })
      .pipe(tap((r) => this.gravar(r)));
  }

  trocarSenha(atual: string, nova: string): Observable<RespostaToken> {
    if (String(nova ?? '').length < SENHA_MIN) {
      return throwError(() => new Error(`A senha nova precisa ter pelo menos ${SENHA_MIN} caracteres.`));
    }
    const t = lerToken();
    const headers = t ? new HttpHeaders({ Authorization: `Bearer ${t}` }) : undefined;
    return this.http
      .post<RespostaToken>(`${this.base}/senha`, { senha_atual: atual, senha_nova: nova }, { headers })
      .pipe(
        tap((r) => {
          this.gravar({ ...r, trocar_senha: false });
          if (r?.access_token) this.tokenRenovado$.next(r.access_token);
        }),
      );
  }

  /** A API respondeu 403 `trocar_senha`: a página troca para a tela de troca de senha. */
  marcarTrocarSenha(): void {
    const o = this._operador();
    if (o) this._operador.set({ ...o, trocar_senha: true });
  }

  logout(): void {
    this.apagar();
    this._operador.set(null);
  }

  /** Texto em pt-BR para os erros do login e do código. */
  static mensagemDeErro(e: unknown, etapa: 'login' | 'codigo' | 'senha' = 'login'): string {
    const err = e as HttpErrorResponse | Error | null;
    const status = (err as HttpErrorResponse)?.status;
    if (status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    if (status === 401 || status === 400 || status === 403) {
      if (etapa === 'codigo') return 'Código inválido ou vencido. Confira o e-mail ou entre de novo.';
      if (etapa === 'senha') {
        const m = (err as HttpErrorResponse)?.error?.message;
        return typeof m === 'string' && m.trim() ? m : 'Senha atual incorreta.';
      }
      return 'E-mail ou senha incorretos.';
    }
    if (status === 0) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    if (err instanceof Error && !(err instanceof HttpErrorResponse) && err.message) return err.message;
    return 'Não foi possível concluir agora. Tente de novo.';
  }

  private gravar(r: RespostaToken): void {
    if (!r?.access_token) return;
    try {
      localStorage.setItem(CENTRAL_TOKEN_KEY, r.access_token);
    } catch {
      /* sem storage: a sessão vale só nesta aba */
    }
    const p = lerPayload(r.access_token);
    this._operador.set({
      nome: String(r.nome ?? p?.nome ?? '').trim(),
      trocar_senha: r.trocar_senha === undefined ? !!p?.trocar_senha : !!r.trocar_senha,
    });
  }

  private apagar(): void {
    try {
      localStorage.removeItem(CENTRAL_TOKEN_KEY);
    } catch {
      /* sem storage */
    }
  }
}
