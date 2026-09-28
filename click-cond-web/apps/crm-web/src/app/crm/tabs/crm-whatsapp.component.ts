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

  conversas = signal<Conversa[]>([]);
  selecionadaId = signal<number | null>(null);
  mensagens = signal<Mensagem[]>([]);
  texto = '';
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

  ngOnInit() {
    this.carregarConversas();
    this.api.respostas().subscribe({ next: (r) => this.respostas.set(r), error: () => undefined });
    const t = setInterval(() => {
      this.carregarConversas();
      const id = this.selecionadaId();
      if (id) this.carregarMensagens(id, false);
    }, 10_000);
    this.destroyRef.onDestroy(() => clearInterval(t));
  }

  carregarConversas() {
    this.api.conversas().subscribe({
      next: (c) => {
        this.conversas.set(c);
        // Vindo do botão "Iniciar conversa" da aba Marketing: abre direto a conversa pedida.
        const alvo = Number(this.route.snapshot.queryParamMap.get('conversa'));
        if (alvo && this.selecionadaId() === null) {
          const conv = c.find((x) => x.id === alvo);
          if (conv) this.abrir(conv);
        }
      },
      error: () => this.erro.set('Falha ao carregar conversas.'),
    });
  }

  abrir(c: Conversa) {
    this.selecionadaId.set(c.id);
    this.erro.set(null);
    this.carregarMensagens(c.id, true);
  }

  private carregarMensagens(id: number, rolar: boolean) {
    this.api.mensagens(id).subscribe((m) => {
      const cresceu = m.length !== this.mensagens().length;
      this.mensagens.set(m);
      this.conversas.update((cs) => cs.map((c) => (c.id === id ? { ...c, naoLidas: 0 } : c)));
      if (rolar || cresceu) setTimeout(() => this.fim()?.nativeElement.scrollIntoView({ block: 'end' }));
    });
  }

  enviar() {
    const id = this.selecionadaId();
    const texto = this.texto.trim();
    if (!id || !texto || this.enviando()) return;
    this.enviando.set(true);
    this.erro.set(null);
    this.api.enviar(id, texto).subscribe({
      next: (m) => {
        this.texto = '';
        this.digitado.set('');
        this.mensagens.update((ms) => [...ms, m]);
        if (m.status === 'falhou') this.erro.set(`Não enviada: ${m.erro}`);
        this.enviando.set(false);
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
    return m.status === 'lida' ? '✓✓ lida' : m.status === 'entregue' ? '✓✓' : m.status === 'enviada' ? '✓' : m.status === 'falhou' ? '⚠ falhou' : '';
  }
}
