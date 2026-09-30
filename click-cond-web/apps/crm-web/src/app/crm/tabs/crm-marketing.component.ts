import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ToastService } from '../../shared/toast.service';
import { Router } from '@angular/router';
import { Canal, Lead, LeadStatus, MarketingApi, ResumoMarketing } from '../marketing.service';
import { WhatsappApi } from '../whatsapp.service';

type Periodo = '7d' | '30d' | 'mes' | 'custom';

// Usa partes locais (não toISOString, que é UTC): o navegador do usuário já
// está em horário local (BRT), então getFullYear/getMonth/getDate dão o dia
// certo mesmo perto da meia-noite.
const iso = (d: Date) => {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
};

/**
 * Aba Marketing: quanto as campanhas custam, quantos pedidos de orçamento
 * geram e quantos viram contrato. Leads vêm do formulário da landing; números
 * de anúncio vêm do Google Ads Script (diário) e da OpenAI Ads API (horário).
 */
@Component({
  selector: 'crm-marketing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './crm-marketing.component.html',
})
export class CrmMarketingComponent implements OnInit {
  private api = inject(MarketingApi);
  private toast = inject(ToastService);
  private waApi = inject(WhatsappApi);
  private router = inject(Router);
  readonly iniciando = signal(false);
  readonly removendo = signal(false);

  /** Envia o modelo de primeiro contato pelo número comercial e abre a conversa na aba WhatsApp. */
  iniciarConversa(l: Lead) {
    if (this.iniciando()) return;
    this.iniciando.set(true);
    this.waApi.iniciarConversa(l.id).subscribe({
      next: (r) => {
        this.iniciando.set(false);
        if (r.mensagem.status === 'falhou') this.toast.trigger(`Mensagem não enviada: ${r.mensagem.erro}`, 'error');
        this.router.navigate(['/painel/whatsapp'], { queryParams: { conversa: r.conversaId } });
      },
      error: (e) => {
        this.iniciando.set(false);
        this.toast.trigger(e?.error?.message ?? 'Não foi possível iniciar a conversa.', 'error');
      },
    });
  }

  readonly periodo = signal<Periodo>('30d');
  readonly de = signal(iso(new Date(Date.now() - 29 * 864e5)));
  readonly ate = signal(iso(new Date()));
  readonly filtroStatus = signal<'' | LeadStatus>('');
  readonly filtroOrigem = signal<'' | Canal>('');

  readonly carregando = signal(false);
  readonly resumo = signal<ResumoMarketing | null>(null);
  readonly leads = signal<Lead[]>([]);
  readonly selecionado = signal<Lead | null>(null);
  observacaoEdit = '';
  readonly salvando = signal(false);

  readonly statusOpcoes: { valor: LeadStatus; label: string }[] = [
    { valor: 'novo', label: 'Novo' },
    { valor: 'em_contato', label: 'Em contato' },
    { valor: 'proposta', label: 'Proposta enviada' },
    { valor: 'fechado', label: 'Fechado' },
    { valor: 'perdido', label: 'Perdido' },
  ];
  readonly canalLabel: Record<Canal, string> = { google: 'Google Ads', openai: 'OpenAI Ads', instagram: 'Instagram', organico: 'Orgânico' };
  readonly canalCor: Record<Canal, string> = {
    google: 'bg-blue-50 text-blue-700', openai: 'bg-emerald-50 text-emerald-700',
    instagram: 'bg-pink-50 text-pink-700', organico: 'bg-slate-100 text-slate-600',
  };

  readonly maxDiario = computed(() => {
    const d = this.resumo()?.diario ?? [];
    return { gasto: Math.max(1, ...d.map((x) => x.gasto)), leads: Math.max(1, ...d.map((x) => x.leads)) };
  });

  readonly avisosFrescor = computed(() => {
    const f = this.resumo()?.frescor;
    if (!f) return [];
    const limite = Date.now() - 36 * 3600e3;
    const out: string[] = [];
    if (!f.google || Date.parse(f.google) < limite) out.push('Google Ads sem atualização há mais de 36 h — confira o script na conta.');
    if (!f.openai || Date.parse(f.openai) < limite) out.push('OpenAI Ads sem atualização há mais de 36 h — confira OPENAI_ADS_API_KEY.');
    return out;
  });

  ngOnInit() {
    this.carregar();
  }

  escolherPeriodo(p: Periodo) {
    this.periodo.set(p);
    const hoje = new Date();
    if (p === '7d') this.de.set(iso(new Date(Date.now() - 6 * 864e5)));
    if (p === '30d') this.de.set(iso(new Date(Date.now() - 29 * 864e5)));
    if (p === 'mes') this.de.set(iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)));
    if (p !== 'custom') this.ate.set(iso(hoje));
    if (p !== 'custom') this.carregar();
  }

  carregar() {
    this.carregando.set(true);
    forkJoin({
      resumo: this.api.resumo(this.de(), this.ate()),
      leads: this.api.leads({ de: this.de(), ate: this.ate(), status: this.filtroStatus() || undefined, origem: this.filtroOrigem() || undefined }),
    }).subscribe({
      next: ({ resumo, leads }) => {
        this.resumo.set(resumo);
        this.leads.set(leads);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.toast.trigger('Não foi possível carregar o marketing.', 'error');
      },
    });
  }

  abrir(l: Lead) {
    this.selecionado.set(l);
    this.observacaoEdit = l.observacao ?? '';
  }

  fechar() {
    this.selecionado.set(null);
  }

  podeRemoverTeste(l: Lead): boolean {
    return l.origem === 'organico' && !l.whatsapp && !l.temConversaWhatsapp;
  }

  removerTeste(l: Lead): void {
    if (!this.podeRemoverTeste(l) || this.removendo()) return;
    if (!window.confirm('Excluir este lead orgânico de teste? Esta ação não pode ser desfeita.')) return;
    this.removendo.set(true);
    this.api.removerOrganico(l.id).subscribe({
      next: () => {
        this.removendo.set(false);
        this.fechar();
        this.carregar();
      },
      error: (e) => {
        this.removendo.set(false);
        this.toast.trigger(e?.error?.message ?? 'Não foi possível excluir o lead de teste.', 'error');
      },
    });
  }

  salvar(p: { status?: LeadStatus; observacao?: string }) {
    const l = this.selecionado();
    if (!l) return;
    this.salvando.set(true);
    this.api.atualizar(l.id, p).subscribe({
      next: (novo) => {
        this.leads.update((ls) => ls.map((x) => (x.id === novo.id ? novo : x)));
        this.selecionado.set(novo);
        this.salvando.set(false);
        this.carregarResumo();
      },
      error: () => {
        this.salvando.set(false);
        this.toast.trigger('Não foi possível salvar o lead.', 'error');
      },
    });
  }

  private carregarResumo() {
    this.api.resumo(this.de(), this.ate()).subscribe((r) => this.resumo.set(r));
  }

  linkWhatsapp(l: Lead): string {
    const num = l.whatsapp.startsWith('55') ? l.whatsapp : `55${l.whatsapp}`;
    const msg = `Olá, ${l.nome}! Aqui é da Prestare Gestão, sobre o orçamento do ${l.condominio}.`;
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  }

  statusLabel(s: LeadStatus) {
    return this.statusOpcoes.find((o) => o.valor === s)?.label ?? s;
  }

  brl(v: number | null | undefined): string {
    return v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  num(v: number | null | undefined): string {
    return v == null ? '—' : v.toLocaleString('pt-BR');
  }

  pct(v: number | null | undefined): string {
    return v == null ? '—' : `${(v * 100).toFixed(1).replace('.', ',')}%`;
  }

  tempo(isoStr: string | null | undefined): string {
    if (!isoStr) return 'nunca';
    const h = Math.round((Date.now() - Date.parse(isoStr)) / 3600e3);
    return h < 1 ? 'há menos de 1 h' : `há ${h} h`;
  }
}
