import { Component, DestroyRef, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Conversa, Mensagem, Resposta, WhatsappApi } from '../whatsapp.service';
import { CrmWhatsappConfigComponent } from './crm-whatsapp-config.component';

@Component({
  selector: 'app-crm-whatsapp',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, CrmWhatsappConfigComponent],
  templateUrl: './crm-whatsapp.component.html',
})
export class CrmWhatsappComponent implements OnInit {
  private api = inject(WhatsappApi);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private fim = viewChild<ElementRef<HTMLElement>>('fim');
  private inputArquivo = viewChild<ElementRef<HTMLInputElement>>('inputArquivo');

  conversas = signal<Conversa[]>([]);
  filtro = signal<string>('');
  conversasFiltradas = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    if (!q) return this.conversas();
    return this.conversas().filter((c) => {
      const nome = (c.nome || '').toLowerCase();
      const waId = (c.waId || '').toLowerCase();
      const trecho = (c.trecho || '').toLowerCase();
      return nome.includes(q) || waId.includes(q) || trecho.includes(q);
    });
  });
  totalNaoLidas = computed(() => this.conversas().reduce((acc, c) => acc + (c.naoLidas || 0), 0));

  selecionadaId = signal<number | null>(null);
  mensagens = signal<Mensagem[]>([]);
  texto = '';
  anexo = signal<File | null>(null);
  previewAnexoUrl = signal<string | null>(null);
  enviando = signal(false);
  erro = signal<string | null>(null);
  respostas = signal<Resposta[]>([]);
  menuRespostas = signal(false);
  configAberta = signal(false);
  /** Texto atual do campo como sinal, para filtrar as respostas ao digitar "/". */
  digitado = signal('');
  sugestoes = computed(() => {
    const t = this.digitado();
    if (!t.startsWith('/') || t.includes(' ')) return [];
    const q = t.slice(1).toLowerCase();
    return this.respostas().filter((r) => r.atalho.includes(q) || r.titulo.toLowerCase().includes(q)).slice(0, 6);
  });
  selecionada = computed(() => this.conversas().find((c) => c.id === this.selecionadaId()) ?? null);

  private carregandoConversas = false;
  private carregandoMensagens = false;

  ngOnInit() {
    this.carregarConversas();
    this.api.respostas().subscribe({ next: (r) => this.respostas.set(r), error: () => undefined });

    // Polling ágil a cada 2s para mensagens e conversas em tempo real
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.sincronizar(false);
    }, 2_000);

    // Atualização instantânea ao focar ou reabrir a aba do CRM
    const onVisChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        this.sincronizar(false);
      }
    };
    const onFocus = () => this.sincronizar(false);

    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', onVisChange);
      window.addEventListener('focus', onFocus);
    }

    this.destroyRef.onDestroy(() => {
      clearInterval(t);
      if (typeof window !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisChange);
        window.removeEventListener('focus', onFocus);
      }
    });
  }

  sincronizar(rolar = false) {
    this.carregarConversas();
    const id = this.selecionadaId();
    if (id) this.carregarMensagens(id, rolar);
  }

  carregarConversas() {
    if (this.carregandoConversas) return;
    this.carregandoConversas = true;
    this.api.conversas().subscribe({
      next: (c) => {
        this.conversas.set(c);
        this.carregandoConversas = false;
        // Vindo do botão "Iniciar conversa" da aba Marketing: abre direto a conversa pedida.
        const alvo = Number(this.route.snapshot.queryParamMap.get('conversa'));
        if (alvo && this.selecionadaId() === null) {
          const conv = c.find((x) => x.id === alvo);
          if (conv) this.abrir(conv);
        }
      },
      error: () => {
        this.carregandoConversas = false;
        this.erro.set('Falha ao carregar conversas.');
      },
    });
  }

  abrir(c: Conversa) {
    this.selecionadaId.set(c.id);
    this.erro.set(null);
    this.removerAnexo();
    this.carregarMensagens(c.id, true);
  }

  private carregarMensagens(id: number, rolar: boolean) {
    if (this.carregandoMensagens) return;
    this.carregandoMensagens = true;
    this.api.mensagens(id).subscribe({
      next: (m) => {
        this.carregandoMensagens = false;
        const atuais = this.mensagens();
        const mudou =
          m.length !== atuais.length ||
          (m.length > 0 && atuais.length > 0 && (
            m[m.length - 1].id !== atuais[atuais.length - 1].id ||
            m[m.length - 1].status !== atuais[atuais.length - 1].status ||
            m[m.length - 1].mediaStatus !== atuais[atuais.length - 1].mediaStatus
          ));
        if (mudou || rolar) {
          this.mensagens.set(m);
          this.conversas.update((cs) => cs.map((c) => (c.id === id ? { ...c, naoLidas: 0 } : c)));
          setTimeout(() => this.fim()?.nativeElement.scrollIntoView({ block: 'end', behavior: rolar ? 'auto' : 'smooth' }));
        }
      },
      error: () => {
        this.carregandoMensagens = false;
      },
    });
  }

  selecionarArquivo(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target?.files && target.files.length > 0) {
      const file = target.files[0];
      if (file.type.startsWith('video/') && file.size > 16 * 1024 * 1024) {
        this.erro.set(`O WhatsApp permite vídeos de até 16 MB (este arquivo possui ${this.formatarTamanho(file.size)}). Comprima o vídeo para enviar.`);
        this.removerAnexo();
        return;
      }
      if (file.type.startsWith('image/') && file.size > 5 * 1024 * 1024) {
        this.erro.set(`O WhatsApp permite imagens de até 5 MB (este arquivo possui ${this.formatarTamanho(file.size)}).`);
        this.removerAnexo();
        return;
      }
      if (file.size > 100 * 1024 * 1024) {
        this.erro.set(`O WhatsApp permite documentos de até 100 MB (este arquivo possui ${this.formatarTamanho(file.size)}).`);
        this.removerAnexo();
        return;
      }
      this.anexo.set(file);
      if (file.type.startsWith('image/')) {
        this.previewAnexoUrl.set(URL.createObjectURL(file));
      } else {
        this.previewAnexoUrl.set(null);
      }
      this.erro.set(null);
    }
  }

  removerAnexo() {
    const prev = this.previewAnexoUrl();
    if (prev) {
      try { URL.revokeObjectURL(prev); } catch { /* noop */ }
      this.previewAnexoUrl.set(null);
    }
    this.anexo.set(null);
    const input = this.inputArquivo()?.nativeElement;
    if (input) input.value = '';
  }

  obterIniciais(nome?: string | null): string {
    if (!nome) return 'WA';
    const partes = nome.trim().replace(/^\+/, '').split(/\s+/).filter(Boolean);
    if (partes.length === 0) return 'WA';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  obterCorAvatar(nome?: string | null): string {
    if (!nome) return 'bg-emerald-600 text-white';
    const cores = [
      'bg-emerald-600 text-white',
      'bg-teal-600 text-white',
      'bg-sky-600 text-white',
      'bg-indigo-600 text-white',
      'bg-violet-600 text-white',
      'bg-purple-600 text-white',
      'bg-amber-600 text-white',
      'bg-rose-600 text-white',
      'bg-cyan-600 text-white',
    ];
    let hash = 0;
    for (let i = 0; i < nome.length; i++) {
      hash = (hash << 5) - hash + nome.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % cores.length;
    return cores[idx];
  }

  formatarTelefone(waId?: string | null): string {
    if (!waId) return '';
    const limpo = waId.replace(/\D/g, '');
    if (limpo.length === 13 && limpo.startsWith('55')) {
      return `+${limpo.slice(0, 2)} (${limpo.slice(2, 4)}) ${limpo.slice(4, 9)}-${limpo.slice(9)}`;
    }
    if (limpo.length === 12 && limpo.startsWith('55')) {
      return `+${limpo.slice(0, 2)} (${limpo.slice(2, 4)}) ${limpo.slice(4, 8)}-${limpo.slice(8)}`;
    }
    if (limpo.length === 11) {
      return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7)}`;
    }
    return `+${limpo}`;
  }

  detectarTipoTrecho(trecho?: string | null): { icone: string; ehMidia: boolean } {
    if (!trecho) return { icone: '', ehMidia: false };
    const t = trecho.toLowerCase();
    if (t.includes('áudio') || t.includes('audio')) return { icone: '🎤', ehMidia: true };
    if (t.includes('imagem') || t.includes('image') || t.includes('foto')) return { icone: '📷', ehMidia: true };
    if (t.includes('vídeo') || t.includes('video')) return { icone: '🎥', ehMidia: true };
    if (t.includes('document') || t.includes('pdf') || t.includes('arquivo')) return { icone: '📄', ehMidia: true };
    return { icone: '', ehMidia: false };
  }

  formatarTamanho(bytes?: number | null): string {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  urlMidia(m: Mensagem): string {
    return this.api.urlMidia(m.id);
  }

  temMidia(m: Mensagem): boolean {
    return ['audio', 'image', 'video', 'document'].includes(m.tipo) || !!m.mediaChave || !!m.mediaStatus;
  }

  midiaDisponivel(m: Mensagem): boolean {
    if (m.mediaStatus === 'indisponivel' || m.mediaStatus === 'falhou') return false;
    return m.mediaStatus === 'pronto' || m.mediaStatus === 'enviada' || !!m.mediaChave;
  }

  mostrarTexto(m: Mensagem): boolean {
    if (!this.temMidia(m)) return true;
    if (!this.midiaDisponivel(m)) return true;
    const t = m.texto?.trim() ?? '';
    if (/^\[.*(recebida|recebido|enviada|enviado)\]$/i.test(t)) return false;
    return t.length > 0;
  }

  enviar() {
    const id = this.selecionadaId();
    const arquivo = this.anexo();
    const texto = this.texto.trim();
    if (!id || (!texto && !arquivo) || this.enviando()) return;

    this.enviando.set(true);
    this.erro.set(null);

    if (arquivo) {
      this.api.enviarMidia(id, arquivo, texto).subscribe({
        next: (m) => {
          this.texto = '';
          this.digitado.set('');
          this.removerAnexo();
          this.mensagens.update((ms) => [...ms, m]);
          if (m.status === 'falhou') this.erro.set(`Não enviada: ${m.erro}`);
          this.enviando.set(false);
          this.carregarConversas();
          setTimeout(() => this.fim()?.nativeElement.scrollIntoView({ block: 'end' }));
        },
        error: (e) => {
          this.erro.set(e?.error?.message ?? 'Falha ao enviar mídia.');
          this.enviando.set(false);
        },
      });
      return;
    }

    this.api.enviar(id, texto).subscribe({
      next: (m) => {
        this.texto = '';
        this.digitado.set('');
        this.mensagens.update((ms) => [...ms, m]);
        if (m.status === 'falhou') this.erro.set(`Não enviada: ${m.erro}`);
        this.enviando.set(false);
        this.carregarConversas();
        setTimeout(() => this.fim()?.nativeElement.scrollIntoView({ block: 'end' }));
      },
      error: (e) => {
        this.erro.set(e?.error?.message ?? 'Falha ao enviar.');
        this.enviando.set(false);
      },
    });
  }

  usarResposta(r: Resposta) {
    this.texto = r.texto;
    this.digitado.set(r.texto);
    this.menuRespostas.set(false);
  }

  /** Enter envia; Shift+Enter quebra linha; com sugestões abertas, Enter escolhe a primeira. */
  teclaEnter(e: KeyboardEvent) {
    if (e.shiftKey) return;
    const sug = this.sugestoes();
    if (sug.length) { e.preventDefault(); this.usarResposta(sug[0]); return; }
    e.preventDefault();
    this.enviar();
  }

  automatica(m: Mensagem): boolean {
    return m.tipo?.startsWith('auto_');
  }

  marca(m: Mensagem): string {
    return m.status === 'lida' ? '✓✓ lida' : m.status === 'entregue' ? '✓✓' : m.status === 'enviada' ? '✓' : m.status === 'falhou' ? '⚠️ falhou' : '';
  }
}
