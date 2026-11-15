import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../auth/auth.service';
import { ConfirmService } from '../../shared/confirm.service';
import { API_BASE } from '../../shared/api.config';

/** Login de portaria como a API devolve (GET condominios/:id/portaria/equipe). */
export interface LoginPortaria {
  id: number;
  nome: string;
  login: string;
  email: string;
  telefone: string;
  turno: string;
  ativo: boolean;
  ultimo_acesso: string | null;
  origem: 'app' | 'prestador';
  prestador: { id: number; nome: string } | null;
  /** O e-mail é de um prestador, mas o cadastro dele não reconhece mais este login (turno e nome mudados no app). */
  email_de_prestador: boolean;
  sindico: boolean;
  voce: boolean;
}

/** Texto da confirmação de desativar (o que acontece, e como volta). */
export function avisoDesativar(nome: string): string {
  return `${nome} deixa de entrar no console e no app como funcionário deste condomínio até ser reativado. ` +
    'A sessão aberta cai em até 30 segundos. Para devolver o acesso, use Ativar.';
}

/**
 * Aba "Equipe da portaria" das Configurações, só do síndico (a API exige assertSindicoEstrito). Mostra os logins de
 * portaria do condomínio — os do app e os dados pelo cadastro de prestador — e deixa ativar/desativar e mudar o turno.
 * Criar e excluir continuam pelo app do síndico e pelo cadastro de prestador.
 */
@Component({
  selector: 'app-equipe-portaria',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './equipe-portaria.component.html',
})
export class EquipePortariaComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmService);

  readonly carregando = signal(false);
  readonly equipe = signal<LoginPortaria[]>([]);
  readonly erroLista = signal<string | null>(null);
  readonly erro = signal<string | null>(null);
  /** Id da linha com uma gravação em andamento. */
  readonly salvando = signal<number | null>(null);
  /** Id da linha com o turno em edição. */
  readonly editandoTurno = signal<number | null>(null);
  turnoEditado = '';

  ngOnInit() {
    this.carregar();
  }

  private url(): string | null {
    const id = this.auth.porteiroInfo()?.id_condominio;
    return id ? `${API_BASE}/condominios/${id}/portaria/equipe` : null;
  }

  carregar() {
    const url = this.url();
    if (!url) return;
    this.carregando.set(true);
    this.erroLista.set(null);
    this.http.get<LoginPortaria[]>(url).subscribe({
      next: (lista) => {
        this.equipe.set(lista ?? []);
        this.carregando.set(false);
      },
      error: (e: any) => {
        this.carregando.set(false);
        this.erroLista.set(e?.error?.message ?? e?.message ?? 'Não foi possível carregar a equipe da portaria.');
      },
    });
  }

  async alternarAtivo(f: LoginPortaria) {
    if (this.salvando() !== null) return;
    const novo = !f.ativo;
    if (!novo) {
      const ok = await this.confirm.ask({
        title: `Desativar o acesso de ${f.nome}?`,
        message: avisoDesativar(f.nome),
        confirmLabel: 'Desativar',
        variant: 'danger',
      });
      if (!ok) return;
    }
    this.gravar(f, { ativo: novo });
  }

  editarTurno(f: LoginPortaria) {
    this.erro.set(null);
    this.turnoEditado = f.turno ?? '';
    this.editandoTurno.set(f.id);
  }

  cancelarTurno() {
    this.editandoTurno.set(null);
    this.turnoEditado = '';
  }

  salvarTurno(f: LoginPortaria) {
    const turno = (this.turnoEditado ?? '').replace(/\s+/g, ' ').trim();
    if (!turno) {
      this.erro.set('Informe o turno.');
      return;
    }
    if (turno === f.turno) {
      this.cancelarTurno();
      return;
    }
    this.gravar(f, { turno }, () => this.cancelarTurno());
  }

  private gravar(f: LoginPortaria, body: { ativo?: boolean; turno?: string }, depois?: () => void) {
    const url = this.url();
    if (!url) return;
    this.erro.set(null);
    this.salvando.set(f.id);
    this.http.patch<{ id: number; ativo: boolean; turno: string; nome?: string }>(`${url}/${f.id}`, body).subscribe({
      next: (r) => {
        this.salvando.set(null);
        this.equipe.update((l) =>
          l.map((x) => (x.id === f.id ? { ...x, ativo: !!r?.ativo, turno: r?.turno ?? x.turno, nome: r?.nome ?? x.nome } : x)),
        );
        depois?.();
      },
      error: (e: any) => {
        this.salvando.set(null);
        this.erro.set(e?.error?.message ?? e?.message ?? 'Não foi possível salvar. Tente de novo.');
      },
    });
  }
}
