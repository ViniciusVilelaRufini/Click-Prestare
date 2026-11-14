import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  AcessoOcorrencias, Categoria, CreateOcorrencia, FuncionarioAtribuivel, Ocorrencia, OcorrenciaStatus, OcorrenciasApi,
  OcorrenciaMensagem,
} from './ocorrencias.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';

/** Categoria dos chamados abertos e fechados pelo monitor de dispositivos (facial.service). */
const CATEGORIA_DISPOSITIVOS = 'Dispositivos';

/** Mensagem do servidor quando houver; senão a do cliente; senão a padrão. */
function msgErro(e: any, padrao: string): string {
  const m = e?.error?.message ?? e?.message;
  return (Array.isArray(m) ? m.join(' ') : m) || padrao;
}
import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';

@Component({
  selector: 'app-ocorrencias-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SlideIndicatorDirective],
  templateUrl: './ocorrencias-page.component.html',
})
export class OcorrenciasPageComponent implements OnInit, OnDestroy {
  private api = inject(OcorrenciasApi);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);

  readonly ocorrencias = signal<Ocorrencia[]>([]);
  readonly categorias = signal<Categoria[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Erro de Registrar, mostrado dentro da gaveta (o painel da página fica atrás do scrim). */
  readonly formErro = signal<string | null>(null);
  /** Erro do chat, mostrado dentro da gaveta do chat. */
  readonly chatErro = signal<string | null>(null);
  /** Requisições em andamento: o botão fica desabilitado (sem duplo envio nem push duplicado). */
  readonly registrando = signal(false);
  readonly enviandoMensagem = signal(false);
  readonly salvandoResposta = signal(false);
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

  // Mini-helpdesk: funcionários atribuíveis + categorias/SLA (só leitura).
  readonly funcionarios = signal<FuncionarioAtribuivel[]>([]);
  readonly funcionariosCarregados = signal(false);
  showCategorias = false;

  /**
   * O que a sessão pode fazer (GET ocorrencias/acesso). Até a resposta chegar
   * nada de ação aparece — melhor que mostrar botão que vai dar 403.
   */
  readonly acesso = signal<AcessoOcorrencias>({ operar: false, administrar: false, conversar: false });

  chatInterval: any = null;
  ocorrenciasInterval: any = null;

  ngOnInit() {
    this.carregarAcesso();
    this.recarregarCategorias();
    this.api.funcionarios().subscribe({
      next: (f) => { this.funcionarios.set(f); this.funcionariosCarregados.set(true); },
      error: (e) => this.error.set(msgErro(e, 'Erro ao carregar os funcionários.')),
    });
    this.carregar();
    this.route.queryParams.subscribe((params) => {
      if (params['novo'] === 'true') {
        this.showForm = true;
      }
    });

    // Atualiza a listagem a cada 30 s em segundo plano — e não consulta a API
    // enquanto a aba do navegador está oculta.
    this.ocorrenciasInterval = setInterval(() => {
      if (document.hidden) return;
      this.carregarSilenciosamente();
    }, 30000);
  }

  /**
   * API sem a rota (deploy da tela antes da API): cai na sessão — atende,
   * e só o síndico administra e conversa. A API continua decidindo.
   * Só o 404 (rota inexistente) libera esse fallback: qualquer outro erro
   * aparece e a tela fica sem ações.
   */
  carregarAcesso() {
    this.api.acesso().subscribe({
      next: (a) => this.acesso.set(a),
      error: (e) => {
        if (e?.status !== 404) {
          this.error.set(msgErro(e, 'Erro ao carregar as permissões da sessão.'));
          return;
        }
        const sindico = this.auth.porteiroInfo()?.turno === 'Síndico';
        this.acesso.set({ operar: true, administrar: sindico, conversar: sindico });
      },
    });
  }

  carregar() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (data) => { this.ocorrencias.set(data); this.loading.set(false); },
      error: (e) => { this.error.set(msgErro(e, 'Erro ao carregar as ocorrências.')); this.loading.set(false); },
    });
  }

  carregarSilenciosamente() {
    this.api.list().subscribe({
      next: (data) => { this.ocorrencias.set(data); },
      error: (e) => this.error.set(msgErro(e, 'Erro ao atualizar as ocorrências.')),
    });
  }

  /**
   * Chamado do monitor de dispositivos: fecha sozinho quando o aparelho volta.
   * Terminal renomeado ou removido o monitor não acha mais — por isso
   * Solucionar fica disponível (aparelho ainda fora do ar = chamado novo).
   */
  ehDispositivo(o: Ocorrencia): boolean {
    return o.tipoNome === CATEGORIA_DISPOSITIVOS;
  }

  /**
   * Responsável que saiu da lista de atribuíveis (porteiro desativado): o
   * select ficava em branco. Aparece como "Nome (inativo)" e pode ser trocado.
   */
  responsavelInativo(o: Ocorrencia): boolean {
    return this.funcionariosCarregados() && o.id_responsavel != null
      && !this.funcionarios().some((f) => f.id_user === o.id_responsavel);
  }

  registrar() {
    if (this.registrando()) return;
    this.formErro.set(null);
    if (!this.novo.descricao?.trim() || !this.novo.tipo) {
      this.formErro.set('Descrição e categoria são obrigatórios.');
      return;
    }
    this.registrando.set(true);
    this.api.create(this.novo).subscribe({
      next: () => {
        this.registrando.set(false);
        this.showForm = false;
        this.novo = { descricao: '', tipo: this.categorias()[0]?.id ?? 0 };
        this.carregar();
      },
      error: (e) => {
        this.registrando.set(false);
        this.formErro.set(msgErro(e, 'Erro ao registrar a ocorrência.'));
      },
    });
  }

  alternarForm(abrir = !this.showForm) {
    this.showForm = abrir;
    this.error.set(null);
    this.formErro.set(null);
  }

  async mudarStatus(o: Ocorrencia, status: OcorrenciaStatus) {
    const prioridade = this.prioridadeCategoria(o.tipo);
    // Crítica é exatamente 1: 0 é o padrão de categoria sem valor (a mesma
    // regra do "urgente" do dashboard).
    const isCritica = prioridade === 1;
    // 'Pendente' é o Reabrir: a API só reabre a partir de Solucionado e grava Ciente.
    const reabrir = status === 'Pendente';
    let message = reabrir
      ? 'Reabrir a ocorrência? Ela volta para Em andamento, com novo prazo.'
      : isCritica
        ? `Você tem certeza que deseja alterar o status desta ocorrência de prioridade CRÍTICA para "${status}"?`
        : `Deseja alterar o status da ocorrência para "${status}"?`;
    if (this.ehDispositivo(o) && status === 'Solucionado') {
      message += ' Se o aparelho ainda estiver fora do ar, o monitor abre um novo chamado.';
    }

    const ok = await this.confirm.ask({
      title: isCritica ? '⚠️ Alteração em Ocorrência CRÍTICA' : reabrir ? 'Reabrir ocorrência' : 'Confirmar alteração de status',
      message,
      confirmLabel: reabrir ? 'Reabrir' : 'Alterar',
      variant: isCritica ? 'danger' : 'primary',
    });

    if (!ok) return;

    this.api.updateStatus(o.id, status).subscribe({
      next: () => this.carregar(),
      error: (e) => {
        this.error.set(msgErro(e, 'Erro ao alterar o status.'));
        // Outra pessoa mudou a ocorrência antes: a lista na tela estava velha.
        if (e?.status === 409) this.carregarSilenciosamente();
      },
    });
  }

  async remover(o: Ocorrencia) {
    const ok = await this.confirm.ask({
      title: 'Remover ocorrência',
      message: 'A ocorrência será removida do histórico.',
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.remove(o.id).subscribe({
      next: () => this.carregar(),
      error: (e) => this.error.set(msgErro(e, 'Erro ao remover a ocorrência.')),
    });
  }

  statusBadge(s: OcorrenciaStatus) {
    if (s === 'Pendente') return { text: 'text-amber-400', dot: 'ps-dot-warn ps-dot-pulse' };
    if (s === 'Ciente')   return { text: '', dot: 'ps-dot-ink' };
    return { text: 'text-emerald-400', dot: 'ps-dot-ok' };
  }

  prioridadeCategoria(catId: number): number {
    return this.categorias().find((c) => c.id === catId)?.prioridade ?? 999;
  }

  /** 1 crítica, 2 alta, 3 média; 4+ e 0 (categoria sem prioridade definida) contam como baixa. */
  prioridadeLabel(p: number): { label: string; color: string } {
    if (p === 1) return { label: 'Crítica', color: 'text-red-400' };
    if (p === 2) return { label: 'Alta', color: 'text-amber-400' };
    if (p === 3) return { label: 'Média', color: '' };
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
    this.chatErro.set(null);
    this.loadingMensagens.set(true);
    this.api.listMessages(o.id).subscribe({
      next: (msgs) => {
        this.mensagens.set(msgs);
        this.loadingMensagens.set(false);
        this.scrollChatParaFim();
      },
      error: (e) => { this.loadingMensagens.set(false); this.erroDoChat(e, 'Erro ao carregar as mensagens.'); },
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
    this.chatErro.set(null);
  }

  /**
   * Erro do chat dentro da gaveta. 404 = a ocorrência foi apagada (pelo autor
   * ou pelo síndico): para a consulta de 1,5 s, que repetia o erro para sempre.
   */
  private erroDoChat(e: any, padrao: string) {
    this.chatErro.set(msgErro(e, padrao));
    if (e?.status === 404) {
      this.limparIntervaloChat();
      this.carregarSilenciosamente();
    }
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
      error: (e) => this.erroDoChat(e, 'Erro ao atualizar as mensagens.'),
    });
  }

  enviarMensagem() {
    const o = this.selectedOcorrencia();
    const txt = this.novaMensagemText.trim();
    if (!o || !txt || this.enviandoMensagem()) return;

    this.chatErro.set(null);
    this.enviandoMensagem.set(true);
    this.api.sendMessage(o.id, txt).subscribe({
      next: (msg) => {
        this.enviandoMensagem.set(false);
        this.mensagens.update((curr) => [...curr, msg]);
        this.novaMensagemText = '';
        this.scrollChatParaFim();
      },
      error: (e) => {
        this.enviandoMensagem.set(false);
        this.erroDoChat(e, 'Erro ao enviar a mensagem.');
      },
    });
  }

  /** Balão do lado "da casa": síndico ou porteiro do console. */
  daCasa(msg: OcorrenciaMensagem): boolean {
    return msg.usuario?.is_sindico === 1 || msg.autor_tipo === 'portaria';
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
      },
      error: (e) => this.error.set(msgErro(e, 'Erro ao alterar a visibilidade.')),
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
    if (!this.tempRespostaText.trim() || this.salvandoResposta()) return;
    this.salvandoResposta.set(true);
    this.api.updateResposta(o.id, this.tempRespostaText.trim()).subscribe({
      next: (updated) => {
        this.salvandoResposta.set(false);
        o.resposta = updated.resposta;
        o.resposta_at = updated.resposta_at;
        this.cancelarEdicaoResposta();
        this.carregar();
      },
      error: (e) => {
        this.salvandoResposta.set(false);
        this.error.set(msgErro(e, 'Erro ao salvar a resposta.'));
      },
    });
  }

  recarregarCategorias() {
    this.api.categorias().subscribe({
      next: (cats) => {
        this.categorias.set(cats);
        if (cats.length > 0 && !this.novo.tipo) this.novo.tipo = cats[0].id;
      },
      error: (e) => this.error.set(msgErro(e, 'Erro ao carregar as categorias.')),
    });
  }

  // ----- Atribuição de responsável -----
  atribuir(o: Ocorrencia, idResponsavelRaw: any) {
    const idResponsavel = idResponsavelRaw === '' || idResponsavelRaw == null ? null : Number(idResponsavelRaw);
    this.api.atribuir(o.id, idResponsavel).subscribe({
      next: () => this.carregar(),
      error: (e) => { this.error.set(msgErro(e, 'Erro ao atribuir.')); this.carregar(); },
    });
  }

  // ----- Selo de SLA (no prazo / atrasada / sem prazo) -----
  slaInfo(o: Ocorrencia): { label: string; classes: string } | null {
    const s = (o.status ?? '').toLowerCase();
    if (s === 'solucionado' || s === 'resolvida') {
      return { label: 'Concluída', classes: 'text-slate-400' };
    }
    if (!o.prazo) {
      return { label: 'Sem prazo', classes: 'text-slate-400' };
    }
    const prazo = new Date(o.prazo);
    if (isNaN(prazo.getTime())) return null;
    const now = new Date();
    if (now.getTime() > prazo.getTime()) {
      return { label: 'Atrasada', classes: 'text-red-400' };
    }
    const diffH = Math.floor((prazo.getTime() - now.getTime()) / 3600000);
    const label = diffH >= 48 ? `Vence em ${Math.floor(diffH / 24)}d`
      : diffH >= 1 ? `Vence em ${diffH}h`
      : `Vence em ${Math.max(1, Math.floor((prazo.getTime() - now.getTime()) / 60000))}min`;
    const classes = diffH >= 24
      ? 'text-emerald-400'
      : 'text-amber-400';
    return { label, classes };
  }

  // ----- Categorias / SLA (só leitura: definidas pela Prestare, no CRM) -----
  abrirCategorias() { this.showCategorias = true; this.recarregarCategorias(); }
  fecharCategorias() { this.showCategorias = false; }
}
