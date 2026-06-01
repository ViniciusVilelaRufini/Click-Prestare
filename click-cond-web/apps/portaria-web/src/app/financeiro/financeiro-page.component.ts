import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinanceiroApi, Fechamento, Lancamento } from './financeiro.service';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-financeiro-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './financeiro-page.component.html',
})
export class FinanceiroPageComponent implements OnInit {
  private api = inject(FinanceiroApi);
  private auth = inject(AuthService);

  readonly loading = signal(true);
  readonly tab = signal<'lancamentos' | 'graficos' | 'inadimplencia'>('lancamentos');

  // Dados
  readonly sumario = signal<{ totalReceita: string; totalDespesa: string; saldo: string }>({ totalReceita: 'R$ 0,00', totalDespesa: 'R$ 0,00', saldo: 'R$ 0,00' });
  readonly lancamentosMap = signal<Record<string, Lancamento[]>>({});
  readonly mesesDisponiveis = signal<any[]>([]);
  readonly inadimplentesBlocos = signal<any[]>([]);
  readonly dadosGrafico = signal<any>(null);

  // Período de Consumo
  selectedMesAno: string = '05|2026';

  // Filtros e buscas
  readonly searchCaixa = signal('');
  readonly naturezaFilter = signal<'todos' | 'C' | 'D'>('todos');
  readonly categoriaFilter = signal<string>('todos');

  readonly searchInadimplencia = signal('');
  readonly sortInadimplencia = signal<'apto' | 'qtd'>('apto');

  // Modais
  readonly modalLancamento = signal(false);
  novoLancamento: any = { nome: '', tipo: 'C', valor: null, data: '', data_vencimento: '', categoria: 'Taxa Condominial' };

  readonly modalDetalhe = signal(false);
  readonly selectedApto = signal<any>(null);
  readonly faturasSelected = signal<any[]>([]);
  readonly loadingDetalhe = signal(false);
  readonly enviandoCobranca = signal(false);
  readonly cobrancaResultado = signal<any>(null);

  // Upload de boleto/comprovante por lançamento
  readonly uploadingId = signal<number | null>(null);
  readonly uploadError = signal<string | null>(null);

  // Export CSV
  readonly exportandoCsv = signal(false);

  // Modal de confirmação de pagamento (segregação soft de funções).
  // Aparece quando o operador marca como pago um lançamento que ele mesmo
  // criou — exige motivo + forma de pagamento. Caso comum: porteiro abre
  // "Conta de luz" e marca como pago porque o síndico pagou em dinheiro.
  readonly modalConfirmarPagamento = signal(false);
  readonly lancamentoAConfirmar = signal<Lancamento | null>(null);
  readonly confirmando = signal(false);
  readonly confirmarErro = signal<string | null>(null);
  confirmarMotivo = '';
  confirmarFormaPagamento = '';
  confirmarIdentificador = '';

  // Fechamento mensal — lista de competências fechadas do condomínio.
  // O Map é por chave "MM-AAAA" para lookup O(1) na renderização.
  readonly fechamentos = signal<Fechamento[]>([]);
  readonly modalFecharMes = signal(false);
  readonly modalReabrirMes = signal(false);
  readonly processandoFechamento = signal(false);
  readonly erroFechamento = signal<string | null>(null);
  observacaoFechamento = '';
  motivoReabertura = '';

  /** True se o mês selecionado está fechado (e ativo). */
  mesSelecionadoFechado(): boolean {
    const [m, a] = this.selectedMesAno.split('|');
    return this.fechamentos().some(
      (f) => f.ativo === 1 && f.mes === Number(m) && f.ano === Number(a),
    );
  }

  fechamentoDoMes(): Fechamento | null {
    const [m, a] = this.selectedMesAno.split('|');
    return (
      this.fechamentos().find(
        (f) => f.ativo === 1 && f.mes === Number(m) && f.ano === Number(a),
      ) ?? null
    );
  }

  /** Formas de pagamento disponíveis no modal. */
  readonly formasPagamento = [
    { value: 'PIX', label: 'PIX' },
    { value: 'Dinheiro', label: 'Dinheiro' },
    { value: 'Transferência bancária', label: 'Transferência bancária' },
    { value: 'Débito automático', label: 'Débito automático' },
    { value: 'Cartão de crédito', label: 'Cartão de crédito' },
    { value: 'Cartão de débito', label: 'Cartão de débito' },
    { value: 'Boleto', label: 'Boleto' },
    { value: 'Cheque', label: 'Cheque' },
    { value: 'Outro', label: 'Outro' },
  ];

  // Conciliação Bancária
  readonly modalConciliacao = signal(false);
  readonly ofxTransactions = signal<any[]>([]);
  readonly unpaidList = signal<any[]>([]);
  readonly loadingOfx = signal(false);
  readonly conciliando = signal(false);

  // Filtro e Ordenação de Inadimplência
  getFilteredInadimplentes() {
    const query = this.searchInadimplencia().toLowerCase().trim();
    const sortBy = this.sortInadimplencia();
    const blocks = this.inadimplentesBlocos();

    if (!query && sortBy === 'apto') {
      return blocks;
    }

    return blocks.map(b => {
      let filteredAptos = [...(b.aptos || [])];
      if (query) {
        filteredAptos = filteredAptos.filter(a =>
          a.apto.toLowerCase().includes(query) ||
          b.bloco.toLowerCase().includes(query)
        );
      }
      if (sortBy === 'qtd') {
        filteredAptos.sort((x, y) => (y.qtd || 0) - (x.qtd || 0));
      } else {
        filteredAptos.sort((x, y) => x.apto.localeCompare(y.apto, undefined, { numeric: true }));
      }
      return {
        ...b,
        aptos: filteredAptos
      };
    }).filter(b => b.aptos.length > 0);
  }

  // Filtros Dinâmicos do Livro Caixa
  getCategoriasDisponiveis(): string[] {
    const list: string[] = [];
    const map = this.lancamentosMap();
    for (const key of Object.keys(map)) {
      for (const item of map[key]) {
        if (item.categoria && !list.includes(item.categoria)) {
          list.push(item.categoria);
        }
      }
    }
    return list.sort();
  }

  _filteredLancamentosMap: Record<string, Lancamento[]> = {};

  getFilteredDiasChaves(): string[] {
    const query = this.searchCaixa().toLowerCase().trim();
    const nat = this.naturezaFilter();
    const cat = this.categoriaFilter();
    const map = this.lancamentosMap();

    const filteredMap: Record<string, Lancamento[]> = {};

    for (const dateKey of Object.keys(map)) {
      const items = map[dateKey].filter(item => {
        const matchesQuery = !query ||
          item.nome.toLowerCase().includes(query) ||
          (item.categoria && item.categoria.toLowerCase().includes(query)) ||
          (item.nome_operador && item.nome_operador.toLowerCase().includes(query));

        const matchesNat = nat === 'todos' || item.tipo === nat;
        const matchesCat = cat === 'todos' || item.categoria === cat;

        return matchesQuery && matchesNat && matchesCat;
      });

      if (items.length > 0) {
        filteredMap[dateKey] = items;
      }
    }

    this._filteredLancamentosMap = filteredMap;
    return Object.keys(filteredMap);
  }

  getFilteredLancamentos(diaChave: string): Lancamento[] {
    return this._filteredLancamentosMap[diaChave] || [];
  }

  // Categorias do Formulário de Lançamento
  getCategoriasParaForm(): string[] {
    if (this.novoLancamento.tipo === 'C') {
      return ['Taxa Condominial', 'Fundo de Reserva', 'Multas/Juros', 'Locação de Área Comum', 'Outras Receitas'];
    } else {
      return ['Água e Esgoto', 'Energia Elétrica', 'Manutenção', 'Segurança', 'Limpeza/Conservação', 'Administração', 'Outras Despesas'];
    }
  }

  onFormTipoChange() {
    const cats = this.getCategoriasParaForm();
    if (cats.length > 0) {
      this.novoLancamento.categoria = cats[0];
    }
  }

  // Configuração Automática de Recorrência e Régua de Cobrança
  readonly modalConfigAuto = signal(false);
  readonly savingConfigAuto = signal(false);
  readonly configAutoErro = signal<string | null>(null);
  readonly apartamentosConfig = signal<any[]>([]);

  configAutoData: any = {
    recorrencia_ativa: false,
    valor_condominio: 0,
    dia_geracao: 1,
    dia_vencimento: 10,
    categoria_padrao: 'Taxa Condominial',
    mes_inicio_recorrencia: null,
    ano_inicio_recorrencia: null,
    cobranca_auto_whats: false,
    dias_atraso_aviso_1: 1,
    dias_atraso_aviso_2: 5,
    dias_atraso_aviso_3: 10,
  };

  abrirModalConfigAuto() {
    this.configAutoErro.set(null);

    // Buscar apartamentos config
    this.api.getApartamentosConfig().subscribe({
      next: (aptos) => {
        this.apartamentosConfig.set(aptos || []);
      },
      error: () => {
        this.apartamentosConfig.set([]);
      }
    });

    this.api.getConfigAuto().subscribe({
      next: (res) => {
        if (res) {
          this.configAutoData = {
            recorrencia_ativa: res.recorrencia_ativa ?? false,
            valor_condominio: Number(res.valor_condominio ?? 0),
            dia_geracao: res.dia_geracao ?? 1,
            dia_vencimento: res.dia_vencimento ?? 10,
            categoria_padrao: res.categoria_padrao ?? 'Taxa Condominial',
            mes_inicio_recorrencia: res.mes_inicio_recorrencia ?? null,
            ano_inicio_recorrencia: res.ano_inicio_recorrencia ?? null,
            cobranca_auto_whats: res.cobranca_auto_whats ?? false,
            dias_atraso_aviso_1: res.dias_atraso_aviso_1 ?? 1,
            dias_atraso_aviso_2: res.dias_atraso_aviso_2 ?? 5,
            dias_atraso_aviso_3: res.dias_atraso_aviso_3 ?? 10,
          };
        }
        this.modalConfigAuto.set(true);
      },
      error: (err) => {
        this.configAutoErro.set(err?.error?.message ?? 'Falha ao buscar configurações.');
        this.modalConfigAuto.set(true);
      }
    });
  }

  toggleApartamentoRecorrencia(apto: any) {
    const novoStatus = !apto.ignorar_recorrencia;
    this.api.updateApartamentoRecorrencia(apto.id, novoStatus).subscribe({
      next: () => {
        const list = this.apartamentosConfig().map(a => {
          if (a.id === apto.id) {
            return { ...a, ignorar_recorrencia: novoStatus };
          }
          return a;
        });
        this.apartamentosConfig.set(list);
      },
      error: (err) => {
        alert(err?.error?.message ?? 'Falha ao alterar configuração do apartamento.');
      }
    });
  }

  salvarConfigAuto() {
    this.savingConfigAuto.set(true);
    this.configAutoErro.set(null);

    // Ajustar campos opcionais caso venham como strings vazias ou nulas do select
    const payload = {
      ...this.configAutoData,
      mes_inicio_recorrencia: this.configAutoData.mes_inicio_recorrencia ? Number(this.configAutoData.mes_inicio_recorrencia) : null,
      ano_inicio_recorrencia: this.configAutoData.ano_inicio_recorrencia ? Number(this.configAutoData.ano_inicio_recorrencia) : null,
    };

    this.api.updateConfigAuto(payload).subscribe({
      next: () => {
        this.savingConfigAuto.set(false);
        this.modalConfigAuto.set(false);
      },
      error: (err) => {
        this.savingConfigAuto.set(false);
        this.configAutoErro.set(err?.error?.message ?? 'Falha ao salvar configurações.');
      }
    });
  }

  ngOnInit() {
    // Configura o mês atual inicialmente
    const hoje = new Date();
    const mStr = hoje.getMonth() + 1 < 10 ? '0' + (hoje.getMonth() + 1) : String(hoje.getMonth() + 1);
    this.selectedMesAno = `${mStr}|${hoje.getFullYear()}`;

    this.carregarDados();
    this.carregarInadimplencia();
    this.carregarFechamentos();
  }

  carregarFechamentos() {
    this.api.listarFechamentos().subscribe({
      next: (lista) => this.fechamentos.set(lista ?? []),
      error: () => this.fechamentos.set([]),
    });
  }

  abrirModalFecharMes() {
    this.observacaoFechamento = '';
    this.erroFechamento.set(null);
    this.modalFecharMes.set(true);
  }

  abrirModalReabrirMes() {
    this.motivoReabertura = '';
    this.erroFechamento.set(null);
    this.modalReabrirMes.set(true);
  }

  cancelarModalFechamento() {
    this.modalFecharMes.set(false);
    this.modalReabrirMes.set(false);
  }

  confirmarFecharMes() {
    const [m, a] = this.selectedMesAno.split('|');
    this.processandoFechamento.set(true);
    this.erroFechamento.set(null);
    this.api.fecharMes(Number(m), Number(a), this.observacaoFechamento.trim() || undefined).subscribe({
      next: () => {
        this.processandoFechamento.set(false);
        this.modalFecharMes.set(false);
        this.carregarFechamentos();
      },
      error: (err) => {
        this.processandoFechamento.set(false);
        this.erroFechamento.set(err?.error?.message ?? 'Falha ao fechar competência.');
      },
    });
  }

  confirmarReabrirMes() {
    const motivo = this.motivoReabertura.trim();
    if (motivo.length < 10) {
      this.erroFechamento.set('Motivo precisa ter pelo menos 10 caracteres.');
      return;
    }
    const [m, a] = this.selectedMesAno.split('|');
    this.processandoFechamento.set(true);
    this.erroFechamento.set(null);
    this.api.reabrirMes(Number(m), Number(a), motivo).subscribe({
      next: () => {
        this.processandoFechamento.set(false);
        this.modalReabrirMes.set(false);
        this.carregarFechamentos();
      },
      error: (err) => {
        this.processandoFechamento.set(false);
        this.erroFechamento.set(err?.error?.message ?? 'Falha ao reabrir competência.');
      },
    });
  }

  carregarDados() {
    this.loading.set(true);
    const [m, a] = this.selectedMesAno.split('|');

    this.api.listLancamentos(m, a).subscribe(res => {
      this.lancamentosMap.set(res?.lancamentos || {});
      this.sumario.set({
        totalReceita: res?.totalReceita || 'R$ 0,00',
        totalDespesa: res?.totalDespesa || 'R$ 0,00',
        saldo: res?.saldo || 'R$ 0,00',
      });

      if (res?.meses && Array.isArray(res.meses)) {
        this.mesesDisponiveis.set(res.meses);
      }

      // Aproveita e carrega o gráfico associado a este mês
      this.api.getGrafico(m, a).subscribe(graf => {
        this.dadosGrafico.set(graf);
        this.loading.set(false);
      });
    });
  }

  carregarInadimplencia() {
    this.api.listInadimplentes().subscribe(res => {
      this.inadimplentesBlocos.set(res?.blocos || []);
    });
  }

  exportarCsv() {
    if (this.exportandoCsv()) return;
    const [m, a] = this.selectedMesAno.split('|');
    this.exportandoCsv.set(true);
    this.api.exportCsv(m, a).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `livro_caixa_${m}-${a}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        this.exportandoCsv.set(false);
      },
      error: () => {
        this.exportandoCsv.set(false);
      },
    });
  }

  onPeriodoChange() {
    this.carregarDados();
  }

  getDiasChaves(): string[] {
    return Object.keys(this.lancamentosMap());
  }

  /**
   * Verifica se o operador logado é o mesmo que criou o lançamento.
   * Usado para decidir se mostra o modal de confirmação (segregação soft).
   */
  private isAutoAprovacao(item: Lancamento): boolean {
    const nomeOperador = this.auth.porteiroInfo()?.nome?.trim().toLowerCase();
    const nomeAutor = item.nome_operador?.trim().toLowerCase();
    return !!nomeOperador && !!nomeAutor && nomeOperador === nomeAutor;
  }

  // Ações Operacionais
  alternarPago(item: Lancamento) {
    const novoStatus = item.pago === 1 ? 0 : 1;
    // Marcar como pago + autor mesmo: abre modal de justificativa.
    // Desmarcar (pago→não pago) ou marcar lançamento de outro operador:
    // segue direto sem modal.
    if (novoStatus === 1 && this.isAutoAprovacao(item)) {
      this.abrirModalConfirmarPagamento(item);
      return;
    }
    this.api.updateStatus(item.id, novoStatus).subscribe(() => {
      this.carregarDados();
    });
  }

  aprovarPagamento(id: number) {
    // Localiza o item nos lançamentos para detectar auto-aprovação.
    const item = this.findLancamentoById(id);
    if (item && this.isAutoAprovacao(item)) {
      this.abrirModalConfirmarPagamento(item);
      return;
    }
    this.api.updateStatus(id, 1).subscribe(() => {
      this.carregarDados();
    });
  }

  private findLancamentoById(id: number): Lancamento | null {
    const map = this.lancamentosMap();
    for (const dia of Object.keys(map)) {
      const found = map[dia].find((l) => l.id === id);
      if (found) return found;
    }
    return null;
  }

  abrirModalConfirmarPagamento(item: Lancamento) {
    this.lancamentoAConfirmar.set(item);
    this.confirmarMotivo = '';
    this.confirmarFormaPagamento = 'PIX';
    this.confirmarIdentificador = '';
    this.confirmarErro.set(null);
    this.modalConfirmarPagamento.set(true);
  }

  cancelarConfirmarPagamento() {
    this.modalConfirmarPagamento.set(false);
    this.lancamentoAConfirmar.set(null);
  }

  confirmarPagamento() {
    const item = this.lancamentoAConfirmar();
    if (!item) return;

    const motivo = this.confirmarMotivo.trim();
    if (motivo.length < 5) {
      this.confirmarErro.set('Motivo precisa ter pelo menos 5 caracteres.');
      return;
    }
    if (!this.confirmarFormaPagamento) {
      this.confirmarErro.set('Selecione a forma de pagamento.');
      return;
    }

    this.confirmando.set(true);
    this.confirmarErro.set(null);
    this.api
      .updateStatus(item.id, 1, {
        motivo,
        formaPagamento: this.confirmarFormaPagamento,
        identificadorComprovante: this.confirmarIdentificador.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.confirmando.set(false);
          this.modalConfirmarPagamento.set(false);
          this.lancamentoAConfirmar.set(null);
          this.carregarDados();
        },
        error: (err) => {
          this.confirmando.set(false);
          this.confirmarErro.set(err?.error?.message ?? 'Falha ao confirmar pagamento.');
        },
      });
  }

  abrirModalLancamento() {
    const hoje = new Date();
    const dFmt = hoje.toLocaleDateString('pt-BR');
    this.novoLancamento = { nome: '', tipo: 'C', valor: null, data: dFmt, data_vencimento: dFmt, categoria: 'Taxa Condominial' };
    this.modalLancamento.set(true);
  }

  salvarLancamento() {
    this.api.insertLancamento(this.novoLancamento).subscribe(() => {
      this.modalLancamento.set(false);
      this.carregarDados();
    });
  }

  /** Dispara o seletor de arquivo para subir boleto ou comprovante. */
  abrirUpload(item: Lancamento, tipo: 'boleto' | 'comprovante') {
    this.uploadError.set(null);
    const inputEl = document.createElement('input');
    inputEl.type = 'file';
    inputEl.accept = tipo === 'boleto' ? 'application/pdf,image/*' : 'image/*,application/pdf';
    inputEl.onchange = () => {
      const file = inputEl.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        this.uploadError.set('Arquivo maior que 5MB. Comprima e tente novamente.');
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => this.uploadError.set('Falha ao ler o arquivo.');
      reader.onload = () => {
        const dataUrl = String(reader.result ?? '');
        this.enviarArquivo(item.id, dataUrl, tipo);
      };
      reader.readAsDataURL(file);
    };
    inputEl.click();
  }

  private enviarArquivo(id: number, dataUrl: string, tipo: 'boleto' | 'comprovante') {
    this.uploadingId.set(id);
    this.api.uploadSharedFile(id, dataUrl, tipo).subscribe({
      next: () => {
        this.uploadingId.set(null);
        this.carregarDados();
      },
      error: (e) => {
        this.uploadingId.set(null);
        this.uploadError.set(`Falha ao subir ${tipo}: ${e?.error?.message ?? e?.message ?? 'erro'}`);
      },
    });
  }

  abrirDetalhesApto(apto: any) {
    this.selectedApto.set(apto);
    this.faturasSelected.set([]);
    this.cobrancaResultado.set(null);
    this.loadingDetalhe.set(true);
    this.modalDetalhe.set(true);

    this.api.getInadimplenteDetail(apto.apto, apto.bloco).subscribe({
      next: (faturas) => {
        this.faturasSelected.set(faturas || []);
        this.loadingDetalhe.set(false);
      },
      error: () => {
        this.loadingDetalhe.set(false);
      }
    });
  }

  enviarNotificacaoCobranca() {
    const apto = this.selectedApto();
    if (!apto) return;

    this.enviandoCobranca.set(true);
    this.cobrancaResultado.set(null);

    this.api.notifyInadimplente(apto.apto, apto.bloco).subscribe({
      next: (res) => {
        this.enviandoCobranca.set(false);
        this.cobrancaResultado.set({
          success: res.success,
          message: res.message || 'Cobrança enviada com sucesso!',
          moradoresNotificados: res.moradoresNotificados ?? 0,
          pushEnviados: res.pushEnviados ?? 0,
          emailsEnviados: res.emailsEnviados ?? 0,
        });
      },
      error: (err) => {
        this.enviandoCobranca.set(false);
        this.cobrancaResultado.set({
          success: false,
          message: err?.error?.message ?? 'Falha ao enviar cobrança.'
        });
      }
    });
  }

  triggerOfxUpload() {
    this.uploadError.set(null);
    const inputEl = document.createElement('input');
    inputEl.type = 'file';
    inputEl.accept = '.ofx';
    inputEl.onchange = () => {
      const file = inputEl.files?.[0];
      if (!file) return;
      
      this.loadingOfx.set(true);
      this.modalConciliacao.set(true);
      
      const reader = new FileReader();
      reader.onerror = () => {
        this.uploadError.set('Falha ao ler o arquivo OFX.');
        this.loadingOfx.set(false);
      };
      reader.onload = () => {
        const textContent = String(reader.result ?? '');
        this.api.importarOfx(textContent).subscribe({
          next: (res) => {
            this.ofxTransactions.set(res?.results || []);
            this.unpaidList.set(res?.unpaid || []);
            this.loadingOfx.set(false);
          },
          error: (e) => {
            this.uploadError.set(`Erro ao importar OFX: ${e?.error?.message ?? e?.message}`);
            this.loadingOfx.set(false);
            this.modalConciliacao.set(false);
          }
        });
      };
      reader.readAsText(file);
    };
    inputEl.click();
  }

  cancelarConciliacao() {
    this.modalConciliacao.set(false);
    this.ofxTransactions.set([]);
    this.unpaidList.set([]);
    this.loadingOfx.set(false);
    this.conciliando.set(false);
  }

  onSuggestionChange(txIndex: number, newDbIdStr: string) {
    const dbId = Number(newDbIdStr);
    const list = [...this.ofxTransactions()];
    const tx = list[txIndex];
    if (!dbId) {
      tx.suggestion = null;
      tx.matchType = 'none';
    } else {
      const found = this.unpaidList().find(u => u.id === dbId);
      if (found) {
        tx.suggestion = {
          id: found.id,
          nome: found.nome,
          tipo: found.tipo,
          valor: found.valor,
          data_vencimento: found.data_vencimento,
          categoria: found.categoria,
        };
        tx.matchType = 'partial';
      }
    }
    this.ofxTransactions.set(list);
  }

  confirmarReconciliacao() {
    const list = this.ofxTransactions();
    const payload = list
      .filter(tx => tx.suggestion && tx.suggestion.id)
      .map(tx => ({
        databaseId: Number(tx.suggestion.id),
        dataPagamento: tx.ofxTx.date,
      }));

    if (payload.length === 0) {
      alert('Nenhuma conciliação selecionada.');
      return;
    }

    this.conciliando.set(true);
    this.api.confirmarConciliacao(payload).subscribe({
      next: () => {
        this.cancelarConciliacao();
        this.carregarDados();
      },
      error: (e) => {
        alert(`Erro ao salvar conciliação: ${e?.error?.message ?? e?.message}`);
        this.conciliando.set(false);
      }
    });
  }
}
