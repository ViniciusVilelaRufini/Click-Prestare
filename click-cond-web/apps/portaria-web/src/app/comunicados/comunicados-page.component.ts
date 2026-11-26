import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { ServerClockService } from '../core/server-clock.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Comunicado, ComunicadosApi, CreateComunicado } from './comunicados.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';
import { papelDoToken } from '../auth/papel';

@Component({
  selector: 'app-comunicados-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comunicados-page.component.html',
})
export class ComunicadosPageComponent implements OnInit {
  private api = inject(ComunicadosApi);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);
  private relogio = inject(ServerClockService);

  readonly comunicados = signal<Comunicado[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  showForm = false;
  editingId: number | null = null;
  form: CreateComunicado = { titulo: '', descricao: '' };

  /**
   * Resposta de `comunicados/acesso` (null: ainda não respondeu). O funcionário
   * do app sem a flag `comunicados` passa pelo papel, mas a API o recusa.
   */
  readonly gerenciar = signal<boolean | null>(null);

  /**
   * Publicar, editar e excluir é do síndico e do funcionário do app com a
   * permissão `comunicados` (inclusive no console por QR Code): a API recusa o
   * porteiro de login/senha (assertStaff) e o funcionário sem a flag, que viam
   * os botões e tomavam 403. O papel vem do token — o `turno` é texto livre do
   * cadastro do porteiro — e a flag, da API. A API segue decidindo.
   */
  readonly podePublicar = computed(() => {
    this.auth.porteiroInfo(); // recalcula ao entrar / trocar de condomínio
    return this.ehEquipe() && this.gerenciar() === true;
  });

  private ehEquipe(): boolean {
    const papel = papelDoToken(this.auth.token);
    return papel === 'sindico' || papel === 'funcionario';
  }

  /** Condomínio da sessão: trocar de condomínio reconsulta a permissão. */
  private readonly idCondominio = computed(() => this.auth.porteiroInfo()?.id_condominio ?? null);
  /** Só a resposta da consulta mais recente vale (troca de condomínio no meio). */
  private consultaAcesso = 0;
  /** `?novo=true` chegou antes da resposta de `acesso`: decide quando ela chegar. */
  private novoPendente = false;

  constructor() {
    effect(() => {
      this.idCondominio();
      untracked(() => this.carregarAcesso());
    });
  }

  readonly ultimo = computed(() => this.comunicados()[0] ?? null);
  readonly recentes = computed(
    () => this.comunicados().filter((c) => this.isRecent(c)).length,
  );

  ngOnInit() {
    this.carregar();
    this.route.queryParams.subscribe((params) => {
      if (params['novo'] === 'true') {
        if (this.gerenciar() === null) this.novoPendente = true;
        else this.abrirNovo();
      }
    });
  }

  /** Porteiro nem pergunta (só leitura). Falha na consulta: vale o papel, e a API decide no salvar. */
  carregarAcesso() {
    const n = ++this.consultaAcesso;
    if (!this.ehEquipe()) {
      this.aplicarAcesso(false);
      return;
    }
    this.gerenciar.set(null);
    this.api.acesso().subscribe({
      next: (r) => n === this.consultaAcesso && this.aplicarAcesso(r?.gerenciar === true),
      error: (e) => {
        if (n !== this.consultaAcesso) return;
        console.warn('Permissão de comunicados não consultada:', e?.error?.message ?? e?.message);
        this.aplicarAcesso(true);
      },
    });
  }

  private aplicarAcesso(gerenciar: boolean) {
    this.gerenciar.set(gerenciar);
    // Drawer aberto no condomínio anterior, sem permissão neste: fecha.
    if (!this.podePublicar() && this.showForm) this.cancelar();
    if (this.novoPendente) {
      this.novoPendente = false;
      this.abrirNovo();
    }
  }

  carregar() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (data) => {
        this.comunicados.set(data);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.message ?? 'Falha ao carregar comunicados.');
        this.loading.set(false);
      },
    });
  }

  abrirNovo() {
    if (!this.podePublicar()) return;
    this.editingId = null;
    this.form = { titulo: '', descricao: '' };
    this.error.set(null);
    this.showForm = true;
  }

  abrirEditar(c: Comunicado) {
    this.editingId = c.id;
    this.form = { titulo: c.titulo, descricao: c.descricao ?? '' };
    this.error.set(null);
    this.showForm = true;
  }

  cancelar() {
    this.showForm = false;
    this.editingId = null;
    this.error.set(null);
  }

  salvar() {
    if (!this.form.titulo?.trim()) {
      this.error.set('Título é obrigatório.');
      return;
    }
    const payload: CreateComunicado = {
      titulo: this.form.titulo.trim(),
      descricao: this.form.descricao?.trim() ?? '',
    };
    this.saving.set(true);
    const obs = this.editingId
      ? this.api.update(this.editingId, payload)
      : this.api.create(payload);

    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelar();
        this.carregar();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(e?.error?.message ?? e?.message ?? 'Falha ao salvar comunicado.');
      },
    });
  }

  async remover(c: Comunicado) {
    const ok = await this.confirm.ask({
      title: 'Excluir comunicado',
      message: `O comunicado "${c.titulo}" será removido permanentemente.`,
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.remove(c.id).subscribe({
      next: () => this.carregar(),
      error: (e) =>
        this.error.set(e?.error?.message ?? 'Falha ao excluir comunicado.'),
    });
  }

  isRecent(c: Comunicado): boolean {
    const created = new Date(c.created_at).getTime();
    return this.relogio.agora().getTime() - created < 7 * 86400000;
  }
}
