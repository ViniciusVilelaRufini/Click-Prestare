import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  Categoria, CreateOcorrencia, FuncionarioAtribuivel, Ocorrencia, OcorrenciaStatus, OcorrenciasApi, OcorrenciaMensagem,
} from './ocorrencias.service';
import { ConfirmService } from '../shared/confirm.service';

@Component({
  selector: 'app-ocorrencias-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ocorrencias-page.component.html',
})
export class OcorrenciasPageComponent implements OnInit, OnDestroy {
  private api = inject(OcorrenciasApi);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);

  readonly ocorrencias = signal<Ocorrencia[]>([]);
  readonly categorias = signal<Categoria[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly filtroStatus = signal<string>('');

  readonly selectedOcorrencia = signal<Ocorrencia | null>(null);
  readonly mensagens = signal<OcorrenciaMensagem[]>([]);
  readonly loadingMensagens = signal(false);
  novaMensagemText = '';
  editingRespostaId: number | null = null;
  tempRespostaText = '';

  readonly ocorrenciasFiltradas = computed(() => {
    const list = this.ocorrencias();
    const f = this.filtroStatus();
    if (!f) return list;
    return list.filter(o => o.status === f);
  });

  readonly stats = computed(() => {
    const list = this.ocorrencias();
    return {
      total: list.length,
      pendentes: list.filter((o) => o.status === 'Pendente').length,
      cientes: list.filter((o) => o.status === 'Ciente').length,
      solucionadas: list.filter((o) => o.status === 'Solucionado').length,
    };
  });

  novo: CreateOcorrencia = { descricao: '', tipo: 0 };
  showForm = false;

  // Mini-helpdesk: funcionários atribuíveis + gestão de categorias/SLA.
  readonly funcionarios = signal<FuncionarioAtribuivel[]>([]);
  showCategorias = false;
  catForm: { id?: number; nome: string; prioridade: number; sla_horas: number | null } =
    { nome: '', prioridade: 0, sla_horas: null };

  chatInterval: any = null;
  ocorrenciasInterval: any = null;

  ngOnInit() {
    this.recarregarCategorias();
    this.api.funcionarios().subscribe({ next: (f) => this.funcionarios.set(f), error: () => {} });
    this.carregar();
    this.route.queryParams.subscribe((params) => {
      if (params['novo'] === 'true') {
        this.showForm = true;
      }
    });

    // Atualiza a listagem de ocorrencias a cada 10 segundos em segundo plano
    this.ocorrenciasInterval = setInterval(() => {
      this.carregarSilenciosamente();
    }, 10000);
  }

  carregar() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (data) => { this.ocorrencias.set(data); this.loading.set(false); },
      error: (e) => { this.error.set(e?.message ?? 'Erro'); this.loading.set(false); },
    });
  }

  carregarSilenciosamente() {
    this.api.list().subscribe({
      next: (data) => { this.ocorrencias.set(data); },
      error: (e) => console.error('Erro ao recarregar ocorrencias em background:', e)
    });
  }

  registrar() {
    if (!this.novo.descricao?.trim() || !this.novo.tipo) {
      this.error.set('Descrição e categoria são obrigatórios.');
      return;
    }
    this.api.create(this.novo).subscribe({
      next: () => {
        this.showForm = false;
        this.novo = { descricao: '', tipo: this.categorias()[0]?.id ?? 0 };
        this.carregar();
      },
      error: (e) => this.error.set(e?.message ?? 'Erro'),
    });
  }

  async mudarStatus(o: Ocorrencia, status: OcorrenciaStatus) {
    const prioridade = this.prioridadeCategoria(o.tipo);
    const isCritica = prioridade <= 1;

    const ok = await this.confirm.ask({
      title: isCritica ? '⚠️ Alteração em Ocorrência CRÍTICA' : 'Confirmar alteração de status',
      message: isCritica 
        ? `Você tem certeza que deseja alterar o status desta ocorrência de prioridade CRÍTICA para "${status}"?`
        : `Deseja alterar o status da ocorrência para "${status}"?`,
      confirmLabel: 'Alterar',
      variant: isCritica ? 'danger' : 'primary',
    });

    if (!ok) return;

    this.api.updateStatus(o.id, status).subscribe({ next: () => this.carregar() });
  }

  async remover(o: Ocorrencia) {
    const ok = await this.confirm.ask({
      title: 'Remover ocorrência',
      message: 'A ocorrência será removida do histórico.',
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.remove(o.id).subscribe({ next: () => this.carregar() });
  }

  statusBadge(s: OcorrenciaStatus) {
    if (s === 'Pendente') return { bg: 'bg-amber-400/10', border: 'border-amber-400/20', text: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' };
    if (s === 'Ciente')   return { bg: 'bg-accent/10',    border: 'border-accent/20',    text: 'text-accent',    dot: 'bg-accent' };
    return { bg: 'bg-emerald-400/10', border: 'border-emerald-400/20', text: 'text-emerald-400', dot: 'bg-emerald-400' };
  }

  prioridadeCategoria(catId: number): number {
    return this.categorias().find((c) => c.id === catId)?.prioridade ?? 999;
  }

  prioridadeLabel(p: number): { label: string; color: string } {
    if (p <= 1) return { label: 'Crítica', color: 'text-red-400' };
    if (p <= 2) return { label: 'Alta', color: 'text-amber-400' };
    if (p <= 3) return { label: 'Média', color: 'text-accent' };
    return { label: 'Baixa', color: 'text-slate-400' };
  }

  ngOnDestroy() {
    this.limparIntervaloChat();
    this.limparIntervaloOcorrencias();
  }

  limparIntervaloChat() {
    if (this.chatInterval) {
      clearInterval(this.chatInterval);
      this.chatInterval = null;
    }
  }

  limparIntervaloOcorrencias() {
    if (this.ocorrenciasInterval) {
      clearInterval(this.ocorrenciasInterval);
      this.ocorrenciasInterval = null;
    }
  }


  abrirChat(o: Ocorrencia) {
    this.limparIntervaloChat();
    this.selectedOcorrencia.set(o);
    this.loadingMensagens.set(true);
    this.api.listMessages(o.id).subscribe({
      next: (msgs) => {
        this.mensagens.set(msgs);
        this.loadingMensagens.set(false);
        this.scrollChatParaFim();
      },
      error: () => this.loadingMensagens.set(false),
    });

    // Atualiza silenciosamente a cada 1.5 segundos
    this.chatInterval = setInterval(() => {
      this.atualizarMensagensSilenciosamente(o.id);
    }, 1500);
  }

  fecharChat() {
    this.limparIntervaloChat();
    this.selectedOcorrencia.set(null);
    this.mensagens.set([]);
  }

  atualizarMensagensSilenciosamente(idOcorrencia: number) {
    this.api.listMessages(idOcorrencia).subscribe({
      next: (msgs) => {
        // Apenas atualiza e rola se o tamanho da lista mudar
        if (msgs.length !== this.mensagens().length) {
          this.mensagens.set(msgs);
          this.scrollChatParaFim();
        }
      },
    });
  }

  enviarMensagem() {
    const o = this.selectedOcorrencia();
    const txt = this.novaMensagemText.trim();
    if (!o || !txt) return;

    this.api.sendMessage(o.id, txt).subscribe({
      next: (msg) => {
        this.mensagens.update((curr) => [...curr, msg]);
        this.novaMensagemText = '';
        this.scrollChatParaFim();
      },
    });
  }

  scrollChatParaFim() {
    setTimeout(() => {
      const container = document.getElementById('chat-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
  }

  alternarPublica(o: Ocorrencia) {
    const novoValor = !o.publica;
    this.api.updatePublica(o.id, novoValor).subscribe({
      next: (updated) => {
        o.publica = updated.publica;
        this.carregar();
      }
    });
  }

  iniciarEdicaoResposta(o: Ocorrencia) {
    this.editingRespostaId = o.id;
    this.tempRespostaText = o.resposta || '';
  }

  cancelarEdicaoResposta() {
    this.editingRespostaId = null;
    this.tempRespostaText = '';
  }

  salvarResposta(o: Ocorrencia) {
    if (!this.tempRespostaText.trim()) return;
    this.api.updateResposta(o.id, this.tempRespostaText.trim()).subscribe({
      next: (updated) => {
        o.resposta = updated.resposta;
        o.resposta_at = updated.resposta_at;
        this.cancelarEdicaoResposta();
        this.carregar();
      }
    });
  }

  recarregarCategorias() {
    this.api.categorias().subscribe({
      next: (cats) => {
        this.categorias.set(cats);
        if (cats.length > 0 && !this.novo.tipo) this.novo.tipo = cats[0].id;
      },
    });
  }

  // ----- Atribuição de responsável -----
  atribuir(o: Ocorrencia, idResponsavelRaw: any) {
    const idResponsavel = idResponsavelRaw === '' || idResponsavelRaw == null ? null : Number(idResponsavelRaw);
    this.api.atribuir(o.id, idResponsavel).subscribe({
      next: () => this.carregar(),
      error: (e) => this.error.set(e?.message ?? 'Erro ao atribuir'),
    });
  }

  // ----- Selo de SLA (no prazo / atrasada / sem prazo) -----
  slaInfo(o: Ocorrencia): { label: string; classes: string } | null {
    const s = (o.status ?? '').toLowerCase();
    if (s === 'solucionado' || s === 'resolvida') {
      return { label: 'Concluída', classes: 'bg-slate-400/10 border-slate-400/20 text-slate-400' };
    }
    if (!o.prazo) {
      return { label: 'Sem prazo', classes: 'bg-slate-400/10 border-slate-400/20 text-slate-400' };
    }
    const prazo = new Date(o.prazo);
    if (isNaN(prazo.getTime())) return null;
    const now = new Date();
    if (now.getTime() > prazo.getTime()) {
      return { label: 'Atrasada', classes: 'bg-red-400/10 border-red-400/20 text-red-400' };
    }
    const diffH = Math.floor((prazo.getTime() - now.getTime()) / 3600000);
    const label = diffH >= 48 ? `Vence em ${Math.floor(diffH / 24)}d`
      : diffH >= 1 ? `Vence em ${diffH}h`
      : `Vence em ${Math.max(1, Math.floor((prazo.getTime() - now.getTime()) / 60000))}min`;
    const classes = diffH >= 24
      ? 'bg-emerald-400/10 border-emerald-400/20 text-emerald-400'
      : 'bg-amber-400/10 border-amber-400/20 text-amber-400';
    return { label, classes };
  }

  // ----- Gestão de categorias / SLA -----
  abrirCategorias() { this.showCategorias = true; this.resetCatForm(); this.recarregarCategorias(); }
  fecharCategorias() { this.showCategorias = false; }
  resetCatForm() { this.catForm = { nome: '', prioridade: 0, sla_horas: null }; }
  editarCategoria(c: Categoria) {
    this.catForm = { id: c.id, nome: c.nome, prioridade: c.prioridade, sla_horas: c.sla_horas ?? null };
  }

  salvarCategoria() {
    const f = this.catForm;
    if (!f.nome?.trim()) { this.error.set('Informe o nome da categoria.'); return; }
    const dto = { nome: f.nome.trim(), prioridade: Number(f.prioridade) || 0, sla_horas: f.sla_horas === null || (f.sla_horas as any) === '' ? null : Number(f.sla_horas) };
    const req = f.id ? this.api.atualizarCategoria(f.id, dto) : this.api.criarCategoria(dto);
    req.subscribe({
      next: () => { this.resetCatForm(); this.recarregarCategorias(); },
      error: (e) => this.error.set(e?.message ?? 'Erro ao salvar categoria'),
    });
  }

  async removerCategoria(c: Categoria) {
    const ok = await this.confirm.ask({
      title: 'Remover categoria',
      message: `Remover "${c.nome}"? Ocorrências existentes não são apagadas.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.removerCategoria(c.id).subscribe({
      next: () => { if (this.catForm.id === c.id) this.resetCatForm(); this.recarregarCategorias(); },
      error: (e) => this.error.set(e?.message ?? 'Erro ao remover categoria'),
    });
  }
}
