import { Component, OnInit, computed, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CreatePrestador, Prestador, PrestadoresApi } from './prestadores.service';
import { ConfirmService } from '../shared/confirm.service';
import { InputMaskDirective } from '../shared/input-mask.directive';
import { VisitantesService, Pessoa } from '../visitantes/visitantes.service';
import { Visitante } from '../visitantes/visitante.model';
import { ApartamentosApi, Apartamento } from '../apartamentos/apartamentos.service';
import { compressImage } from '../shared/image-compress.util';

@Component({
  selector: 'app-prestadores-page',
  standalone: true,
  imports: [CommonModule, FormsModule, InputMaskDirective, RouterLink],
  templateUrl: './prestadores-page.component.html',
})
export class PrestadoresPageComponent implements OnInit {
  private api = inject(PrestadoresApi);
  private confirm = inject(ConfirmService);
  private visitantesApi = inject(VisitantesService);
  private aptApi = inject(ApartamentosApi);

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
  // Prestadores com acesso (registros Visitantes is_prestador=1, agregados por
  // pessoa — trazem PIN/status/apartamento). Mostrados em seção própria.
  readonly pessoasAcesso = signal<Pessoa[]>([]);
  readonly apartamentos = signal<Apartamento[]>([]);
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

  // Prestadores com acesso ativo (vindos do app/portaria, tabela Visitantes
  // is_prestador=1). Seção somente leitura; honra apenas a busca.
  readonly prestadoresAcesso = computed(() => {
    const term = this.search().toLowerCase().trim();
    let list = this.pessoasAcesso().filter((p) => !!p.is_prestador);
    if (term) {
      list = list.filter(
        (p) =>
          p.nome.toLowerCase().includes(term) ||
          (p.doc_identificacao && p.doc_identificacao.toLowerCase().includes(term))
      );
    }
    return list;
  });

  // PINs revelados na seção "Prestadores com acesso".
  readonly pinsAcessoRevelados = signal<Set<number>>(new Set());

  // ===== Edição de prestador-com-acesso (registro Visitantes is_prestador=1) =====
  // Modal próprio, separado do form de cadastro (Prestadores_servico). Edita os
  // dados da pessoa via atualizarPessoa (nome/doc/foto/tag); unidade é só leitura.
  readonly editAcesso = signal<Pessoa | null>(null);
  editAcessoForm: { nome: string; doc_identificacao: string; tag_rfid: string; foto_pessoa?: string } =
    { nome: '', doc_identificacao: '', tag_rfid: '' };
  readonly editAcessoFoto = signal<string | null>(null);
  readonly savingAcesso = signal(false);
  readonly errorAcesso = signal<string | null>(null);

  abrirEditarAcesso(p: Pessoa) {
    this.editAcessoForm = {
      nome: p.nome ?? '',
      doc_identificacao: p.doc_identificacao ?? '',
      tag_rfid: (p as any).tag_rfid ?? '',
      foto_pessoa: undefined,
    };
    this.editAcessoFoto.set(p.foto_pessoa ?? null);
    this.errorAcesso.set(null);
    this.editAcesso.set(p);
  }

  cancelarEditAcesso() {
    this.editAcesso.set(null);
    this.editAcessoFoto.set(null);
    this.errorAcesso.set(null);
  }

  onFotoAcessoSelecionada(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;
    compressImage(file)
      .then((compressedBase64) => {
        this.editAcessoFoto.set(compressedBase64);
        this.editAcessoForm.foto_pessoa = compressedBase64;
      })
      .catch((err) => {
        console.error('Erro ao comprimir imagem:', err);
        const reader = new FileReader();
        reader.onload = (e: any) => {
          const dataUrl = e.target.result as string;
          this.editAcessoFoto.set(dataUrl);
          this.editAcessoForm.foto_pessoa = dataUrl;
        };
        reader.readAsDataURL(file);
      });
  }

  salvarAcesso() {
    const p = this.editAcesso();
    if (!p) return;
    if (!this.editAcessoForm.nome?.trim()) {
      this.errorAcesso.set('Informe o nome.');
      return;
    }
    this.savingAcesso.set(true);
    this.visitantesApi.atualizarPessoa(p.id, {
      nome: this.editAcessoForm.nome,
      doc_identificacao: this.editAcessoForm.doc_identificacao,
      tag_rfid: (this.editAcessoForm.tag_rfid ?? '').trim() || null,
      is_prestador: 1,
      ...(this.editAcessoForm.foto_pessoa !== undefined && { foto_pessoa: this.editAcessoForm.foto_pessoa }),
    }).subscribe({
      next: () => {
        this.savingAcesso.set(false);
        this.cancelarEditAcesso();
        this.carregar();
      },
      error: (e) => {
        this.savingAcesso.set(false);
        this.errorAcesso.set(e?.error?.message ?? e?.message ?? 'Erro ao salvar');
      },
    });
  }

  async removerAcesso(p: Pessoa) {
    const ok = await this.confirm.ask({
      title: 'Remover prestador',
      message: `${p.nome} e TODAS as suas visitas/registros serão removidos. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.visitantesApi.removerPessoa(p.id).subscribe({ next: () => this.carregar() });
  }

  togglePinAcesso(id: number, event: Event) {
    event.stopPropagation();
    const current = new Set(this.pinsAcessoRevelados());
    if (current.has(id)) current.delete(id);
    else current.add(id);
    this.pinsAcessoRevelados.set(current);
  }

  formatarPin(codigo: string | null | undefined): string {
    const c = (codigo ?? '').toString();
    return c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
  }

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

  ngOnInit() {
    this.carregar();
    // Lista de apartamentos para o seletor de unidade (mesmo padrão de Visitantes).
    this.aptApi.list().subscribe({
      next: (data) => {
        data.sort((a, b) => {
          if (a.bloco === b.bloco) return a.apto.localeCompare(b.apto, 'pt', { numeric: true });
          return (a.bloco ?? '').localeCompare(b.bloco ?? '');
        });
        this.apartamentos.set(data);
      },
    });
  }

  carregar() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (data) => { this.prestadores.set(data); this.loading.set(false); },
      error: (e) => { this.error.set(e?.message ?? 'Erro'); this.loading.set(false); },
    });
    this.visitantesApi.list().subscribe({
      next: (data) => { this.visitantes.set(data); }
    });
    // Prestadores com acesso (agregados por pessoa — PIN/status/apartamento).
    this.visitantesApi.listarPessoas().subscribe({
      next: (data) => { this.pessoasAcesso.set(data); }
    });
  }

  abrirNovo() {
    this.editingId = null;
    this.novo = { nome: '', telefone: '', categorias: '', id_apartamento: 0, dias_semana: 'seg,ter,qua,qui,sex', foto_pessoa: undefined, foto_documento: undefined };
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
      id_apartamento: p.id_apartamento ?? 0,
      foto_pessoa: p.foto_pessoa ?? undefined,
      foto_documento: p.foto_documento ?? undefined,
      dias_semana: p.dias_semana ?? '',
    };
    const cats = (p.categorias ?? '').split(';').map((x) => x.trim()).filter(Boolean);
    this.categoriasSelecionadas.set(new Set(cats));
    this.error.set(null);
    this.showForm = true;
  }

  removerFotoPessoa() {
    this.fotoPessoaBase64.set(null);
    this.novo.foto_pessoa = null;
    if (this.editingId !== null) {
      this.api.clearFoto(this.editingId, 'pessoa').subscribe({
        next: (updated) => {
          const list = this.prestadores();
          this.prestadores.set(list.map(p => p.id === updated.id ? updated : p));
        },
      });
    }
  }

  removerFotoDocumento() {
    this.fotoDocumentoBase64.set(null);
    this.novo.foto_documento = null;
    if (this.editingId !== null) {
      this.api.clearFoto(this.editingId, 'documento').subscribe({
        next: (updated) => {
          const list = this.prestadores();
          this.prestadores.set(list.map(p => p.id === updated.id ? updated : p));
        },
      });
    }
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
    if (!this.novo.id_apartamento) { this.error.set('Selecione a unidade de destino.'); return; }

    this.novo.categorias = Array.from(this.categoriasSelecionadas()).join(';');

    // Usa os signals de preview como fonte de verdade para as fotos.
    // Se o signal está null em modo edição = usuário removeu a foto → envia null para limpar no banco.
    if (this.editingId !== null) {
      if (this.fotoPessoaBase64() === null) this.novo.foto_pessoa = null;
      if (this.fotoDocumentoBase64() === null) this.novo.foto_documento = null;
    }

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

    compressImage(file)
      .then((compressedBase64) => {
        if (tipo === 'pessoa') {
          this.fotoPessoaBase64.set(compressedBase64);
          this.novo.foto_pessoa = compressedBase64;
        } else if (tipo === 'documento') {
          this.fotoDocumentoBase64.set(compressedBase64);
          this.novo.foto_documento = compressedBase64;
        }
      })
      .catch((err) => {
        console.error('Erro ao comprimir imagem:', err);
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
      });
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
