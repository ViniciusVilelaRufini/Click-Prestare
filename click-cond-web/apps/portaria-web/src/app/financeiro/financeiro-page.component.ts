import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinanceiroApi, Lancamento } from './financeiro.service';
import { ToastService } from '../shared/toast.service';

@Component({
  selector: 'app-financeiro-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './financeiro-page.component.html',
})
export class FinanceiroPageComponent implements OnInit {
  private api = inject(FinanceiroApi);
  // O console tem host global de toast (montado no AppComponent). Esta tela
  // usava `alert()` nativo, que destoa do resto e aparece fora do modal.
  //
  // O ConfirmService saiu junto com a última ação destrutiva desta tela
  // (remover cobrança): não há mais nada aqui para confirmar.
  private toast = inject(ToastService);

  readonly loading = signal(true);
  readonly tab = signal<'lancamentos' | 'graficos' | 'inadimplencia'>('lancamentos');

  // Dados
  readonly sumario = signal<{ totalReceita: string; totalDespesa: string; saldo: string }>({ totalReceita: 'R$ 0,00', totalDespesa: 'R$ 0,00', saldo: 'R$ 0,00' });
  readonly lancamentosMap = signal<Record<string, Lancamento[]>>({});
  readonly mesesDisponiveis = signal<any[]>([]);
  /** Cobranças de taxa que ficaram fora dos totais (ver aviso no card de receitas). */
  readonly taxasOcultas = signal(0);
  readonly inadimplentesBlocos = signal<any[]>([]);
  readonly dadosGrafico = signal<any>(null);

  // Período de Consumo
  selectedMesAno: string = '05|2026';

  // Filtros e buscas
  readonly searchCaixa = signal('');
  readonly naturezaFilter = signal<'todos' | 'C' | 'D'>('todos');
  readonly categoriaFilter = signal<string>('todos');
  // Por padrão o livro caixa exclui as taxas condominiais (vivem só na aba
  // Inadimplência) — ligar isto mostra a arrecadação junto com as despesas,
  // útil pra prestação de contas em assembleia.
  readonly incluirTaxasCondominiais = signal(false);

  readonly searchInadimplencia = signal('');
  readonly sortInadimplencia = signal<'apto' | 'qtd'>('apto');
  readonly apenasAtrasadas = signal(false);

  readonly modalDetalhe = signal(false);
  readonly selectedApto = signal<any>(null);
  readonly faturasSelected = signal<any[]>([]);
  readonly loadingDetalhe = signal(false);
  readonly enviandoCobranca = signal(false);
  readonly cobrancaResultado = signal<any>(null);

  /**
   * Erro das ações que não têm modal próprio para exibi-lo (salvar
   * lançamento, dar baixa, carregar a tela).
   *
   * Esses `subscribe` não tinham callback de erro: quando o backend recusava
   * — competência fechada, valor zerado, 403 de permissão — o botão
   * simplesmente não fazia nada e a mensagem em português que a API manda
   * era descartada. O operador clicava de novo achando que tinha errado o
   * clique.
   */
  readonly erro = signal<string | null>(null);

  /** Mensagem do NestJS, com fallback quando o servidor não respondeu. */
  private msgErro(e: any, acaoFalhou: string): string {
    const msg = e?.error?.message;
    if (Array.isArray(msg)) return msg.join(', ');
    if (msg) return String(msg);
    if (e?.status === 0) return `${acaoFalhou}: sem conexão com o servidor.`;
    return `${acaoFalhou}. Tente novamente.`;
  }

  // Export CSV
  readonly exportandoCsv = signal(false);

  // Filtro e Ordenação de Inadimplência
  getFilteredInadimplentes() {
    const query = this.searchInadimplencia().toLowerCase().trim();
    const sortBy = this.sortInadimplencia();
    const soAtrasadas = this.apenasAtrasadas();
    const blocks = this.inadimplentesBlocos();

    if (!query && sortBy === 'apto' && !soAtrasadas) {
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
      if (soAtrasadas) {
        filteredAptos = filteredAptos.filter(a => (a.atrasadas || 0) > 0);
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

  // Resumo agregado da aba de inadimplência, calculado sobre a lista já
  // filtrada (respeita busca e o toggle "só atrasadas") para refletir o que
  // o operador está vendo na tela.
  resumoInadimplencia() {
    const blocos = this.getFilteredInadimplentes();
    let aptosPendentes = 0;
    let totalAtrasadas = 0;
    let blocosAtencao = 0;
    for (const b of blocos) {
      aptosPendentes += b.aptos.length;
      let temAtraso = false;
      for (const a of b.aptos) {
        const atr = a.atrasadas || 0;
        totalAtrasadas += atr;
        if (atr > 0) temAtraso = true;
      }
      if (temAtraso) blocosAtencao++;
    }
    return { aptosPendentes, totalAtrasadas, blocosAtencao };
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

  /**
   * Livro caixa já filtrado, agrupado por dia.
   *
   * Isto era um método chamado pelo template que gravava o resultado num campo
   * (`_filteredLancamentosMap`) para o método seguinte ler. Ou seja: escrita
   * durante a renderização, e correto só enquanto o template chamasse os dois
   * na ordem certa — quem invertesse os blocos no HTML lia o filtro do ciclo
   * anterior. Além disso refiltrava a lista inteira a cada ciclo de detecção
   * de mudanças, mesmo sem nada ter mudado.
   *
   * Como `computed`, o resultado é derivado dos signals de origem e só
   * recalcula quando um deles muda.
   */
  private readonly filteredLancamentosMap = computed<Record<string, Lancamento[]>>(() => {
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

    return filteredMap;
  });

  getFilteredDiasChaves(): string[] {
    return Object.keys(this.filteredLancamentosMap());
  }

  getFilteredLancamentos(diaChave: string): Lancamento[] {
    return this.filteredLancamentosMap()[diaChave] || [];
  }

  ngOnInit() {
    // Configura o mês atual inicialmente
    const hoje = new Date();
    const mStr = hoje.getMonth() + 1 < 10 ? '0' + (hoje.getMonth() + 1) : String(hoje.getMonth() + 1);
    this.selectedMesAno = `${mStr}|${hoje.getFullYear()}`;

    this.carregarDados();
    this.carregarInadimplencia();
  }

  carregarDados() {
    this.loading.set(true);
    this.erro.set(null);
    const [m, a] = this.selectedMesAno.split('|');

    this.api.listLancamentos(m, a, this.incluirTaxasCondominiais()).subscribe({
      next: (res) => {
        this.lancamentosMap.set(res?.lancamentos || {});
        this.taxasOcultas.set(Number(res?.taxasCondominiaisOcultas ?? 0));
        this.sumario.set({
          totalReceita: res?.totalReceita || 'R$ 0,00',
          totalDespesa: res?.totalDespesa || 'R$ 0,00',
          saldo: res?.saldo || 'R$ 0,00',
        });

        if (res?.meses && Array.isArray(res.meses)) {
          this.mesesDisponiveis.set(res.meses);
        }

        // Aproveita e carrega o gráfico associado a este mês
        this.api.getGrafico(m, a).subscribe({
          next: (graf) => {
            this.dadosGrafico.set(graf);
            this.loading.set(false);
          },
          // O gráfico é acessório: se falhar, a tela continua utilizável com
          // o livro caixa que já chegou.
          error: () => this.loading.set(false),
        });
      },
      error: (e) => {
        // `loading` era desligado só dentro do subscribe aninhado do gráfico.
        // Falhando aqui, ele nunca voltava a false e a tela ficava em
        // spinner infinito, sem dizer o que houve.
        this.loading.set(false);
        this.lancamentosMap.set({});
        this.erro.set(this.msgErro(e, 'Falha ao carregar o financeiro'));
      },
    });
  }

  carregarInadimplencia() {
    this.api.listInadimplentes().subscribe({
      next: (res) => this.inadimplentesBlocos.set(res?.blocos || []),
      error: (e) => this.erro.set(this.msgErro(e, 'Falha ao carregar a inadimplência')),
    });
  }

  exportarCsv() {
    if (this.exportandoCsv()) return;
    const [m, a] = this.selectedMesAno.split('|');
    this.exportandoCsv.set(true);
    this.api.exportCsv(m, a, this.incluirTaxasCondominiais()).subscribe({
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
      error: (e) => {
        this.exportandoCsv.set(false);
        // Sem isto, clicar em "Exportar CSV" e não baixar nada era
        // indistinguível de um clique que não registrou.
        this.erro.set(this.msgErro(e, 'Falha ao exportar o livro caixa'));
      },
    });
  }

  onPeriodoChange() {
    this.carregarDados();
  }

  toggleIncluirTaxasCondominiais() {
    this.incluirTaxasCondominiais.update((v) => !v);
    this.carregarDados();
  }

  getDiasChaves(): string[] {
    return Object.keys(this.lancamentosMap());
  }

  formatFaturaNome(nome: string): string {
    if (!nome) return '';
    return nome.replace(/^Apto\s+\S+\s+Bloco\s+\S+\s*-\s*/i, '')
               .replace(/^Apto\s+\S+\s+Bloco\s+Bloco\s+\S+\s*-\s*/i, '');
  }

  formatBlocoNome(bloco: string): string {
    if (!bloco) return 'Sem Bloco';
    const clean = bloco.replace(/^bloco\s+/i, '').trim();
    return `Bloco ${clean}`;
  }

  /**
   * Resumo do histórico de pendências da unidade aberta.
   *
   * O modal listava as faturas sem nunca dizer quanto a unidade deve no total
   * — a conta ficava com o síndico, que abre essa tela justamente para falar
   * um número com o morador.
   */
  readonly resumoDetalhe = computed(() => {
    const faturas = this.faturasSelected();
    const total = faturas.reduce((soma, f) => soma + (Number(f?.valor) || 0), 0);
    return {
      quantidade: faturas.length,
      atrasadas: faturas.filter((f) => f?.atrasado).length,
      totalString: total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    };
  });

  /**
   * Dias de atraso a partir do vencimento em `dd/mm/aaaa`.
   *
   * "Venc. 01/08/2026" obriga quem lê a fazer a conta de cabeça; "há 40 dias" é
   * a informação que ele queria. Devolve 0 para o que ainda não venceu.
   */
  diasAtraso(dataVencimento: string): number {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((dataVencimento ?? '').trim());
    if (!m) return 0;
    const venc = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dias = Math.floor((hoje.getTime() - venc.getTime()) / 86400000);
    return dias > 0 ? dias : 0;
  }

  /**
   * Copia código de barras ou Pix. É o caminho pelo qual o síndico repassa a
   * cobrança para o morador no WhatsApp, sem precisar abrir o PDF.
   */
  copiarCobranca(texto: string | null | undefined, rotulo: string) {
    const valor = (texto ?? '').trim();
    if (!valor) {
      this.toast.info(`Esta cobrança não tem ${rotulo}.`);
      return;
    }
    navigator.clipboard?.writeText(valor).then(
      () => this.toast.success(`${rotulo} copiado.`),
      () => this.toast.error(`Não foi possível copiar o ${rotulo}.`),
    );
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

}
