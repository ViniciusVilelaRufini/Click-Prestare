import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmApi } from '../crm.service';
import { CrmStore } from '../crm.store';
import { ToastService } from '../../shared/toast.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { SkeletonComponent } from '../../shared/ui/skeleton.component';
import { ModalShellComponent } from '../../shared/ui/modal-shell.component';
import { ChatMensagem, Ocorrencia } from '../crm.models';

type SubFiltro = 'todos' | 'app' | 'facial' | 'acesso';

/**
 * Aba Chamados: mini-helpdesk cross-condomínio. Lista filtrável de ocorrências
 * técnicas (polling 10s), modal de detalhe com chat em tempo real (polling
 * 2.5s) e reabertura, mais criação manual de chamado.
 *
 * Os dois modais vivem aqui porque compartilham todo o estado do chamado
 * selecionado (chat, resposta, reabertura) — separá-los exigiria repassar
 * uma dezena de inputs/outputs sem ganho real de legibilidade.
 */
@Component({
  selector: 'crm-chamados',
  standalone: true,
  imports: [CommonModule, FormsModule, EmptyStateComponent, SkeletonComponent, ModalShellComponent],
  templateUrl: './crm-chamados.component.html',
})
export class CrmChamadosComponent implements OnInit, OnDestroy {
  private api = inject(CrmApi);
  readonly store = inject(CrmStore);
  private toast = inject(ToastService);

  private ocorrenciasInterval: ReturnType<typeof setInterval> | null = null;
  private chatInterval: ReturnType<typeof setInterval> | null = null;

  readonly ocorrenciasList = signal<Ocorrencia[]>([]);
  readonly ocorrenciasLoading = signal(false);
  readonly subFiltroChamados = signal<SubFiltro>('todos');

  readonly ocorrenciaSelecionada = signal<Ocorrencia | null>(null);
  readonly respostaTexto = signal('');
  readonly enviandoResposta = signal(false);

  readonly reabrindoChamado = signal(false);
  reaberturaTexto = '';
  readonly enviandoReabertura = signal(false);

  readonly chatMensagens = signal<ChatMensagem[]>([]);
  readonly loadingChatMensagens = signal(false);
  chatNovaMensagem = '';

  readonly modalNovoChamadoAberto = signal(false);
  readonly novoChamadoCondominioId = signal<number | null>(null);
  readonly novoChamadoDescricao = signal('');
  readonly criandoNovoChamado = signal(false);

  readonly filtros: { valor: SubFiltro; label: string; dica: string }[] = [
    { valor: 'todos', label: 'Todos', dica: 'Exibindo todos os chamados técnicos B2B' },
    { valor: 'app', label: 'App & sistema', dica: 'Exibindo apenas problemas do aplicativo e do sistema web' },
    { valor: 'facial', label: 'Facial', dica: 'Exibindo problemas em leitores faciais e sincronização' },
    { valor: 'acesso', label: 'Controle de acesso', dica: 'Exibindo problemas em botoeiras, portões, tags RFID e acessos' },
  ];

  readonly dicaFiltroAtivo = computed(
    () => this.filtros.find((f) => f.valor === this.subFiltroChamados())?.dica ?? '',
  );

  private static readonly TECH_KEYWORDS = [
    'app', 'aplicativo', 'facial', 'face', 'reconhecimento',
    'sistema', 'software', 'bug', 'erro', 'falha', 'instabilidade',
    'entrar', 'acesso', 'bloqueado', 'bloqueada', 'nao consegue',
    'nao esta conseguindo', 'liberar', 'liberacao', 'visitante',
    'morador', 'botoeira', 'portao', 'abrir', 'abre', 'travado',
    'travada', 'controle de acesso', 'rfid', 'tag', 'chaveiro',
    'biometria', 'leitor', 'leitora', 'interfone', 'tecnico', 'tecnica',
    'camera',
  ];

  private static readonly FILTRO_KEYWORDS: Record<Exclude<SubFiltro, 'todos'>, string[]> = {
    app: ['app', 'aplicativo', 'sistema', 'software', 'bug', 'erro', 'falha', 'instabilidade', 'senha', 'cadastro', 'login'],
    facial: ['facial', 'face', 'reconhecimento', 'camera'],
    acesso: ['botoeira', 'portao', 'abrir', 'abre', 'travado', 'travada', 'controle de acesso', 'rfid', 'tag', 'chaveiro', 'biometria', 'leitor', 'leitora', 'interfone', 'acesso', 'entrar', 'bloqueado', 'bloqueada', 'nao consegue', 'nao esta conseguindo', 'liberar', 'liberacao', 'visitante', 'morador', 'tecnico', 'tecnica'],
  };

  private static normalize(text: string): string {
    return (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  readonly ocorrenciasFiltradas = computed(() => {
    const list = this.ocorrenciasList();
    const subFiltro = this.subFiltroChamados();
    const norm = CrmChamadosComponent.normalize;

    const casa = (o: Ocorrencia, palavras: string[]) => {
      const desc = norm(String(o.descricao ?? ''));
      const cat = norm(String(o.categoria?.nome ?? ''));
      return palavras.some((k) => desc.includes(k) || cat.includes(k));
    };

    // 1. Oculta permanentemente ocorrências não-técnicas (barulho, lixo, etc.)
    const tecnicas = list.filter((o) => casa(o, CrmChamadosComponent.TECH_KEYWORDS));

    // 2. Aplica o sub-filtro específico de suporte B2B
    if (subFiltro === 'todos') return tecnicas;
    return tecnicas.filter((o) => casa(o, CrmChamadosComponent.FILTRO_KEYWORDS[subFiltro]));
  });

  ngOnInit(): void {
    this.carregarOcorrencias();
    // Polling a cada 10 segundos para novos chamados
    this.ocorrenciasInterval = setInterval(() => this.recargaSilenciosa(), 10000);
  }

  ngOnDestroy(): void {
    if (this.ocorrenciasInterval) clearInterval(this.ocorrenciasInterval);
    this.limparIntervaloChat();
  }

  carregarOcorrencias(): void {
    this.ocorrenciasLoading.set(true);
    this.api.getOcorrencias().subscribe({
      next: (data) => {
        this.ocorrenciasList.set(data);
        this.ocorrenciasLoading.set(false);
      },
      error: (err) => {
        console.error('Erro ao carregar ocorrências no CRM:', err);
        this.ocorrenciasLoading.set(false);
        this.toast.trigger('Não foi possível carregar os chamados.', 'error');
      },
    });
  }

  private recargaSilenciosa(): void {
    this.api.getOcorrencias().subscribe({ next: (data) => this.ocorrenciasList.set(data) });
  }

  // ── Modal de detalhe + chat ──

  abrirRespostaOcorrencia(o: Ocorrencia): void {
    this.ocorrenciaSelecionada.set(o);
    this.respostaTexto.set(String(o.resposta ?? ''));
    this.chatMensagens.set([]);
    this.chatNovaMensagem = '';
    this.limparIntervaloChat();
    this.carregarMensagensChat(o.id);

    // Polling a cada 2.5s para receber novas mensagens
    this.chatInterval = setInterval(() => this.atualizarChatSilenciosamente(o.id), 2500);
  }

  fecharRespostaOcorrencia(): void {
    this.limparIntervaloChat();
    this.ocorrenciaSelecionada.set(null);
    this.respostaTexto.set('');
    this.reabrindoChamado.set(false);
    this.reaberturaTexto = '';
  }

  private limparIntervaloChat(): void {
    if (this.chatInterval) {
      clearInterval(this.chatInterval);
      this.chatInterval = null;
    }
  }

  carregarMensagensChat(idOcorrencia: number): void {
    this.loadingChatMensagens.set(true);
    this.api.listMessages(idOcorrencia).subscribe({
      next: (msgs) => {
        this.chatMensagens.set(msgs);
        this.loadingChatMensagens.set(false);
        this.scrollChatParaFim();
      },
      error: (err) => {
        console.error('Erro ao carregar mensagens do chat:', err);
        this.loadingChatMensagens.set(false);
      },
    });
  }

  private atualizarChatSilenciosamente(idOcorrencia: number): void {
    this.api.listMessages(idOcorrencia).subscribe({
      next: (msgs) => {
        if (msgs.length !== this.chatMensagens().length) {
          this.chatMensagens.set(msgs);
          this.scrollChatParaFim();
        }
      },
    });
  }

  enviarMensagemChat(): void {
    const o = this.ocorrenciaSelecionada();
    const msg = this.chatNovaMensagem.trim();
    if (!o || !msg) return;

    this.api.sendMessage(o.id, msg).subscribe({
      next: (novaMsg) => {
        this.chatMensagens.update((curr) => [...curr, novaMsg]);
        this.chatNovaMensagem = '';
        this.scrollChatParaFim();
      },
      error: (err) => {
        console.error('Erro ao enviar mensagem:', err);
        this.toast.trigger('Erro ao enviar mensagem de chat.', 'error');
      },
    });
  }

  private scrollChatParaFim(): void {
    setTimeout(() => {
      const container = document.getElementById('crm-chat-container');
      if (container) container.scrollTop = container.scrollHeight;
    }, 100);
  }

  enviarRespostaOcorrencia(): void {
    const o = this.ocorrenciaSelecionada();
    const resp = this.respostaTexto().trim();
    if (!o || !resp) return;

    this.enviandoResposta.set(true);
    this.api.responderOcorrencia(o.id, resp).subscribe({
      next: () => {
        this.enviandoResposta.set(false);
        this.toast.trigger('Chamado respondido e resolvido com sucesso.', 'success');
        this.fecharRespostaOcorrencia();
        this.carregarOcorrencias();
        this.store.carregar(); // atualiza contadores do overview
      },
      error: (err) => {
        console.error(err);
        this.enviandoResposta.set(false);
        this.toast.trigger('Erro ao responder chamado.', 'error');
      },
    });
  }

  // ── Reabertura ──

  iniciarReabertura(): void {
    this.reabrindoChamado.set(true);
    this.reaberturaTexto = '';
  }

  cancelarReabertura(): void {
    this.reabrindoChamado.set(false);
    this.reaberturaTexto = '';
  }

  confirmarReabertura(idOcorrencia: number): void {
    const info = this.reaberturaTexto.trim();
    if (!info) return;

    this.enviandoReabertura.set(true);
    this.api.reabrirOcorrencia(idOcorrencia, info).subscribe({
      next: (res) => {
        this.enviandoReabertura.set(false);
        this.reabrindoChamado.set(false);
        this.reaberturaTexto = '';
        this.toast.trigger('Chamado reaberto e sincronizado com o Kanban.', 'success');

        if (res?.data) {
          this.ocorrenciaSelecionada.set(res.data);
          this.respostaTexto.set('');
        }

        this.carregarOcorrencias();
        this.carregarMensagensChat(idOcorrencia);
        this.store.carregar();
      },
      error: (err) => {
        console.error('Erro ao reabrir ocorrência:', err);
        this.enviandoReabertura.set(false);
        this.toast.trigger('Erro ao reabrir e sincronizar o chamado.', 'error');
      },
    });
  }

  // ── Novo chamado ──

  abrirNovoChamado(): void {
    this.modalNovoChamadoAberto.set(true);
    this.novoChamadoCondominioId.set(null);
    this.novoChamadoDescricao.set('');
  }

  fecharNovoChamado(): void {
    this.modalNovoChamadoAberto.set(false);
    this.novoChamadoCondominioId.set(null);
    this.novoChamadoDescricao.set('');
  }

  enviarNovoChamado(): void {
    const idCondominio = this.novoChamadoCondominioId();
    const descricao = this.novoChamadoDescricao().trim();
    if (!idCondominio || !descricao) {
      this.toast.trigger('Selecione o condomínio e digite a descrição.', 'error');
      return;
    }

    this.criandoNovoChamado.set(true);
    this.api.criarOcorrencia(Number(idCondominio), descricao).subscribe({
      next: () => {
        this.criandoNovoChamado.set(false);
        this.toast.trigger('Novo chamado criado e enviado para o Kanban.', 'success');
        this.fecharNovoChamado();
        this.carregarOcorrencias();
        this.store.carregar();
      },
      error: (err) => {
        console.error(err);
        this.criandoNovoChamado.set(false);
        this.toast.trigger('Erro ao criar o chamado.', 'error');
      },
    });
  }
}
