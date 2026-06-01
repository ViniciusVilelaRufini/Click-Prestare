import { Component, OnInit, computed, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CreatePrestador, Prestador, PrestadoresApi } from './prestadores.service';
import { ConfirmService } from '../shared/confirm.service';
import { InputMaskDirective } from '../shared/input-mask.directive';
import { VisitantesService } from '../visitantes/visitantes.service';
import { Visitante } from '../visitantes/visitante.model';

@Component({
  selector: 'app-prestadores-page',
  standalone: true,
  imports: [CommonModule, FormsModule, InputMaskDirective],
  templateUrl: './prestadores-page.component.html',
})
export class PrestadoresPageComponent implements OnInit {
  private api = inject(PrestadoresApi);
  private confirm = inject(ConfirmService);
  private visitantesApi = inject(VisitantesService);

  constructor() {
    effect(() => {
      this.filtroCategoria();
      this.search();
      untracked(() => {
        this.pagina.set(1);
      });
    });
  }

  readonly prestadores = signal<Prestador[]>([]);
  readonly visitantes = signal<Visitante[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly filtroCategoria = signal<string>('');

  readonly detalhesPrestador = signal<Prestador | null>(null);

  // Câmera ativa para foto de pessoa ou de documento
  readonly activeCamera = signal<'pessoa' | 'documento' | null>(null);
  videoStream: MediaStream | null = null;

  // Imagens capturadas (Base64 ou URL)
  readonly fotoPessoaBase64 = signal<string | null>(null);
  readonly fotoDocumentoBase64 = signal<string | null>(null);

  // Modal de visualização de foto ampliada
  readonly fotoAmpliadaUrl = signal<string | null>(null);
  readonly fotoAmpliadaTitulo = signal<string>('');
  readonly categoriasSelecionadas = signal<Set<string>>(new Set());
  readonly categoriasPredefinidas = [
    'Elétrica',
    'Hidráulica',
    'Reformas',
    'Pintura',
    'Jardinagem',
    'Limpeza',
    'Segurança',
    'Marcenaria',
    'Ar Condicionado',
    'Chaveiro'
  ];

  readonly categoriasCustomSelecionadas = computed(() => {
    return Array.from(this.categoriasSelecionadas()).filter(
      (c) => !this.categoriasPredefinidas.includes(c)
    );
  });

  readonly historicoVisitas = computed(() => {
    const p = this.detalhesPrestador();
    if (!p) return [];
    return this.visitantes().filter(
      (v) =>
        v.is_prestador === 1 &&
        v.nome.toLowerCase().trim() === p.nome.toLowerCase().trim()
    );
  });

  readonly pagina = signal(1);
  readonly itensPorPagina = 12;

  readonly totalPaginas = computed(() => {
    const total = this.prestadoresFiltrados().length;
    return Math.max(1, Math.ceil(total / this.itensPorPagina));
  });

  readonly prestadoresPaginados = computed(() => {
    const list = this.prestadoresFiltrados();
    const p = this.pagina();
    const start = (p - 1) * this.itensPorPagina;
    const end = start + this.itensPorPagina;
    return list.slice(start, end);
  });

  readonly exibindoInicio = computed(() => {
    if (this.prestadoresFiltrados().length === 0) return 0;
    return (this.pagina() - 1) * this.itensPorPagina + 1;
  });

  readonly exibindoFim = computed(() => {
    return Math.min(this.pagina() * this.itensPorPagina, this.prestadoresFiltrados().length);
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

  readonly categoriasUnicas = computed(() => {
    const set = new Set<string>();
    for (const p of this.prestadores()) {
      for (const c of (p.categorias ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
        set.add(c);
      }
    }
    return Array.from(set).sort();
  });

  readonly prestadoresFiltrados = computed(() => {
    let list = this.prestadores();

    const cat = this.filtroCategoria();
    if (cat) {
      list = list.filter((p) =>
        this.categoriasArray(p).some((c) => c.toLowerCase() === cat.toLowerCase())
      );
    }

    const term = this.search().toLowerCase().trim();
    if (term) {
      list = list.filter(
        (p) =>
          p.nome.toLowerCase().includes(term) ||
          (p.telefone && p.telefone.toLowerCase().includes(term)) ||
          (p.categorias && p.categorias.toLowerCase().includes(term))
      );
    }

    return list;
  });

  novo: CreatePrestador = { nome: '', telefone: '', categorias: '' };
  showForm = false;
  editingId: number | null = null;
  readonly saving = signal(false);

  ngOnInit() { this.carregar(); }

  carregar() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (data) => { this.prestadores.set(data); this.loading.set(false); },
      error: (e) => { this.error.set(e?.message ?? 'Erro'); this.loading.set(false); },
    });
    this.visitantesApi.list().subscribe({
      next: (data) => { this.visitantes.set(data); }
    });
  }

  abrirNovo() {
    this.editingId = null;
    this.novo = { nome: '', telefone: '', categorias: '', dias_semana: 'seg,ter,qua,qui,sex', foto_pessoa: undefined, foto_documento: undefined };
    this.categoriasSelecionadas.set(new Set());
    this.fotoPessoaBase64.set(null);
    this.fotoDocumentoBase64.set(null);
    this.fecharCamera();
    this.error.set(null);
    this.showForm = true;
  }

  abrirEditar(p: Prestador) {
    this.editingId = p.id;
    this.fotoPessoaBase64.set(p.foto_pessoa ?? null);
    this.fotoDocumentoBase64.set(p.foto_documento ?? null);
    this.novo = {
      nome: p.nome,
      telefone: p.telefone ?? '',
      categorias: p.categorias ?? '',
      foto_pessoa: p.foto_pessoa ?? undefined,
      foto_documento: p.foto_documento ?? undefined,
      dias_semana: p.dias_semana ?? '',
    };
    const cats = (p.categorias ?? '').split(';').map((x) => x.trim()).filter(Boolean);
    this.categoriasSelecionadas.set(new Set(cats));
    this.error.set(null);
    this.showForm = true;
  }

  cancelarForm() {
    this.fecharCamera();
    this.fotoPessoaBase64.set(null);
    this.fotoDocumentoBase64.set(null);
    this.showForm = false;
    this.editingId = null;
    this.error.set(null);
  }

  salvar() {
    if (!this.novo.nome?.trim()) { this.error.set('Nome é obrigatório.'); return; }
    
    this.novo.categorias = Array.from(this.categoriasSelecionadas()).join(';');
    
    this.saving.set(true);
    const obs = this.editingId
      ? this.api.update(this.editingId, this.novo)
      : this.api.create(this.novo);
    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelarForm();
        this.novo = { nome: '', telefone: '', categorias: '' };
        this.carregar();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(e?.error?.message ?? e?.message ?? 'Erro');
      },
    });
  }

  async remover(p: Prestador) {
    const ok = await this.confirm.ask({
      title: 'Remover prestador',
      message: `${p.nome} será removido da lista de autorizados.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.remove(p.id).subscribe({ next: () => this.carregar() });
  }

  toggleCategoriaSelecionada(cat: string) {
    const current = new Set(this.categoriasSelecionadas());
    if (current.has(cat)) {
      current.delete(cat);
    } else {
      current.add(cat);
    }
    this.categoriasSelecionadas.set(current);
  }

  adicionarCustomCategoria(val: string) {
    const clean = val.trim();
    if (!clean) return;
    const formatted = clean.charAt(0).toUpperCase() + clean.slice(1);
    const current = new Set(this.categoriasSelecionadas());
    current.add(formatted);
    this.categoriasSelecionadas.set(current);
  }

  copiarTelefone(tel: string) {
    navigator.clipboard.writeText(tel);
  }

  limparTelefone(tel: string): string {
    return tel.replace(/\D/g, '');
  }

  categoriasArray(p: Prestador): string[] {
    return (p.categorias ?? '').split(';').map((c) => c.trim()).filter(Boolean);
  }

  iniciais(nome: string): string {
    return nome.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('');
  }

  // Métodos da Câmera / Webcam
  async iniciarCamera(tipo: 'pessoa' | 'documento') {
    this.fecharCamera();
    this.activeCamera.set(tipo);

    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });

      setTimeout(() => {
        const videoElement = document.getElementById('webcam-preview') as HTMLVideoElement;
        if (videoElement && this.videoStream) {
          videoElement.srcObject = this.videoStream;
          videoElement.play().catch(err => console.error('Erro ao dar play no vídeo da webcam:', err));
        }
      }, 100);
    } catch (err: any) {
      this.error.set('Não foi possível acessar a câmera: ' + (err.message || err));
      this.activeCamera.set(null);
    }
  }

  fecharCamera() {
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }
    this.activeCamera.set(null);
  }

  capturarFoto() {
    const videoElement = document.getElementById('webcam-preview') as HTMLVideoElement;
    if (!videoElement) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth || 640;
    canvas.height = videoElement.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      
      const tipo = this.activeCamera();
      if (tipo === 'pessoa') {
        this.fotoPessoaBase64.set(dataUrl);
        this.novo.foto_pessoa = dataUrl;
      } else if (tipo === 'documento') {
        this.fotoDocumentoBase64.set(dataUrl);
        this.novo.foto_documento = dataUrl;
      }
    }

    this.fecharCamera();
  }

  onFileSelectedImage(event: any, tipo: 'pessoa' | 'documento') {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: any) => {
      const dataUrl = e.target.result as string;
      if (tipo === 'pessoa') {
        this.fotoPessoaBase64.set(dataUrl);
        this.novo.foto_pessoa = dataUrl;
      } else if (tipo === 'documento') {
        this.fotoDocumentoBase64.set(dataUrl);
        this.novo.foto_documento = dataUrl;
      }
    };
    reader.readAsDataURL(file);
  }

  abrirAmpliarFoto(url: string, titulo: string) {
    this.fotoAmpliadaUrl.set(url);
    this.fotoAmpliadaTitulo.set(titulo);
  }

  fecharAmpliarFoto() {
    this.fotoAmpliadaUrl.set(null);
    this.fotoAmpliadaTitulo.set('');
  }

  // Ordem fixa dos dias usada para renderizar os badges no card.
  readonly diasSemanaOrdem: { key: string; abrev: string; nome: string }[] = [
    { key: 'seg', abrev: 'S', nome: 'Segunda' },
    { key: 'ter', abrev: 'T', nome: 'Terça' },
    { key: 'qua', abrev: 'Q', nome: 'Quarta' },
    { key: 'qui', abrev: 'Q', nome: 'Quinta' },
    { key: 'sex', abrev: 'S', nome: 'Sexta' },
    { key: 'sab', abrev: 'S', nome: 'Sábado' },
    { key: 'dom', abrev: 'D', nome: 'Domingo' },
  ];

  /** Retorna o conjunto de dias permitidos de um prestador para uso no template. */
  diasPermitidosSet(diasStr: string | null | undefined): Set<string> {
    return new Set((diasStr ?? '').split(',').filter(Boolean));
  }

  diasSemanaSelecionados(): string[] {
    return (this.novo.dias_semana ?? '').split(',').filter(Boolean);
  }

  isDiaSelecionado(dia: string): boolean {
    return this.diasSemanaSelecionados().includes(dia);
  }

  toggleDiaSemana(dia: string) {
    const selecionados = this.diasSemanaSelecionados();
    if (selecionados.includes(dia)) {
      this.novo.dias_semana = selecionados.filter((d) => d !== dia).join(',');
    } else {
      this.novo.dias_semana = [...selecionados, dia].join(',');
    }
  }

  aplicarPresetDias(preset: 'semana' | 'fim-semana' | 'todos' | 'nenhum') {
    if (preset === 'semana') {
      this.novo.dias_semana = 'seg,ter,qua,qui,sex';
    } else if (preset === 'fim-semana') {
      this.novo.dias_semana = 'sab,dom';
    } else if (preset === 'todos') {
      this.novo.dias_semana = 'seg,ter,qua,qui,sex,sab,dom';
    } else {
      this.novo.dias_semana = '';
    }
  }

  formatarDiasSemanaExtenso(diasStr: string | null | undefined): string {
    if (!diasStr) return 'Nenhum dia permitido';
    const dias = diasStr.split(',').filter(Boolean);
    if (dias.length === 7) return 'Todos os dias';
    if (dias.length === 5 && !dias.includes('sab') && !dias.includes('dom')) return 'Segunda a Sexta';
    if (dias.length === 2 && dias.includes('sab') && dias.includes('dom')) return 'Finais de semana';
    
    const mapa: { [key: string]: string } = {
      seg: 'Seg',
      ter: 'Ter',
      qua: 'Qua',
      qui: 'Qui',
      sex: 'Sex',
      sab: 'Sáb',
      dom: 'Dom'
    };
    return dias.map((d) => mapa[d] || d).join(', ');
  }
}
