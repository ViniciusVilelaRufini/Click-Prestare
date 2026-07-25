import { Component, HostListener, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { CrmApi } from '../crm.service';
import { CrmStore } from '../crm.store';
import { ToastService } from '../../shared/toast.service';
import { Apartamento, ClienteEdicao, Morador } from '../crm.models';
import * as fmt from '../crm-format';

type SubAba = 'geral' | 'portaria' | 'servicos' | 'moradores';

/**
 * Drawer de detalhe do cliente: visão geral/financeira, hardware e acessos,
 * serviços e gestão de moradores, além do modo de edição comercial.
 * Abre reagindo a store.clienteSelecionado (setado por qualquer aba).
 */
@Component({
  selector: 'crm-cliente-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cliente-drawer.component.html',
})
export class ClienteDrawerComponent {
  private api = inject(CrmApi);
  readonly store = inject(CrmStore);
  private toast = inject(ToastService);

  readonly Math = Math;
  readonly iniciais = fmt.iniciais;
  readonly moeda = fmt.moeda;
  readonly estagioLabel = fmt.estagioLabel;
  readonly estagioClasse = fmt.estagioClasse;
  readonly pagamentoLabel = fmt.pagamentoLabel;
  readonly pagamentoClasse = fmt.pagamentoClasse;
  readonly riscoLabel = fmt.riscoLabel;
  readonly riscoClasse = fmt.riscoClasse;
  readonly healthClasse = fmt.healthClasse;
  readonly healthBg = fmt.healthBg;
  readonly severidadeDot = fmt.severidadeDot;

  readonly abaSelecionada = signal<SubAba>('geral');
  readonly modoEdicao = signal(false);
  dadosEditados: ClienteEdicao = {
    nome: '', identificacao: '', plano: 'Sem plano', totalApartamentos: 0, mrr: 0,
    vencimento: '', recorrenciaAtiva: false, cobrancaAutoWhats: false,
    sindicoNome: '', sindicoEmail: '', sindicoTelefone: '',
  };

  // ── Gestão de moradores ──
  readonly moradores = signal<Morador[]>([]);
  readonly apartamentos = signal<Apartamento[]>([]);
  readonly moradoresLoading = signal(false);
  readonly buscaMorador = signal('');
  readonly mostrandoFormMorador = signal(false);
  readonly registrarNome = signal('');
  readonly registrarTelefone = signal('');
  readonly registrarEmail = signal('');
  readonly registrarAptoId = signal<number | null>(null);
  readonly registrarDocumento = signal('');
  readonly registrarSenha = signal('');

  private router = inject(Router);
  private route = inject(ActivatedRoute);

  /** Cliente pedido pela URL na entrada da página — consumido uma única vez. */
  private idPendenteDaUrl = Number(this.route.snapshot.queryParamMap.get('cliente')) || null;

  constructor() {
    // Sempre que o cliente selecionado muda, o drawer volta ao estado inicial
    // e a URL passa a refletir quem está aberto (deep-link ?cliente=ID).
    effect(() => {
      const c = this.store.clienteSelecionado();
      this.abaSelecionada.set('geral');
      this.modoEdicao.set(false);
      this.moradores.set([]);
      this.apartamentos.set([]);
      this.mostrandoFormMorador.set(false);
      this.buscaMorador.set('');

      // Não apaga o ?cliente=ID da URL enquanto o cliente pedido não abriu.
      if (!c && this.idPendenteDaUrl) return;

      untracked(() => {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { cliente: c ? c.id : null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
    });

    // Reabre o drawer quando a lista chega e a URL pedia um cliente específico.
    effect(() => {
      const clientes = this.store.clientes();
      const idUrl = this.idPendenteDaUrl;
      if (!idUrl || !clientes.length) return;

      untracked(() => {
        this.idPendenteDaUrl = null;
        const alvo = clientes.find((c) => c.id === idUrl);
        if (alvo) this.store.abrirCliente(alvo);
      });
    });
  }

  /** Acessibilidade: Esc fecha o painel (padrão de diálogo modal). */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.store.clienteSelecionado()) this.fecharCliente();
  }

  fecharCliente(): void {
    this.store.fecharCliente();
    this.modoEdicao.set(false);
  }

  selecionarAba(aba: SubAba): void {
    this.abaSelecionada.set(aba);
    if (aba === 'moradores') {
      const c = this.store.clienteSelecionado();
      if (c) this.carregarMoradoresEApartamentos(c.id);
    }
  }

  // ── Edição comercial ──

  iniciarEdicao(): void {
    const c = this.store.clienteSelecionado();
    if (!c) return;

    this.dadosEditados = {
      nome: c.nome,
      identificacao: c.identificacao ?? '',
      plano: c.plano ?? 'Sem plano',
      totalApartamentos: c.totalApartamentos,
      mrr: c.mrr,
      vencimento: c.vencimento ? c.vencimento.split('T')[0] : '',
      recorrenciaAtiva: c.recorrenciaAtiva,
      cobrancaAutoWhats: c.cobrancaAutoWhats,
      sindicoNome: c.contatoPrincipal?.nome ?? '',
      sindicoEmail: c.contatoPrincipal?.email ?? '',
      sindicoTelefone: c.contatoPrincipal?.telefone ?? '',
    };
    this.modoEdicao.set(true);
  }

  cancelarEdicao(): void {
    this.modoEdicao.set(false);
  }

  /** MRR é derivado da tabela de planos: base + (UHs × taxa por UH). */
  atualizarMrrCalculado(): void {
    const planoConfig = this.store.configPlanos().find((p) => p.plano === this.dadosEditados.plano);
    const uh = this.dadosEditados.totalApartamentos || 0;
    this.dadosEditados.mrr = planoConfig ? planoConfig.valorBase + uh * planoConfig.valorPorUH : 0;
  }

  salvarEdicao(): void {
    const c = this.store.clienteSelecionado();
    if (!c) return;

    this.store.salvando.set(true);
    this.api.atualizar(c.id, this.dadosEditados).subscribe({
      next: (res) => {
        this.store.salvando.set(false);
        this.modoEdicao.set(false);
        this.store.clienteSelecionado.set(res.data);
        this.store.carregar();
        this.toast.trigger('Dados do condomínio atualizados com sucesso.', 'success');
      },
      error: (err) => {
        console.error('Erro ao salvar cliente:', err);
        this.store.salvando.set(false);
        this.toast.trigger('Não foi possível salvar as alterações. Verifique os dados e tente novamente.', 'error');
      },
    });
  }

  exportarRelatorio(): void {
    const c = this.store.clienteSelecionado();
    if (!c) return;
    const link = document.createElement('a');
    link.href = this.api.exportarUrl(c.id);
    link.download = `crm-relatorio-condominio-${c.id}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ── Moradores ──

  carregarMoradoresEApartamentos(idCondominio: number): void {
    this.moradoresLoading.set(true);
    this.buscaMorador.set('');
    this.mostrandoFormMorador.set(false);

    forkJoin({
      moradores: this.api.getMoradores(idCondominio),
      apartamentos: this.api.getApartamentos(idCondominio),
    }).subscribe({
      next: ({ moradores, apartamentos }) => {
        this.moradores.set(moradores);
        this.apartamentos.set(apartamentos);
        this.moradoresLoading.set(false);
      },
      error: (err) => {
        console.error('Erro ao carregar moradores da API:', err);
        this.moradores.set([]);
        this.apartamentos.set([]);
        this.moradoresLoading.set(false);
        this.toast.trigger('Não foi possível carregar os moradores deste condomínio.', 'error');
      },
    });
  }

  abrirFormMorador(): void {
    this.registrarNome.set('');
    this.registrarTelefone.set('');
    this.registrarEmail.set('');
    this.registrarAptoId.set(null);
    this.registrarDocumento.set('');
    this.registrarSenha.set(Math.floor(100000 + Math.random() * 900000).toString());
    this.mostrandoFormMorador.set(true);
  }

  resetFormMorador(): void {
    this.mostrandoFormMorador.set(false);
  }

  private gerarMensagemWhatsApp(morador: Morador, senha: string, condominioNome: string): string {
    return `Olá, *${morador.nome}*!\n` +
      `Seu acesso ao aplicativo *Click Prestare* foi cadastrado.\n\n` +
      `Condomínio: *${condominioNome}*\n` +
      `Apartamento: *${morador.bloco ? morador.bloco + ' - ' : ''}${morador.apartamento}*\n` +
      `Login/E-mail: \`${morador.email || 'Não informado'}\`\n` +
      `Senha de Acesso: \`${senha}\`\n\n` +
      `Baixe o app no link abaixo e insira seus dados para acessar:\n` +
      `Android: https://play.google.com/store\n` +
      `iOS: https://apple.com/app-store\n\n` +
      `Seja bem-vindo!`;
  }

  private dispararWhatsAppCredenciais(morador: Morador, senha: string, condominioNome: string): void {
    if (!morador.telefone) {
      this.toast.trigger('Morador cadastrado sem número de telefone para WhatsApp.', 'info');
      return;
    }

    const cleanPhone = morador.telefone.replace(/\D/g, '');
    const phoneWithDdd = cleanPhone.length <= 11 ? '55' + cleanPhone : cleanPhone;
    const msg = this.gerarMensagemWhatsApp(morador, senha, condominioNome);

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(msg).then(
        () => this.toast.trigger('Credenciais copiadas para a área de transferência.', 'success'),
        (err) => console.error('Erro ao copiar credenciais:', err),
      );
    }

    window.open(`https://wa.me/${phoneWithDdd}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  salvarMorador(): void {
    const c = this.store.clienteSelecionado();
    if (!c) return;

    const nome = this.registrarNome().trim();
    const aptoId = this.registrarAptoId();
    const senha = this.registrarSenha().trim();

    if (!nome) {
      this.toast.trigger('O nome do morador é obrigatório.', 'error');
      return;
    }
    if (!aptoId) {
      this.toast.trigger('Selecione o apartamento do morador.', 'error');
      return;
    }

    this.moradoresLoading.set(true);
    this.api
      .createMorador(c.id, {
        nome,
        documento: this.registrarDocumento().trim() || null,
        email: this.registrarEmail().trim() || null,
        telefone: this.registrarTelefone().trim() || null,
        tipo: 'proprietario',
        id_apartamento: aptoId,
        sendCredentials: true,
      })
      .subscribe({
        next: (created) => {
          this.moradores.update((m) => [created, ...m]);
          c.totalMoradores += 1;
          this.moradoresLoading.set(false);
          this.toast.trigger(`Morador ${nome} registrado com sucesso.`, 'success');
          this.dispararWhatsAppCredenciais(created, senha, c.nome);
          this.resetFormMorador();
        },
        error: (err) => {
          this.moradoresLoading.set(false);
          this.toast.trigger('Erro ao registrar morador no servidor.', 'error');
          console.error(err);
        },
      });
  }

  reenviarCredenciaisMorador(morador: Morador): void {
    const c = this.store.clienteSelecionado();
    if (!c) return;
    this.dispararWhatsAppCredenciais(morador, morador.documento || '123456', c.nome);
  }

  removerMorador(moradorId: number): void {
    const c = this.store.clienteSelecionado();
    if (!c) return;

    if (!confirm('Deseja realmente remover este morador?')) return;

    // Remoção ainda é local: o backend não expõe DELETE de morador para o CRM.
    this.moradores.update((list) => list.filter((m) => m.id !== moradorId));
    if (c.totalMoradores > 0) c.totalMoradores -= 1;
    this.toast.trigger('Morador removido da listagem local.', 'info');
  }
}
