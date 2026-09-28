import { Component, DestroyRef, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Conversa, Mensagem, WhatsappApi } from '../whatsapp.service';

@Component({
  selector: 'app-crm-whatsapp',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './crm-whatsapp.component.html',
})
export class CrmWhatsappComponent implements OnInit {
  private api = inject(WhatsappApi);
  private destroyRef = inject(DestroyRef);
  private fim = viewChild<ElementRef<HTMLElement>>('fim');

  conversas = signal<Conversa[]>([]);
  selecionadaId = signal<number | null>(null);
  mensagens = signal<Mensagem[]>([]);
  texto = '';
  enviando = signal(false);
  erro = signal<string | null>(null);
  selecionada = computed(() => this.conversas().find((c) => c.id === this.selecionadaId()) ?? null);

  ngOnInit() {
    this.carregarConversas();
    const t = setInterval(() => {
      this.carregarConversas();
      const id = this.selecionadaId();
      if (id) this.carregarMensagens(id, false);
    }, 10_000);
    this.destroyRef.onDestroy(() => clearInterval(t));
  }

  carregarConversas() {
    this.api.conversas().subscribe({ next: (c) => this.conversas.set(c), error: () => this.erro.set('Falha ao carregar conversas.') });
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

  /** Enter envia; Shift+Enter quebra linha. */
  teclaEnter(e: KeyboardEvent) {
    if (e.shiftKey) return;
    e.preventDefault();
    this.enviar();
  }

  marca(m: Mensagem): string {
    return m.status === 'lida' ? '✓✓ lida' : m.status === 'entregue' ? '✓✓' : m.status === 'enviada' ? '✓' : m.status === 'falhou' ? '⚠ falhou' : '';
  }
}
