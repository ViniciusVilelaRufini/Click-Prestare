import { Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { CrmApi, CrmTerminal } from '../crm.service';
import { CrmStore } from '../crm.store';
import { ToastService } from '../../shared/toast.service';
import { Apartamento, ClienteEdicao, Morador } from '../crm.models';
import { ModalShellComponent } from '../../shared/ui/modal-shell.component';
import * as fmt from '../crm-format';

type SubAba = 'geral' | 'portaria' | 'servicos' | 'unidades' | 'moradores';

/**
 * Drawer de detalhe do cliente: visão geral/financeira, hardware e acessos,
 * serviços e gestão de moradores, além do modo de edição comercial.
 * Abre reagindo a store.clienteSelecionado (setado por qualquer aba).
 */
@Component({
  selector: 'crm-cliente-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalShellComponent],
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
  readonly terminais = signal<CrmTerminal[]>([]);
  readonly terminaisLoading = signal(false);

  /** Resumo derivado da lista real de terminais (evita divergir do contador do card). */
  readonly resumoTerminais = computed(() => {
    const ts = this.terminais();
    const ativos = ts.filter((t) => t.ativo);
    return {
      total: ts.length,
      online: ativos.filter((t) => t.online === true).length,
      offline: ativos.filter((t) => t.online === false).length,
      // Sem reporte do agente: não dá para afirmar nem online nem offline.
      semStatus: ativos.filter((t) => t.online === null).length,
      desativados: ts.length - ativos.length,
    };
  });

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
      this.terminais.set([]);

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
    const c = this.store.clienteSelecionado();
    if (!c) return;
    if (aba === 'moradores') this.carregarMoradoresEApartamentos(c.id);
    if (aba === 'unidades') this.carregarUnidades(c.id);
    if (aba === 'portaria') this.carregarTerminais(c.id);
  }

  // ════════════ Unidades (apartamentos) ════════════

  readonly unidadesLoading = signal(false);
  readonly buscaUnidade = signal('');
  /** Id da unidade em edição inline; null = nenhuma. */
  readonly unidadeEditando = signal<number | null>(null);
  readonly formUnidade = signal({ bloco: '', apto: '', fracao: '', qtd_vagas: 0 });
  readonly mostrandoFormUnidade = signal(false);
  readonly mostrandoLote = signal(false);
  lote = { blocos: 'A', andares: 4, porAndar: 4 };

  /** Quantos moradores estão vinculados a cada unidade — alerta antes de excluir. */
  readonly moradoresPorApto = computed(() => {
    const mapa: Record<number, number> = {};
    for (const m of this.moradores()) {
      if (m.id_apartamento != null) mapa[m.id_apartamento] = (mapa[m.id_apartamento] ?? 0) + 1;
    }
    return mapa;
  });

  readonly unidadesFiltradas = computed(() => {
    const termo = this.buscaUnidade().trim().toLowerCase();
    const lista = this.apartamentos();
    if (!termo) return lista;
    return lista.filter(
      (a) =>
        String(a.apto ?? '').toLowerCase().includes(termo) ||
        String(a.bloco ?? '').toLowerCase().includes(termo),
    );
  });

  carregarUnidades(idCondominio: number): void {
    this.unidadesLoading.set(true);
    // Carrega moradores junto para saber quantos dependem de cada unidade.
    forkJoin({
      aptos: this.api.getApartamentos(idCondominio),
      moradores: this.api.getMoradores(idCondominio),
    }).subscribe({
      next: ({ aptos, moradores }) => {
        this.apartamentos.set(aptos);
        this.moradores.set(moradores);
        this.unidadesLoading.set(false);
      },
      error: () => {
        this.unidadesLoading.set(false);
        this.toast.trigger('Não foi possível carregar as unidades.', 'error');
      },
    });
  }

  abrirFormUnidade(): void {
    this.formUnidade.set({ bloco: '', apto: '', fracao: '', qtd_vagas: 0 });
    this.unidadeEditando.set(null);
    this.mostrandoLote.set(false);
    this.mostrandoFormUnidade.set(true);
  }

  editarUnidade(a: Apartamento): void {
    this.formUnidade.set({
      bloco: a.bloco ?? '',
      apto: String(a.apto ?? ''),
      fracao: (a as any).fracao ?? '',
      qtd_vagas: (a as any).qtd_vagas ?? 0,
    });
    this.unidadeEditando.set(a.id);
    this.mostrandoLote.set(false);
    this.mostrandoFormUnidade.set(true);
  }

  cancelarFormUnidade(): void {
    this.mostrandoFormUnidade.set(false);
    this.unidadeEditando.set(null);
  }

  salvarUnidade(): void {
    const c = this.store.clienteSelecionado();
    const f = this.formUnidade();
    if (!c) return;
    if (!f.apto.trim()) {
      this.toast.trigger('Informe o número da unidade.', 'error');
      return;
    }

    const dto = {
      bloco: f.bloco.trim() || null,
      apto: f.apto.trim(),
      fracao: f.fracao.trim() || null,
      qtd_vagas: Number(f.qtd_vagas) || 0,
    };
    const id = this.unidadeEditando();

    const req = id
      ? this.api.atualizarApartamento(c.id, id, dto)
      : this.api.criarApartamento(c.id, dto);

    req.subscribe({
      next: () => {
        this.toast.trigger(id ? 'Unidade atualizada.' : 'Unidade cadastrada.', 'success');
        this.cancelarFormUnidade();
        this.carregarUnidades(c.id);
        this.store.carregar();
      },
      error: (err) => {
        this.toast.trigger(err?.error?.message ?? 'Não foi possível salvar a unidade.', 'error');
      },
    });
  }

  removerUnidade(a: Apartamento): void {
    const c = this.store.clienteSelecionado();
    if (!c) return;

    const vinculados = this.moradoresPorApto()[a.id] ?? 0;
    const rotulo = a.bloco ? `Apto ${a.apto} (Bloco ${a.bloco})` : `Apto ${a.apto}`;
    const aviso = vinculados
      ? `${rotulo} tem ${vinculados} morador(es) vinculado(s). Remover a unidade desfaz esses vínculos, além de visitas, vagas e reservas ligadas a ela.\n\nConfirma?`
      : `Remover ${rotulo}?`;
    if (!confirm(aviso)) return;

    this.api.removerApartamento(c.id, a.id).subscribe({
      next: (r) => {
        const arr = r.arrastados;
        this.toast.trigger(
          arr
            ? `${rotulo} removido — ${arr.moradores} vínculo(s), ${arr.vagas} vaga(s) e ${arr.visitantes} visita(s) foram junto.`
            : `${rotulo} removido.`,
          'success',
        );
        this.carregarUnidades(c.id);
        this.store.carregar();
      },
      error: (err) => {
        this.toast.trigger(err?.error?.message ?? 'Não foi possível remover a unidade.', 'error');
      },
    });
  }

  blocosLote(): string[] {
    return this.lote.blocos.split(',').map((b) => b.trim()).filter(Boolean);
  }

  totalLotePrevisto(): number {
    return this.blocosLote().length * Number(this.lote.andares || 0) * Number(this.lote.porAndar || 0);
  }

  gerarLote(): void {
    const c = this.store.clienteSelecionado();
    if (!c) return;
    if (this.totalLotePrevisto() < 1) {
      this.toast.trigger('Informe blocos, andares e unidades por andar.', 'error');
      return;
    }

    this.api
      .gerarApartamentosLote(c.id, {
        blocos: this.blocosLote(),
        andares: Number(this.lote.andares),
        porAndar: Number(this.lote.porAndar),
      })
      .subscribe({
        next: (r) => {
          this.toast.trigger(
            `${r.criados} unidade(s) criada(s).${r.repetidos ? ` ${r.repetidos} já existiam e foram ignoradas.` : ''}`,
            'success',
          );
          this.mostrandoLote.set(false);
          this.carregarUnidades(c.id);
          this.store.carregar();
        },
        error: (err) => {
          this.toast.trigger(err?.error?.message ?? 'Não foi possível gerar as unidades.', 'error');
        },
      });
  }

  /** Terminais faciais do condomínio, um a um (online/offline real). */
  carregarTerminais(idCondominio: number): void {
    this.terminaisLoading.set(true);
    this.api.getTerminais(idCondominio).subscribe({
      next: (rows) => {
        this.terminais.set(rows);
        this.terminaisLoading.set(false);
      },
      error: (err) => {
        console.error('Erro ao carregar terminais faciais:', err);
        this.terminais.set([]);
        this.terminaisLoading.set(false);
        this.toast.trigger('Não foi possível carregar os terminais deste condomínio.', 'error');
      },
    });
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
    this.exportouAntesDaPurga.set(true);
  }

  // ── Senha do síndico ──
  //
  // Só existe redefinir. A senha atual está em bcrypt no banco: não há como
  // exibi-la nem copiá-la, e é exatamente assim que deve ser.

  readonly modalSenhaSindico = signal(false);
  readonly senhaSindicoNova = signal<{ login: string; senha: string } | null>(null);
  senhaDigitada = '';

  abrirSenhaSindico(): void {
    this.senhaDigitada = '';
    this.senhaSindicoNova.set(null);
    this.modalSenhaSindico.set(true);
  }

  redefinirSenhaSindico(): void {
    const c = this.store.clienteSelecionado();
    if (!c) return;
    const digitada = this.senhaDigitada.trim();
    if (digitada && digitada.length < 6) {
      this.toast.trigger('A senha deve ter ao menos 6 caracteres.', 'error');
      return;
    }

    this.api.redefinirSenhaSindico(c.id, digitada || undefined).subscribe({
      next: (r) => {
        this.senhaSindicoNova.set({ login: r.login ?? '—', senha: r.senha });
        this.toast.trigger('Senha redefinida. O síndico entra com a nova a partir de agora.', 'success');
      },
      error: (err) => {
        this.toast.trigger(err?.error?.message ?? 'Não foi possível redefinir a senha.', 'error');
      },
    });
  }

  copiarCredenciaisSindico(): void {
    const dados = this.senhaSindicoNova();
    if (!dados) return;
    navigator.clipboard
      ?.writeText(`Acesso Click Prestare\nLogin: ${dados.login}\nSenha: ${dados.senha}`)
      .then(() => this.toast.trigger('Credenciais copiadas.', 'success'))
      .catch(() => this.toast.trigger('Não foi possível copiar.', 'error'));
  }

  // ── Zona de risco: desativar / reativar / excluir ──

  readonly modalDesativar = signal(false);
  readonly modalPurga = signal(false);
  motivoDesativacao = '';
  confirmacaoNome = '';

  /**
   * Exportação feita nesta sessão do drawer. A purga só é liberada depois —
   * é a única recuperação possível, já que o delete é em cascata e definitivo.
   */
  readonly exportouAntesDaPurga = signal(false);

  abrirDesativar(): void {
    this.motivoDesativacao = '';
    this.modalDesativar.set(true);
  }

  confirmarDesativacao(): void {
    const c = this.store.clienteSelecionado();
    if (!c) return;
    if (this.motivoDesativacao.trim().length < 5) {
      this.toast.trigger('Informe o motivo da desativação (mínimo 5 caracteres).', 'error');
      return;
    }
    this.modalDesativar.set(false);
    this.store.desativarCondominio(c.id, c.nome, this.motivoDesativacao.trim());
  }

  reativar(): void {
    const c = this.store.clienteSelecionado();
    if (!c) return;
    this.store.reativarCondominio(c.id, c.nome);
  }

  abrirPurga(): void {
    this.confirmacaoNome = '';
    this.exportouAntesDaPurga.set(false);
    this.modalPurga.set(true);
  }

  /** O nome digitado precisa bater exatamente — a API valida de novo. */
  nomeConfere(): boolean {
    const c = this.store.clienteSelecionado();
    return !!c && this.confirmacaoNome.trim() === c.nome.trim();
  }

  confirmarPurga(): void {
    const c = this.store.clienteSelecionado();
    if (!c || !this.nomeConfere() || !this.exportouAntesDaPurga()) return;
    this.modalPurga.set(false);
    this.store.purgarCondominio(c.id, this.confirmacaoNome.trim());
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
