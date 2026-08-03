import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Apartamento, ApartamentosApi, CreateApartamento,
} from './apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { HttpClient } from '@angular/common/http';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';
import { MoradoresApi } from '../moradores/moradores.service';
import { VagasApi, VagasResumo, VagaBeneficiarios } from './vagas.service';

declare var require: any;

@Component({
  selector: 'app-apartamentos-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './apartamentos-page.component.html',
})
export class ApartamentosPageComponent implements OnInit {
  private api = inject(ApartamentosApi);
  private confirm = inject(ConfirmService);
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private moradoresApi = inject(MoradoresApi);
  private vagasApi = inject(VagasApi);

  // Painel de moradores
  showMoradoresPanel = false;
  moradoresBlocoNome = '';
  moradoresApto: Apartamento | null = null;
  readonly moradores = signal<any[]>([]);
  readonly loadingMoradores = signal(false);

  // Form de adicionar morador no modal
  showAddMoradorForm = false;
  novoMorador = {
    nome: '',
    documento: '',
    email: '',
    telefone: '',
    tipo: 'proprietario'
  };
  readonly savingMorador = signal(false);
  readonly errorMorador = signal<string | null>(null);
  readonly apartamentos = signal<Apartamento[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly viewMode = signal<'grid' | 'tabela'>('grid');

  readonly blocos = computed(() => {
    const map = new Map<string, Apartamento[]>();
    for (const a of this.apartamentos()) {
      const k = a.bloco || 'Sem bloco';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    return Array.from(map.entries())
      .map(([nome, aptos]) => ({ nome, aptos: aptos.sort((x,y) => x.apto.localeCompare(y.apto, 'pt', { numeric: true })) }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  });

  readonly apartamentosOrdenados = computed(() => {
    return [...this.apartamentos()].sort((x, y) => {
      const blocoA = x.bloco || '';
      const blocoB = y.bloco || '';
      const blocoComp = blocoA.localeCompare(blocoB);
      if (blocoComp !== 0) return blocoComp;
      return x.apto.localeCompare(y.apto, 'pt', { numeric: true });
    });
  });

  readonly totalMoradores = computed(() =>
    this.apartamentos().reduce((sum, a) => sum + (a.qtdMoradores ?? 0), 0),
  );
  readonly aptosOcupados = computed(() =>
    this.apartamentos().filter((a) => (a.qtdMoradores ?? 0) > 0).length,
  );
  readonly aptosVazios = computed(() => this.apartamentos().length - this.aptosOcupados());

  novo: CreateApartamento = { apto: '', bloco: '', fracao: '' };
  showForm = false;
  editingId: number | null = null;
  readonly saving = signal(false);

  ngOnInit() { this.carregar(); }

  carregar() {
    this.loading.set(true);
    this.api.list(this.search() || undefined).subscribe({
      next: (data) => { this.apartamentos.set(data); this.loading.set(false); },
      error: (e) => { this.error.set(e?.message ?? 'Erro'); this.loading.set(false); },
    });
  }
  abrirNovo() {
    this.editingId = null;
    this.novo = { apto: '', bloco: '', fracao: '', qtd_vagas: 0 };
    this.error.set(null);
    this.showForm = true;
  }
  abrirEditar(a: Apartamento) {
    this.editingId = a.id;
    this.novo = { apto: a.apto, bloco: a.bloco ?? '', fracao: a.fracao ?? '', qtd_vagas: a.qtd_vagas ?? 0 };
    this.error.set(null);
    this.showForm = true;
  }
  cancelarForm() {
    this.showForm = false;
    this.editingId = null;
    this.error.set(null);
  }
  salvar() {
    if (!this.novo.apto?.trim()) { this.error.set('Apto é obrigatório.'); return; }
    this.saving.set(true);
    const obs = this.editingId
      ? this.api.update(this.editingId, this.novo)
      : this.api.create(this.novo);
    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelarForm();
        this.novo = { apto: '', bloco: '', fracao: '', qtd_vagas: 0 };
        this.carregar();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(e?.error?.message ?? e?.message ?? 'Erro');
      },
    });
  }
  async remover(a: Apartamento) {
    const ok = await this.confirm.ask({
      title: 'Remover apartamento',
      message: `O apto ${a.bloco ? a.bloco + ' / ' : ''}${a.apto} será removido. Moradores vinculados serão desvinculados.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.remove(a.id).subscribe({ next: () => this.carregar() });
  }

  abrirMoradoresBloco(blocoNome: string) {
    this.moradoresBlocoNome = blocoNome;
    this.moradoresApto = null;
    this.showMoradoresPanel = true;
    this.carregarMoradores(blocoNome);
  }

  abrirMoradoresApto(a: Apartamento) {
    this.moradoresApto = a;
    this.moradoresBlocoNome = a.bloco ?? '';
    this.showMoradoresPanel = true;
    this.carregarMoradores(a.bloco ?? '', a.id);
  }

  fecharMoradores() {
    this.showMoradoresPanel = false;
    this.showAddMoradorForm = false;
    this.errorMorador.set(null);
    this.moradores.set([]);
  }

  salvarNovoMorador() {
    if (!this.novoMorador.nome?.trim()) {
      this.errorMorador.set('Nome é obrigatório.');
      return;
    }
    
    const aptoId = this.moradoresApto?.id;
    if (!aptoId) return;

    this.savingMorador.set(true);
    this.errorMorador.set(null);

    const dto = {
      nome: this.novoMorador.nome.trim(),
      documento: this.novoMorador.documento.trim() || undefined,
      email: this.novoMorador.email.trim() || undefined,
      telefone: this.novoMorador.telefone.trim() || undefined,
      tipo: this.novoMorador.tipo,
      id_apartamento: aptoId,
      sendCredentials: !!this.novoMorador.email.trim()
    };

    this.moradoresApi.create(dto).subscribe({
      next: () => {
        this.savingMorador.set(false);
        this.showAddMoradorForm = false;
        this.novoMorador = { nome: '', documento: '', email: '', telefone: '', tipo: 'proprietario' };
        this.carregarMoradores(this.moradoresBlocoNome, aptoId);
        this.carregar();
      },
      error: (err) => {
        this.savingMorador.set(false);
        this.errorMorador.set(err?.error?.message ?? err?.message ?? 'Erro ao cadastrar morador');
      }
    });
  }

  async removerMorador(m: any) {
    const ok = await this.confirm.ask({
      title: 'Remover morador',
      message: `Tem certeza que deseja remover o morador ${m.nome || m.name}? Esta ação é irreversível e revogará seu acesso.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;

    const aptoId = this.moradoresApto?.id;
    this.moradoresApi.remove(m.id).subscribe({
      next: () => {
        if (aptoId) {
          this.carregarMoradores(this.moradoresBlocoNome, aptoId);
        } else {
          this.carregarMoradores(this.moradoresBlocoNome);
        }
        this.carregar();
      },
      error: (err) => {
        alert(err?.error?.message ?? err?.message ?? 'Erro ao remover morador');
      }
    });
  }

  private carregarMoradores(bloco?: string, aptoId?: number) {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    this.loadingMoradores.set(true);
    let url = `${API_BASE}/condominios/${cid}/moradores`;
    const params: any = {};
    if (aptoId) params['id_apto'] = aptoId;
    this.http.get<any[]>(url, { params }).subscribe({
      next: (data) => {
        if (aptoId) {
          this.moradores.set(data);
        } else {
          // Filtrar por bloco usando a lista de aptos do bloco
          const aptosBloco = this.apartamentos()
            .filter(a => (a.bloco ?? 'Sem bloco') === bloco)
            .map(a => a.id);
          this.moradores.set(data.filter((m: any) =>
            aptosBloco.includes(m.id_apartamento)
          ));
        }
        this.loadingMoradores.set(false);
      },
      error: () => this.loadingMoradores.set(false),
    });
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
        { 'Quadra/Bloco': 'Bloco A', 'Lote/Apto': '101', 'Fração Ideal': '0.0125' },
        { 'Quadra/Bloco': 'Bloco A', 'Lote/Apto': '102', 'Fração Ideal': '0.0125' },
        { 'Quadra/Bloco': 'Quadra B', 'Lote/Apto': 'Lote 12', 'Fração Ideal': '0.0150' }
      ];
      const ws = xlsx.utils.json_to_sheet(data);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Template');
      const wbout = xlsx.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'template_importacao_apartamentos.xlsx';
      link.click();
    } catch {
      const headers = 'Quadra/Bloco;Lote/Apto;Fração Ideal\nBloco A;101;0.0125\nBloco A;102;0.0125\nQuadra B;Lote 12;0.0150';
      const blob = new Blob(['\ufeff' + headers], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'template_importacao_apartamentos.csv';
      link.click();
    }
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
              const apto = cols[1];
              if (apto) {
                linhas.push({
                  bloco: cols[0] || '',
                  apto: apto,
                  fracao: cols[2] || '',
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
              const apto = row['Lote/Apto'] || row['Lote'] || row['Apto'] || row['apto'] || row['lote'];
              const bloco = row['Quadra/Bloco'] || row['Quadra'] || row['Bloco'] || row['bloco'] || row['quadra'] || '';
              const fracao = row['Fração Ideal'] || row['Fração'] || row['Fracao'] || row['fracao'] || '';
              if (apto) {
                linhas.push({
                  bloco,
                  apto,
                  fracao,
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

  // ==========================================
  // VAGAS DE VISITANTE (por apartamento)
  // ==========================================
  readonly showVagasPanel = signal(false);
  readonly vagasApto = signal<Apartamento | null>(null);
  readonly vagasResumo = signal<VagasResumo | null>(null);
  readonly loadingVagas = signal(false);
  readonly erroVagas = signal<string | null>(null);

  readonly vagasLivres = computed(() => {
    const r = this.vagasResumo();
    if (!r) return 0;
    return Math.max(0, r.qtd_vagas - r.ocupadas);
  });

  abrirVagas(a: Apartamento) {
    this.vagasApto.set(a);
    this.vagasResumo.set(null);
    this.erroVagas.set(null);
    this.showVagasPanel.set(true);
    this.carregarVagas();
  }

  fecharVagas() {
    this.showVagasPanel.set(false);
    this.vagasApto.set(null);
    this.vagasResumo.set(null);
  }

  carregarVagas() {
    const apto = this.vagasApto();
    if (!apto) return;
    this.loadingVagas.set(true);
    this.vagasApi.list(apto.id).subscribe({
      next: (data) => { this.vagasResumo.set(data); this.loadingVagas.set(false); },
      error: (e) => {
        this.erroVagas.set(e?.error?.message ?? e?.message ?? 'Falha ao carregar vagas.');
        this.loadingVagas.set(false);
      },
    });
  }

  // ---- Modal de liberar vaga ----
  readonly modalVaga = signal(false);
  readonly beneficiariosVaga = signal<VagaBeneficiarios | null>(null);
  readonly carregandoBeneficiarios = signal(false);
  readonly salvandoVaga = signal(false);
  readonly erroVaga = signal<string | null>(null);
  novaVaga: {
    id_morador_titular: number | null;
    tipo: 'visitante' | 'inquilino';
    id_visitante: number | null;
    id_morador_beneficiario: number | null;
    placa: string;
  } = { id_morador_titular: null, tipo: 'visitante', id_visitante: null, id_morador_beneficiario: null, placa: '' };

  abrirModalVaga() {
    const apto = this.vagasApto();
    if (!apto) return;
    this.novaVaga = {
      id_morador_titular: this.vagasResumo()?.moradores?.[0]?.id ?? null,
      tipo: 'visitante',
      id_visitante: null,
      id_morador_beneficiario: null,
      placa: '',
    };
    this.erroVaga.set(null);
    this.modalVaga.set(true);
    this.carregandoBeneficiarios.set(true);
    this.vagasApi.beneficiarios(apto.id).subscribe({
      next: (data) => { this.beneficiariosVaga.set(data); this.carregandoBeneficiarios.set(false); },
      error: () => this.carregandoBeneficiarios.set(false),
    });
  }

  fecharModalVaga() {
    this.modalVaga.set(false);
  }

  salvarVaga() {
    const apto = this.vagasApto();
    if (!apto) return;
    if (!this.novaVaga.id_morador_titular) {
      this.erroVaga.set('Selecione o morador titular da vaga.');
      return;
    }
    if (this.novaVaga.tipo === 'visitante' && !this.novaVaga.id_visitante) {
      this.erroVaga.set('Selecione um visitante cadastrado neste apartamento.');
      return;
    }
    if (this.novaVaga.tipo === 'inquilino' && !this.novaVaga.id_morador_beneficiario) {
      this.erroVaga.set('Selecione um inquilino deste apartamento.');
      return;
    }

    this.salvandoVaga.set(true);
    this.erroVaga.set(null);
    this.vagasApi.liberar(apto.id, {
      id_morador_titular: this.novaVaga.id_morador_titular,
      tipo: this.novaVaga.tipo,
      id_visitante: this.novaVaga.id_visitante ?? undefined,
      id_morador_beneficiario: this.novaVaga.id_morador_beneficiario ?? undefined,
      placa: this.novaVaga.placa.trim() || undefined,
    }).subscribe({
      next: () => {
        this.salvandoVaga.set(false);
        this.fecharModalVaga();
        this.carregarVagas();
      },
      error: (e) => {
        this.salvandoVaga.set(false);
        this.erroVaga.set(e?.error?.message ?? e?.message ?? 'Falha ao liberar vaga.');
      },
    });
  }

  async revogarVaga(v: { id: number | null; ocupante_nome: string | null }) {
    const apto = this.vagasApto();
    if (!apto || !v.id) return;
    const ok = await this.confirm.ask({
      title: 'Revogar vaga',
      message: `A vaga de ${v.ocupante_nome ?? 'ocupante'} será revogada.`,
      confirmLabel: 'Revogar',
      variant: 'danger',
    });
    if (!ok) return;
    this.vagasApi.revogar(apto.id, v.id).subscribe({ next: () => this.carregarVagas() });
  }
}
