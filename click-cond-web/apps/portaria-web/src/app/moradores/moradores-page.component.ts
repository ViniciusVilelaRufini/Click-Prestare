import { Component, OnInit, computed, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CreateMorador, Morador, MoradoresApi } from './moradores.service';
import { ApartamentosApi, Apartamento } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { InputMaskDirective, validators } from '../shared/input-mask.directive';

declare var require: any;

@Component({
  selector: 'app-moradores-page',
  standalone: true,
  imports: [CommonModule, FormsModule, InputMaskDirective],
  templateUrl: './moradores-page.component.html',
})
export class MoradoresPageComponent implements OnInit {
  private api = inject(MoradoresApi);
  private aptApi = inject(ApartamentosApi);
  private confirm = inject(ConfirmService);

  constructor() {
    effect(() => {
      this.filtroTipo();
      this.search();
      untracked(() => {
        this.pagina.set(1);
      });
    });
  }

  readonly selectedMorador = signal<Morador | null>(null);

  readonly moradores = signal<Morador[]>([]);
  readonly apartamentos = signal<Apartamento[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly filtroTipo = signal<string>('');

  readonly pagina = signal(1);
  readonly itensPorPagina = 20;

  readonly totalPaginas = computed(() => {
    const total = this.moradoresFiltrados().length;
    return Math.max(1, Math.ceil(total / this.itensPorPagina));
  });

  readonly moradoresPaginados = computed(() => {
    const list = this.moradoresFiltrados();
    const p = this.pagina();
    const start = (p - 1) * this.itensPorPagina;
    const end = start + this.itensPorPagina;
    return list.slice(start, end);
  });

  readonly exibindoInicio = computed(() => {
    if (this.moradoresFiltrados().length === 0) return 0;
    return (this.pagina() - 1) * this.itensPorPagina + 1;
  });

  readonly exibindoFim = computed(() => {
    return Math.min(this.pagina() * this.itensPorPagina, this.moradoresFiltrados().length);
  });

  readonly paginasLista = computed(() => {
    const current = this.pagina();
    const total = this.totalPaginas();
    const list: number[] = [];
    
    if (total <= 5) {
      for (let i = 1; i <= total; i++) list.push(i);
    } else {
      list.push(1);
      
      if (current > 3) {
        list.push(-1);
      }
      
      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);
      
      for (let i = start; i <= end; i++) {
        if (!list.includes(i)) list.push(i);
      }
      
      if (current < total - 2) {
        list.push(-1);
      }
      
      if (!list.includes(total)) list.push(total);
    }
    return list;
  });

  // Filtro por tipo (chip buttons)
  readonly moradoresPorTipo = computed(() => {
    const t = this.filtroTipo();
    if (!t) return this.moradores();
    return this.moradores().filter((m) => (m.tipo ?? '').toLowerCase() === t);
  });

  // Filtro combinado: tipo + busca textual (local, sem chamar API)
  readonly moradoresFiltrados = computed(() => {
    const q = this.search().toLowerCase().trim();
    const list = this.moradoresPorTipo();
    if (!q) return list;
    return list.filter(m =>
      m.nome.toLowerCase().includes(q) ||
      (m.documento && m.documento.toLowerCase().includes(q)) ||
      (m.email && m.email.toLowerCase().includes(q)) ||
      (m.telefone && m.telefone.toLowerCase().includes(q)) ||
      (m.apartamento && String(m.apartamento).toLowerCase().includes(q)) ||
      (m.bloco && m.bloco.toLowerCase().includes(q))
    );
  });

  // Stats sempre baseadas em TODOS os moradores (nunca afetadas pelo filtro)
  readonly stats = computed(() => {
    const list = this.moradores();
    return {
      total: list.length,
      proprietarios: list.filter((m) => m.tipo?.toLowerCase() === 'proprietario').length,
      inquilinos: list.filter((m) => m.tipo?.toLowerCase() === 'inquilino').length,
      dependentes: list.filter((m) => m.tipo?.toLowerCase() === 'dependente').length,
    };
  });

  novo: CreateMorador = this.estadoInicial();
  showForm = false;
  editingId: number | null = null;
  readonly saving = signal(false);

  ngOnInit() {
    this.carregar();
    this.aptApi.list().subscribe({
      next: (data) => this.apartamentos.set(data),
    });
  }

  carregar() {
    this.loading.set(true);
    this.error.set(null);
    // Sempre carrega TODOS os moradores — filtro textual é feito localmente via computed
    this.api.list(undefined).subscribe({
      next: (data) => { 
        this.moradores.set(data); 
        this.pagina.set(1);
        this.loading.set(false); 
      },
      error: (e) => { this.error.set(e?.message ?? 'Erro'); this.loading.set(false); },
    });
  }

  abrirDetalhes(m: Morador) {
    this.selectedMorador.set(m);
  }

  fecharDetalhes() {
    this.selectedMorador.set(null);
  }
  abrirNovo() {
    this.editingId = null;
    this.novo = this.estadoInicial();
    this.error.set(null);
    this.showForm = true;
  }
  abrirEditar(m: Morador) {
    this.editingId = m.id;
    this.novo = {
      nome: m.nome,
      documento: m.documento ?? '',
      email: m.email ?? '',
      telefone: m.telefone ?? '',
      tipo: m.tipo ?? 'proprietario',
      id_apartamento: m.id_apartamento,
      sendCredentials: false,
    };
    this.error.set(null);
    this.showForm = true;
  }
  cancelarForm() {
    this.showForm = false;
    this.editingId = null;
    this.error.set(null);
  }
  salvar() {
    if (!this.novo.nome?.trim() || !this.novo.id_apartamento) {
      this.error.set('Nome e apartamento são obrigatórios.');
      return;
    }
    if (this.novo.email && !validators.isEmail(this.novo.email)) {
      this.error.set('E-mail inválido.');
      return;
    }
    if (this.novo.telefone && !validators.isPhone(this.novo.telefone)) {
      this.error.set('Telefone inválido. Use o formato (11) 99999-9999.');
      return;
    }
    if (this.novo.documento && !validators.isCpf(this.novo.documento)) {
      this.error.set('CPF inválido. Use o formato 000.000.000-00.');
      return;
    }
    this.saving.set(true);
    const obs = this.editingId
      ? this.api.update(this.editingId, this.novo)
      : this.api.create(this.novo);
    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelarForm();
        this.novo = this.estadoInicial();
        this.carregar();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(e?.error?.message ?? e?.message ?? 'Erro');
      },
    });
  }
  async remover(m: Morador) {
    const ok = await this.confirm.ask({
      title: 'Remover morador',
      message: `${m.nome} será desvinculado do condomínio.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.remove(m.id).subscribe({ next: () => this.carregar() });
  }
  async sendCredentials(m: Morador) {
    if (!m.email) {
      alert('Este morador não possui e-mail cadastrado.');
      return;
    }
    const ok = await this.confirm.ask({
      title: 'Enviar credenciais por e-mail',
      message: `Um e-mail com link de acesso e senha inicial será enviado para ${m.email}.`,
      confirmLabel: 'Enviar',
      variant: 'primary',
    });
    if (!ok) return;
    this.api.sendCredentials(m.id).subscribe({
      next: () => alert('Credenciais enviadas com sucesso!'),
      error: () => alert('Houve um erro ao enviar as credenciais.'),
    });
  }

  iniciais(nome: string): string {
    return nome.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('');
  }

  tipoColor(tipo: string | null): string {
    const t = (tipo ?? '').toLowerCase();
    if (t === 'proprietario') return 'bg-accent/10 border-accent/20 text-accent';
    if (t === 'inquilino') return 'bg-amber-400/10 border-amber-400/20 text-amber-400';
    if (t === 'dependente') return 'bg-slate-400/10 border-slate-400/20 text-slate-300';
    return 'bg-white/5 border-white/10 text-slate-400';
  }

  private estadoInicial(): CreateMorador {
    return { nome: '', documento: '', email: '', telefone: '', tipo: 'proprietario', id_apartamento: 0, sendCredentials: true };
  }

  // Controle de Importação em Lote (Excel/CSV)
  showBulkModal = false;
  bulkLinhas = signal<any[]>([]);
  bulkStatus = signal<'idle' | 'reading' | 'ready' | 'uploading' | 'done'>('idle');
  bulkResult = signal<{ total?: number; criados?: any[] }>({});

  downloadTemplate() {
    try {
      const xlsx = require('xlsx');
      const data = [
        {
          'Nome Completo': 'Carlos Exemplo',
          'Documento': '12345678900',
          'E-mail': 'carlos@email.com',
          'Telefone': '11988887777',
          'Quadra/Bloco': 'Quadra A',
          'Lote/Apto': 'Lote 12',
          'Vínculo': 'proprietario'
        }
      ];
      const ws = xlsx.utils.json_to_sheet(data);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Template');
      const wbout = xlsx.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'template_importacao_moradores.xlsx';
      link.click();
    } catch {
      const headers = 'Nome Completo;Documento;E-mail;Telefone;Quadra/Bloco;Lote/Apto;Vínculo\nCarlos Exemplo;12345678900;carlos@email.com;11988887777;Quadra A;Lote 12;proprietario';
      const blob = new Blob(['\ufeff' + headers], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'template_importacao_moradores.csv';
      link.click();
    }
  }

  exportarPlanilha() {
    this.api.exportExcel().subscribe({
      next: (res) => {
        const link = document.createElement('a');
        link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${res.base64}`;
        link.download = res.filename || 'moradores.xlsx';
        link.click();
      },
      error: () => alert('Erro ao exportar planilha'),
    });
  }

  onFileSelected(event: any) {
    const file = event.target?.files[0];
    if (!file) return;
    this.bulkStatus.set('reading');
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = e.target.result;
        const linhas: any[] = [];
        if (file.name.endsWith('.csv')) {
          const text = new TextDecoder().decode(data);
          const rows = text.split('\n').map(r => r.trim()).filter(r => r);
          if (rows.length > 0) {
            const header = rows[0];
            const separator = (header.split(';').length > header.split(',').length) ? ';' : ',';
            for (let i = 1; i < rows.length; i++) {
              const cols = rows[i].split(separator).map(c => c.replace(/^"|"$/g, '').trim());
              if (cols[0]) {
                linhas.push({
                  nome: cols[0],
                  documento: cols[1] || '',
                  email: cols[2] || '',
                  telefone: cols[3] || '',
                  quadra: cols[4] || '',
                  lote: cols[5] || '',
                  tipo: cols[6] || 'proprietario',
                  sendCredentials: true,
                });
              }
            }
          }
        } else {
          try {
            const xlsx = require('xlsx');
            const wb = xlsx.read(data, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const json: any[] = xlsx.utils.sheet_to_json(ws);
            json.forEach(row => {
              const nome = row['Nome Completo'] || row['Nome'] || row['nome'];
              if (nome) {
                linhas.push({
                  nome,
                  documento: row['Documento'] || row['CPF'] || '',
                  email: row['E-mail'] || row['Email'] || row['email'] || '',
                  telefone: row['Telefone'] || row['Phone'] || '',
                  quadra: row['Quadra/Bloco'] || row['Quadra'] || row['Bloco'] || '',
                  lote: row['Lote/Apto'] || row['Lote'] || row['Apto'] || '',
                  tipo: row['Vínculo'] || row['Tipo'] || 'proprietario',
                  sendCredentials: true,
                });
              }
            });
          } catch {
            alert('Para arquivos .xlsx nativos, por favor converta para .csv ou baixe nosso template em CSV padronizado.');
            this.bulkStatus.set('idle');
            return;
          }
        }
        this.bulkLinhas.set(linhas);
        this.bulkStatus.set('ready');
      } catch {
        alert('Erro ao decodificar a planilha.');
        this.bulkStatus.set('idle');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  confirmBulkImport() {
    const list = this.bulkLinhas();
    if (!list.length) return;
    this.bulkStatus.set('uploading');
    this.api.importBulk(list).subscribe({
      next: (res) => {
        this.bulkStatus.set('done');
        this.bulkResult.set(res);
        this.carregar();
      },
      error: () => {
        alert('Erro ao importar em lote');
        this.bulkStatus.set('ready');
      },
    });
  }

  fecharBulkModal() {
    this.showBulkModal = false;
    this.bulkLinhas.set([]);
    this.bulkStatus.set('idle');
    this.bulkResult.set({});
  }
}
