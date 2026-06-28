import { Component, OnInit, computed, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { VisitantesService, VisitanteDetalhes, PessoaEncontrada, Pessoa } from './visitantes.service';
import { ApartamentosApi, Apartamento } from '../apartamentos/apartamentos.service';
import { CreateVisitante, Visitante } from './visitante.model';
import { ConfirmService } from '../shared/confirm.service';
import { InputMaskDirective } from '../shared/input-mask.directive';
import { FacialCaptureComponent } from '../shared/facial-capture.component';
import { compressImage } from '../shared/image-compress.util';

@Component({
  selector: 'app-visitantes-page',
  standalone: true,
  imports: [CommonModule, FormsModule, InputMaskDirective, RouterLink, FacialCaptureComponent],
  templateUrl: './visitantes-page.component.html',
  styleUrl: './visitantes-page.component.css',
})
export class VisitantesPageComponent implements OnInit {
  private service = inject(VisitantesService);
  private aptApi = inject(ApartamentosApi);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private sanitizer = inject(DomSanitizer);

  constructor() {
    effect(() => {
      this.viewFilter();
      this.search();
      untracked(() => {
        this.pagina.set(1);
      });
    });
  }

  // Modo da página: 'visitante' (default) ou 'prestador' (mesma UI, filtrada por
  // is_prestador=1; cadastro nasce is_prestador=1). Lido de route.data.
  readonly modo = signal<'visitante' | 'prestador'>('visitante');
  readonly isPrestadorModo = computed(() => this.modo() === 'prestador');

  // Lista agregada por pessoa (1 pessoa = 1 linha). Fonte da página /visitantes.
  readonly pessoas = signal<Pessoa[]>([]);
  readonly apartamentos = signal<Apartamento[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly viewFilter = signal<'todos' | 'ativos' | 'liberados' | 'historico'>('todos');
  readonly pinsRevelados = signal<Set<number>>(new Set());

  readonly showValidationModal = signal(false);
  readonly pinCode = signal('');
  readonly validationResult = signal<any | null>(null);
  readonly validationError = signal<string | null>(null);
  readonly validating = signal(false);
  readonly checkingIn = signal(false);

  // Câmera ativa para foto de pessoa ou de documento
  readonly activeCamera = signal<'pessoa' | 'documento' | null>(null);
  private videoStream: MediaStream | null = null;

  // Imagens capturadas (Base64 ou URL)
  readonly fotoPessoaBase64 = signal<string | null>(null);
  readonly fotoDocumentoBase64 = signal<string | null>(null);
  // Modal de captura ao vivo pela câmera do facial
  readonly facialModalOpen = signal(false);

  onFacialCaptured(foto: string) {
    this.facialModalOpen.set(false);
    this.fotoPessoaBase64.set(foto);
    this.novo.foto_pessoa = foto;
  }

  // Modal de visualização de foto ampliada
  readonly fotoAmpliadaUrl = signal<string | null>(null);
  readonly fotoAmpliadaTitulo = signal<string>('');

  // Modal de detalhes do visitante (timeline, stats, apartamentos)
  readonly detalhesData = signal<VisitanteDetalhes | null>(null);
  readonly detalhesLoading = signal(false);
  readonly detalhesError = signal<string | null>(null);

  readonly copiaSucessoTexto = signal<string | null>(null);
  private copiaSucessoTimeout?: any;

  copiarTexto(texto: string, label: string) {
    if (!texto) return;
    navigator.clipboard.writeText(texto).then(() => {
      this.copiaSucessoTexto.set(`${label} copiado!`);
      if (this.copiaSucessoTimeout) clearTimeout(this.copiaSucessoTimeout);
      this.copiaSucessoTimeout = setTimeout(() => {
        this.copiaSucessoTexto.set(null);
      }, 2000);
    });
  }

  // Lookup de pessoa existente no formulário (mesmo doc)
  readonly pessoaEncontrada = signal<PessoaEncontrada | null>(null);

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

  readonly diasSemanaOrdem: { key: string; abrev: string; nome: string }[] = [
    { key: 'seg', abrev: 'S', nome: 'Segunda' },
    { key: 'ter', abrev: 'T', nome: 'Terça' },
    { key: 'qua', abrev: 'Q', nome: 'Quarta' },
    { key: 'qui', abrev: 'Q', nome: 'Quinta' },
    { key: 'sex', abrev: 'S', nome: 'Sexta' },
    { key: 'sab', abrev: 'S', nome: 'Sábado' },
    { key: 'dom', abrev: 'D', nome: 'Domingo' },
  ];

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

  // Modos do formulário:
  //   - editandoIdentidade=true: alterando dados da pessoa (nome/foto/doc)
  //     -> salva via atualizarPessoa(), reflete em TODAS as visitas
  //   - novaVisitaPara != null: cadastrando uma nova visita pra pessoa
  //     que já existe -> form curto (só apto + validade), salva via
  //     novaVisitaPessoa()
  //   - ambos false e editingId=null: cadastro de pessoa nova
  readonly editandoIdentidade = signal(false);
  readonly novaVisitaPara = signal<Pessoa | null>(null);

  /**
   * Ao sair do campo "documento", busca se já há cadastro anterior dessa
   * pessoa no condomínio. Se houver, mostra um banner sugerindo reutilizar
   * foto/face_id. (O backend já reutiliza automaticamente quando o operador
   * não envia foto — esse banner é só feedback visual.)
   */
  verificarPessoaExistente() {
    const doc = (this.novo.doc_identificacao ?? '').trim();
    if (!doc || doc.length < 3) {
      this.pessoaEncontrada.set(null);
      return;
    }
    // Não busca se estiver editando (já é o registro principal)
    if (this.editingId) {
      this.pessoaEncontrada.set(null);
      return;
    }
    this.service.buscarPessoa(doc).subscribe({
      next: (p) => this.pessoaEncontrada.set(p ?? null),
      error: () => this.pessoaEncontrada.set(null),
    });
  }

  /**
   * Copia foto/nome da pessoa encontrada para o formulário atual.
   * Útil quando o operador quer pré-preencher visualmente antes de salvar.
   */
  reutilizarPessoa(p: PessoaEncontrada) {
    if (p.nome && !this.novo.nome) {
      this.novo.nome = p.nome;
    }
    if (p.foto_pessoa) {
      this.novo.foto_pessoa = p.foto_pessoa;
      this.fotoPessoaBase64.set(p.foto_pessoa);
    }
    if (p.foto_documento) {
      this.novo.foto_documento = p.foto_documento;
      this.fotoDocumentoBase64.set(p.foto_documento);
    }
  }

  abrirDetalhes(v: Visitante | Pessoa) {
    this.detalhesData.set(null);
    this.detalhesError.set(null);
    this.detalhesLoading.set(true);
    this.service.detalhes(v.id).subscribe({
      next: (d) => {
        this.detalhesData.set(d);
        this.detalhesLoading.set(false);
      },
      error: (err) => {
        this.detalhesLoading.set(false);
        this.detalhesError.set(err?.error?.message ?? 'Falha ao carregar detalhes do visitante.');
      },
    });
  }

  fecharDetalhes() {
    this.detalhesData.set(null);
    this.detalhesError.set(null);
    this.detalhesLoading.set(false);
  }

  formatarPermanencia(ms: number | null): string {
    if (ms == null || ms <= 0) return '—';
    const minutos = Math.floor(ms / 60000);
    if (minutos < 60) return `${minutos} min`;
    const horas = Math.floor(minutos / 60);
    const restoMin = minutos % 60;
    if (horas < 24) return `${horas}h ${restoMin}min`;
    const dias = Math.floor(horas / 24);
    const restoHoras = horas % 24;
    return `${dias}d ${restoHoras}h`;
  }

  readonly pagina = signal(1);
  readonly itensPorPagina = 20;

  readonly totalPaginas = computed(() => {
    const total = this.pessoasFiltradas().length;
    return Math.max(1, Math.ceil(total / this.itensPorPagina));
  });

  readonly visitantesPaginados = computed(() => {
    const list = this.pessoasFiltradas();
    const p = this.pagina();
    const start = (p - 1) * this.itensPorPagina;
    const end = start + this.itensPorPagina;
    return list.slice(start, end);
  });

  readonly exibindoInicio = computed(() => {
    if (this.pessoasFiltradas().length === 0) return 0;
    return (this.pagina() - 1) * this.itensPorPagina + 1;
  });

  readonly exibindoFim = computed(() => {
    return Math.min(this.pagina() * this.itensPorPagina, this.pessoasFiltradas().length);
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

  // Apenas VISITANTES (is_prestador=0). Prestadores com acesso ficam na aba
  // Base de KPIs e da lista, filtrada pelo MODO da página:
  // - 'visitante': só is_prestador=0 (prestadores ficam na aba Prestadores)
  // - 'prestador': só is_prestador=1 (mesma UI, voltada a prestadores)
  // O registro permanece na tabela em ambos os casos (acesso intacto).
  readonly visitantesPessoas = computed(() =>
    this.modo() === 'prestador'
      ? this.pessoas().filter((p) => p.is_prestador === 1)
      : this.pessoas().filter((p) => !p.is_prestador),
  );

  // KPIs do topo — agora contam PESSOAS únicas, não registros de visita.
  readonly visitantesAtivos = computed(() =>
    this.visitantesPessoas().filter((p) => p.noLocal),
  );
  readonly visitantesLiberados = computed(() =>
    this.visitantesPessoas().filter((p) => !p.noLocal && (p as any).liberado === 1),
  );
  readonly visitantesHistorico = computed(() =>
    this.visitantesPessoas().filter((p) => !p.noLocal && (p as any).liberado !== 1),
  );
  readonly totalPessoas = computed(() => this.visitantesPessoas().length);
  /**
   * Lista de pessoas filtradas (1 pessoa = 1 linha). Renderizada na tabela.
   * Substitui o antigo visitantesFiltrados — agora a lista representa
   * identidades, não visitas.
   */
  readonly pessoasFiltradas = computed(() => {
    // Base já sem prestadores (eles aparecem na aba Prestadores).
    let list = this.visitantesPessoas();

    // 1. Filtrar por status
    const f = this.viewFilter();
    if (f === 'ativos') {
      list = list.filter((p) => p.noLocal);
    } else if (f === 'liberados') {
      list = list.filter((p) => !p.noLocal && (p as any).liberado === 1);
    } else if (f === 'historico') {
      list = list.filter((p) => !p.noLocal && (p as any).liberado !== 1);
    }

    // 2. Busca por nome ou documento
    const term = this.search().toLowerCase().trim();
    if (term) {
      list = list.filter((p) =>
        p.nome.toLowerCase().includes(term) ||
        (p.doc_identificacao && p.doc_identificacao.toLowerCase().includes(term))
      );
    }

    return list;
  });

  /**
   * @deprecated mantido para compatibilidade com templates antigos.
   * Use pessoasFiltradas.
   */
  readonly visitantesFiltrados = this.pessoasFiltradas;

  novo: CreateVisitante = this.estadoInicial();
  showForm = false;
  editingId: number | null = null;
  readonly saving = signal(false);

  ngOnInit() {
    // Define o modo da página a partir da rota (data: { modo: 'prestador' }).
    this.route.data.subscribe((d) => {
      this.modo.set(d['modo'] === 'prestador' ? 'prestador' : 'visitante');
    });
    this.carregar();
    this.aptApi.list().subscribe({
      next: (data) => {
        data.sort((a, b) => {
          if (a.bloco === b.bloco) return a.apto.localeCompare(b.apto, 'pt', { numeric: true });
          return (a.bloco ?? '').localeCompare(b.bloco ?? '');
        });
        this.apartamentos.set(data);
      },
    });
    this.route.queryParams.subscribe((params) => {
      if (params['novo'] === 'true') {
        this.abrirNovo();
      }
      if (params['validar'] === 'true') {
        this.abrirValidador();
      }
    });
  }

  carregar() {
    this.loading.set(true);
    this.error.set(null);
    // Lista agrupada por pessoa para a tabela principal
    this.service.listarPessoas().subscribe({
      next: (data) => {
        this.pessoas.set(data);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(`Falha ao carregar: ${e?.message ?? e}`);
        this.loading.set(false);
      },
    });
  }

  abrirNovo() {
    this.editingId = null;
    this.editandoIdentidade.set(false);
    this.novaVisitaPara.set(null);
    this.novo = this.estadoInicial();
    this.categoriasSelecionadas.set(new Set());
    this.fotoPessoaBase64.set(null);
    this.fotoDocumentoBase64.set(null);
    this.pessoaEncontrada.set(null);
    this.error.set(null);
    this.showForm = true;
  }

  /**
   * Abre o formulário em modo "Nova Visita" para uma pessoa já cadastrada.
   * Pré-preenche nome/foto/doc (somente leitura no template) e zera
   * apartamento + datas para o operador escolher.
   */
  abrirNovaVisita(p: Pessoa) {
    this.editingId = null;
    this.editandoIdentidade.set(false);
    this.novaVisitaPara.set(p);
    this.novo = {
      ...this.estadoInicial(),
      nome: p.nome,
      doc_identificacao: p.doc_identificacao ?? '',
      is_visitante: p.is_visitante ?? 1,
      is_prestador: p.is_prestador ?? 0,
      foto_pessoa: p.foto_pessoa ?? undefined,
      foto_documento: p.foto_documento ?? undefined,
      dias_semana: p.dias_semana ?? '',
      categorias: p.categorias ?? '',
    } as CreateVisitante;
    const cats = (p.categorias ?? '').split(';').map((x) => x.trim()).filter(Boolean);
    this.categoriasSelecionadas.set(new Set(cats));
    this.fotoPessoaBase64.set(p.foto_pessoa ?? null);
    this.fotoDocumentoBase64.set(p.foto_documento ?? null);
    this.pessoaEncontrada.set(null);
    this.error.set(null);
    this.showForm = true;
  }

  /**
   * Remove a PESSOA inteira (todas as visitas + face_id do terminal).
   * Pede confirmação porque é destrutivo.
   */
  removerPessoa(p: Pessoa) {
    const visitas = p.totalVisitas;
    const aviso = visitas > 1
      ? `Remover ${p.nome}? Isso vai apagar todas as ${visitas} visitas dele e remover do terminal facial.`
      : `Remover ${p.nome}? Isso também vai remover do terminal facial.`;
    this.confirm.ask({
      title: 'Remover pessoa',
      message: aviso,
      confirmLabel: 'Remover',
      variant: 'danger',
    }).then((ok) => {
      if (!ok) return;
      this.service.removerPessoa(p.id).subscribe({
        next: () => this.carregar(),
        error: (e) => this.error.set(`Falha ao remover: ${e?.error?.message ?? e?.message ?? e}`),
      });
    });
  }

  /**
   * 'p' pode ser uma Pessoa (vinda da nova lista agregada) ou um Visitante
   * legacy. Ambos têm os campos básicos (id, nome, doc, fotos).
   * Em modo edição, ID representa "registro principal da pessoa" e o save
   * usa atualizarPessoa() para refletir em todas as visitas dela.
   */
  abrirEditar(v: Visitante | Pessoa) {
    this.editingId = v.id;
    this.editandoIdentidade.set(true);
    this.novo = {
      nome: v.nome,
      doc_identificacao: v.doc_identificacao ?? '',
      id_apartamento: (v as any).id_apartamento,
      is_visitante: v.is_visitante ?? 1,
      is_prestador: v.is_prestador ?? 0,
      foto_pessoa: v.foto_pessoa ?? undefined,
      foto_documento: v.foto_documento ?? undefined,
      tag_rfid: (v as any).tag_rfid ?? '',
      dias_semana: (v as any).dias_semana ?? '',
      categorias: (v as any).categorias ?? '',
      bloqueado: (v as any).bloqueado ?? 0,
      data_hora_inicio: v.data_hora_inicio
        ? new Date(v.data_hora_inicio).toISOString().slice(0, 16)
        : undefined,
      data_hora_termino: v.data_hora_termino
        ? new Date(v.data_hora_termino).toISOString().slice(0, 16)
        : undefined,
    } as CreateVisitante;
    const cats = ((v as any).categorias ?? '').split(';').map((x: string) => x.trim()).filter(Boolean);
    this.categoriasSelecionadas.set(new Set(cats));
    this.fotoPessoaBase64.set(v.foto_pessoa ?? null);
    this.fotoDocumentoBase64.set(v.foto_documento ?? null);
    this.error.set(null);
    this.showForm = true;
  }

  cancelarForm() {
    this.fecharCamera();
    this.showForm = false;
    this.editingId = null;
    this.editandoIdentidade.set(false);
    this.novaVisitaPara.set(null);
    this.fotoPessoaBase64.set(null);
    this.fotoDocumentoBase64.set(null);
    this.pessoaEncontrada.set(null);
    this.error.set(null);
  }

  salvar() {
    this.novo.categorias = Array.from(this.categoriasSelecionadas()).join(';');

    // Modo: Nova Visita para pessoa existente (form curto, só apto+validade)
    const novaPara = this.novaVisitaPara();
    if (novaPara) {
      if (!this.novo.id_apartamento) {
        this.error.set('Selecione o apartamento da visita.');
        return;
      }
      this.saving.set(true);
      this.service.novaVisitaPessoa(novaPara.id, {
        id_apartamento: this.novo.id_apartamento,
        data_hora_inicio: this.novo.data_hora_inicio,
        data_hora_termino: this.novo.data_hora_termino,
      }).subscribe({
        next: () => {
          this.saving.set(false);
          this.cancelarForm();
          this.novo = this.estadoInicial();
          this.carregar();
        },
        error: (e) => {
          this.saving.set(false);
          this.error.set(`Falha ao criar visita: ${e?.error?.message ?? e?.message ?? e}`);
        },
      });
      return;
    }

    // Modo: Editar identidade da pessoa (reflete em todas as visitas dela)
    if (this.editingId && this.editandoIdentidade()) {
      if (!this.novo.nome?.trim()) {
        this.error.set('Informe o nome da pessoa.');
        return;
      }
      this.saving.set(true);
      this.service.atualizarPessoa(this.editingId, {
        nome: this.novo.nome,
        doc_identificacao: this.novo.doc_identificacao,
        foto_pessoa: this.novo.foto_pessoa ?? undefined,
        foto_documento: this.novo.foto_documento ?? undefined,
        is_visitante: this.novo.is_visitante,
        is_prestador: this.novo.is_prestador,
        tag_rfid: (this.novo.tag_rfid ?? '').trim() || null,
        dias_semana: this.novo.dias_semana,
        categorias: this.novo.categorias,
        bloqueado: this.novo.bloqueado,
      }).subscribe({
        next: () => {
          this.saving.set(false);
          this.cancelarForm();
          this.novo = this.estadoInicial();
          this.carregar();
        },
        error: (e) => {
          this.saving.set(false);
          this.error.set(`Falha ao salvar: ${e?.error?.message ?? e?.message ?? e}`);
        },
      });
      return;
    }

    // Modo: Pessoa nova (cria pessoa + primeira visita)
    if (!this.novo.nome?.trim() || !this.novo.id_apartamento) {
      this.error.set('Informe nome e selecione o apartamento.');
      return;
    }
    this.saving.set(true);
    this.service.create(this.novo).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelarForm();
        this.novo = this.estadoInicial();
        this.carregar();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(`Falha ao salvar: ${e?.error?.message ?? e?.message ?? e}`);
      },
    });
  }

  async iniciarCamera(tipo: 'pessoa' | 'documento') {
    this.fecharCamera();
    this.activeCamera.set(tipo);

    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });

      // Aguardar renderização no DOM do elemento video webcam-preview
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

  onFileSelected(event: any, tipo: 'pessoa' | 'documento') {
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
        // Fallback para o comportamento padrão sem compressão
        const reader = new FileReader();
        reader.onload = (e: any) => {
          const base64 = e.target.result;
          if (tipo === 'pessoa') {
            this.fotoPessoaBase64.set(base64);
            this.novo.foto_pessoa = base64;
          } else if (tipo === 'documento') {
            this.fotoDocumentoBase64.set(base64);
            this.novo.foto_documento = base64;
          }
        };
        reader.readAsDataURL(file);
      });
  }

  removerFoto(tipo: 'pessoa' | 'documento') {
    // Vazio "" (não null) para sobreviver a coerções `?? undefined` no payload —
    // `undefined` some do JSON e o backend nunca removeria a foto. O backend
    // converte "" em null. Mesma abordagem do cadastro de morador.
    if (tipo === 'pessoa') {
      this.fotoPessoaBase64.set(null);
      this.novo.foto_pessoa = '';
    } else if (tipo === 'documento') {
      this.fotoDocumentoBase64.set(null);
      this.novo.foto_documento = '';
    }
  }

  async darBaixa(v: Visitante | Pessoa) {
    const ok = await this.confirm.ask({
      title: 'Dar baixa (Saída)',
      message: `Confirmar a saída de ${v.nome}?`,
      confirmLabel: 'Confirmar Saída',
      variant: 'primary',
    });
    if (!ok) return;
    this.service.checkOut(v.id).subscribe({
      next: () => this.carregar(),
      error: (e) => this.error.set(`Falha ao registrar saída: ${e?.message ?? e}`),
    });
  }

  async registrarEntradaManual(v: Visitante | Pessoa) {
    const ok = await this.confirm.ask({
      title: 'Registrar Entrada',
      message: `Confirmar a entrada de ${v.nome}?`,
      confirmLabel: 'Confirmar Entrada',
      variant: 'primary',
    });
    if (!ok) return;
    this.service.checkIn(v.id).subscribe({
      next: () => this.carregar(),
      error: (e) => this.error.set(`Falha ao registrar entrada: ${e?.message ?? e}`),
    });
  }

  iniciais(nome: string): string {
    return nome.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('');
  }

  togglePin(id: number, event: Event) {
    event.stopPropagation();
    const current = new Set(this.pinsRevelados());
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    this.pinsRevelados.set(current);
  }

  duracao(v: Visitante | Pessoa): string {
    if (!v.data_entrada) {
      return '—';
    }
    const inicio = new Date(v.data_entrada).getTime();
    const fim = v.data_saida
      ? new Date(v.data_saida).getTime()
      : Date.now();
    const min = Math.floor((fim - inicio) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  }

  getStatusVisitante(v: Visitante | Pessoa): 'presente' | 'liberado' | 'autorizado' | 'agendado' | 'saiu' {
    // 1. Entrou e ainda está dentro (saida não registrada)
    if (v.data_entrada && !v.data_saida) return 'presente';
    // 2. Saída real registrada
    if (v.data_saida) return 'saiu';
    // 3. Pré-autorizado manualmente/app (liberado === 1)
    if ((v as any).liberado === 1) return 'liberado';
    
    const now = Date.now();
    // 4. Dentro do período de liberação (ainda não entrou)
    if (v.data_hora_inicio && v.data_hora_termino) {
      const inicio = new Date(v.data_hora_inicio).getTime();
      const fim = new Date(v.data_hora_termino).getTime();
      if (now >= inicio && now <= fim) return 'autorizado';
    }
    // 5. Agendado (ainda não chegou o horário)
    return 'agendado';
  }

  abrirValidador() {
    this.pinCode.set('');
    this.validationResult.set(null);
    this.validationError.set(null);
    this.showValidationModal.set(true);
  }

  fecharValidador() {
    this.showValidationModal.set(false);
  }

  validarPIN() {
    const code = this.pinCode().trim().replace('-', '');
    if (!code) {
      this.validationError.set('Por favor, informe o código PIN.');
      return;
    }
    
    this.validating.set(true);
    this.validationError.set(null);
    this.validationResult.set(null);
    
    this.service.validarCodigo(code).subscribe({
      next: (res) => {
        this.validationResult.set(res);
        this.validating.set(false);
      },
      error: (err) => {
        this.validationError.set(err?.error?.message || 'Código inválido ou visita não agendada.');
        this.validating.set(false);
      }
    });
  }

  confirmarEntradaPIN() {
    const res = this.validationResult();
    if (!res || !res.id) return;
    
    this.checkingIn.set(true);
    const isSaida = !!res.data_entrada;
    const obs = isSaida 
      ? this.service.checkOut(res.id) 
      : this.service.checkIn(res.id);

    obs.subscribe({
      next: () => {
        this.checkingIn.set(false);
        this.fecharValidador();
        this.carregar();
      },
      error: (err) => {
        this.validationError.set(err?.error?.message || `Erro ao registrar ${isSaida ? 'saída' : 'entrada'}.`);
        this.checkingIn.set(false);
      }
    });
  }

  abrirAmpliarFoto(url: string, titulo: string, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.fotoAmpliadaUrl.set(url);
    this.fotoAmpliadaTitulo.set(titulo);
  }

  fecharAmpliarFoto() {
    this.fotoAmpliadaUrl.set(null);
  }

  private estadoInicial(): CreateVisitante {
    const prest = this.modo() === 'prestador';
    return {
      nome: '',
      doc_identificacao: '',
      id_apartamento: 0,
      is_visitante: prest ? 0 : 1,
      is_prestador: prest ? 1 : 0,
      tag_rfid: '',
      // Janela de validade padrão: a partir de agora, por 4h. O operador ajusta.
      data_hora_inicio: this.localDateTime(0),
      data_hora_termino: this.localDateTime(4),
    };
  }

  /** "YYYY-MM-DDTHH:mm" em hora local (formato do input datetime-local). */
  private localDateTime(horas = 0): string {
    const d = new Date(Date.now() + horas * 3600_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  getMapUrl(d: any): SafeResourceUrl | null {
    if (!d || !d.visitante) return null;
    const cond = d.visitante.condominio;
    if (!cond) return null;

    const bloco = d.visitante.blocoAptoAtual || '';
    let query = '';

    if (typeof cond === 'object') {
      const end = cond.enderecoRel;
      if (end && (end.rua || end.cidade)) {
        const addressStr = `${end.rua || ''}, ${end.numero || ''}, ${end.cidade || ''} - ${end.uf || ''}`;
        query = `${addressStr} ${bloco ? ' ' + bloco : ''}`;
      } else {
        query = `${cond.nome || ''} ${bloco ? ' ' + bloco : ''}`;
      }
    } else if (typeof cond === 'string') {
      query = `${cond} ${bloco ? ' ' + bloco : ''}`;
    }

    if (!query) return null;
    const url = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&t=&z=17&ie=UTF8&iwloc=&output=embed`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  getShareRouteLink(d: any): string {
    if (!d || !d.visitante) return '';
    const cond = d.visitante.condominio;
    if (!cond) return '';

    const bloco = d.visitante.blocoAptoAtual || '';
    let query = '';

    if (typeof cond === 'object') {
      const end = cond.enderecoRel;
      if (end && (end.rua || end.cidade)) {
        const addressStr = `${end.rua || ''}, ${end.numero || ''}, ${end.cidade || ''} - ${end.uf || ''}`;
        query = `${addressStr} ${bloco ? ' ' + bloco : ''}`;
      } else {
        query = `${cond.nome || ''} ${bloco ? ' ' + bloco : ''}`;
      }
    } else if (typeof cond === 'string') {
      query = `${cond} ${bloco ? ' ' + bloco : ''}`;
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  getCondominioNome(cond: any): string {
    if (!cond) return '';
    if (typeof cond === 'object') return cond.nome || '';
    return String(cond);
  }
}
