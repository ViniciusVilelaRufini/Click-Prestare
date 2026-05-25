import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinanceiroApi, Lancamento } from './financeiro.service';

@Component({
  selector: 'app-financeiro-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './financeiro-page.component.html',
})
export class FinanceiroPageComponent implements OnInit {
  private api = inject(FinanceiroApi);

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

  onPeriodoChange() {
    this.carregarDados();
  }

  getDiasChaves(): string[] {
    return Object.keys(this.lancamentosMap());
  }

  // Ações Operacionais
  alternarPago(item: Lancamento) {
    const novoStatus = item.pago === 1 ? 0 : 1;
    this.api.updateStatus(item.id, novoStatus).subscribe(() => {
      this.carregarDados();
    });
  }

  aprovarPagamento(id: number) {
    // Status 1 = Aprovado/Pago
    this.api.updateStatus(id, 1).subscribe(() => {
      this.carregarDados();
    });
  }

  abrirModalLancamento() {
    const hoje = new Date();
    const dFmt = hoje.toLocaleDateString('pt-BR');
    this.novoLancamento = { nome: '', tipo: 'C', valor: null, data: dFmt, data_vencimento: dFmt, categoria: 'Receitas' };
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
}
