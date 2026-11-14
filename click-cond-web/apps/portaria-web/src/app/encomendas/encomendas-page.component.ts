import { ChangeDetectorRef, Component, DestroyRef, OnInit, computed, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription, forkJoin, lastValueFrom } from 'rxjs';
import {
  CreateEncomenda, Encomenda, EncomendasApi,
} from './encomendas.service';
import { ConfirmService } from '../shared/confirm.service';
import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';
import { aplicarLeitura, reduzirImagem } from './foto-encomenda';
import { Apartamento, ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ServerClockService } from '../core/server-clock.service';

/**
 * Escapa texto para o HTML das etiquetas: document.write não passa pelo escape
 * do Angular, e descricao/recebido_de/apto/bloco vêm do morador.
 */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FOTO_ILEGIVEL = 'Não foi possível abrir a foto';
/** Recarga automática da lista (mesmo ritmo da fila de delivery). */
const INTERVALO_RECARGA_MS = 20_000;
const NINGUEM_AVISADO = 'Ninguém foi avisado: a unidade não tem morador com aviso de encomendas ligado no app ou WhatsApp.';
const STATUS_DA_ROTA = ['Esperando', 'Aguardando', 'Retirada'];
/**
 * A recarga automática pede só as retiradas destes últimos dias (as que
 * aguardam vêm sempre) e sem assinatura/foto; as retiradas mais antigas, que
 * não mudam mais, ficam como vieram da carga completa.
 */
const RECARGA_RETIRADAS_DIAS = 7;

/** "Sem bloco" é nulo (pré-registro do app) ou '' (console): a mesma unidade. */
function blocoNorm(bloco: string | null | undefined): string {
  return (bloco ?? '').trim();
}

function mesmaUnidade(a: Encomenda, b: Encomenda): boolean {
  return a.destinatario_apto.trim() === b.destinatario_apto.trim() && blocoNorm(a.destinatario_bloco) === blocoNorm(b.destinatario_bloco);
}

/** Mensagem de erro da API (Nest pode mandar lista) ou do próprio erro. */
function mensagemErro(e: any, padrao: string): string {
  const m = e?.error?.message ?? e?.message;
  if (Array.isArray(m)) return m.join(', ');
  return m || padrao;
}

@Component({
  selector: 'app-encomendas-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SlideIndicatorDirective],
  templateUrl: './encomendas-page.component.html',
})
export class EncomendasPageComponent implements OnInit {
  private api = inject(EncomendasApi);
  private aptosApi = inject(ApartamentosApi);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  /** Hora do SERVIDOR (o PC da portaria costuma estar com o relógio errado). */
  private relogio = inject(ServerClockService);

  constructor() {
    effect(() => {
      this.filtro();
      this.busca();
      this.filtroTransportadora();
      this.filtroBloco();
      untracked(() => {
        this.pagina.set(1);
        this.selecionadas.set(new Set());
      });
    });
  }

  readonly encomendas = signal<Encomenda[]>([]);
  readonly apartamentos = signal<Apartamento[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Erros de registrar() (validação e falha do create); exibido só dentro do formulário. */
  readonly formError = signal<string | null>(null);
  readonly filtro = signal<string>('');

  readonly busca = signal<string>('');
  readonly filtroTransportadora = signal<string>('');
  readonly filtroBloco = signal<string>('');

  readonly selecionadas = signal<Set<number>>(new Set());
  readonly retirandoEncomenda = signal<Encomenda | null>(null);
  isBatchRetirada = false;
  /** Envio da retirada em andamento: Confirmar fica desabilitado (sem duplo envio). */
  readonly retirando = signal(false);
  /** Erro da retirada, mostrado dentro do modal (o banner da página fica atrás do scrim). */
  readonly retiradaErro = signal<string | null>(null);
  /** Envio do recebimento em andamento. */
  readonly salvando = signal(false);
  /** Aviso informativo da última ação (ninguém avisado, resumo do lote). */
  readonly aviso = signal<string | null>(null);
  /** Encomenda com o formulário "Corrigir unidade" aberto. */
  readonly corrigindo = signal<Encomenda | null>(null);
  readonly correcaoErro = signal<string | null>(null);
  readonly salvandoCorrecao = signal(false);
  /** Receber/Notificar em andamento por encomenda: o botão fica desabilitado (sem 409 nem push duplicado). */
  private readonly acoesEmAndamento = signal<ReadonlySet<number>>(new Set());
  readonly notificandoLote = signal(false);
  novaUnidade: Apartamento | null = null;
  private recargaSilenciosa?: Subscription;
  /** A última recarga automática falhou: a lista na tela pode estar velha. */
  readonly semConexao = signal(false);

  retiranteNome = '';
  retiranteDocumento = '';
  retiranteParentesco = 'Morador';

  readonly pagina = signal(1);
  readonly itensPorPagina = 20;

  readonly totalPaginas = computed(() => {
    const total = this.encomendasFiltradas().length;
    return Math.max(1, Math.ceil(total / this.itensPorPagina));
  });

  readonly encomendasPaginadas = computed(() => {
    const list = this.encomendasFiltradas();
    const p = this.pagina();
    const start = (p - 1) * this.itensPorPagina;
    const end = start + this.itensPorPagina;
    return list.slice(start, end);
  });

  readonly exibindoInicio = computed(() => {
    if (this.encomendasFiltradas().length === 0) return 0;
    return (this.pagina() - 1) * this.itensPorPagina + 1;
  });

  readonly exibindoFim = computed(() => {
    return Math.min(this.pagina() * this.itensPorPagina, this.encomendasFiltradas().length);
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

  readonly transportadorasDisponiveis = computed(() => {
    const list = this.encomendas();
    const set = new Set<string>();
    list.forEach(e => {
      if (e.recebido_de?.trim()) set.add(e.recebido_de.trim());
    });
    return Array.from(set).sort();
  });

  readonly blocosDisponiveis = computed(() => {
    const list = this.encomendas();
    const set = new Set<string>();
    list.forEach(e => {
      if (e.destinatario_bloco?.trim()) set.add(e.destinatario_bloco.trim());
    });
    return Array.from(set).sort();
  });

  readonly encomendasFiltradas = computed(() => {
    let list = this.encomendas();
    
    const f = this.filtro();
    if (f) {
      list = list.filter(e => e.status === f);
    }

    const text = this.busca().toLowerCase().trim();
    if (text) {
      list = list.filter(e => 
        e.descricao?.toLowerCase().includes(text) ||
        (e.recebido_de && e.recebido_de.toLowerCase().includes(text)) ||
        e.destinatario_apto?.toLowerCase().includes(text) ||
        (e.destinatario_bloco && e.destinatario_bloco.toLowerCase().includes(text)) ||
        (e.retirado_por && e.retirado_por.toLowerCase().includes(text)) ||
        `#${e.id}`.includes(text)
      );
    }

    const fTransp = this.filtroTransportadora();
    if (fTransp) {
      list = list.filter(e => e.recebido_de?.trim() === fTransp);
    }

    const fBloco = this.filtroBloco();
    if (fBloco) {
      list = list.filter(e => e.destinatario_bloco?.trim() === fBloco);
    }

    return list;
  });

  readonly totalAguardandoFiltradas = computed(() => {
    return this.encomendasFiltradas().filter(e => e.status === 'Aguardando');
  });

  /**
   * O que "Selecionar todas" marca: o lote é de um destinatário só, então são
   * as aguardando da unidade já selecionada (ou da primeira da lista).
   */
  readonly selecionaveisDoLote = computed(() => {
    const list = this.totalAguardandoFiltradas();
    if (list.length === 0) return [];
    const sel = this.selecionadas();
    const ref = (sel.size > 0 ? this.encomendas().find((item) => sel.has(item.id)) : undefined) ?? list[0];
    return list.filter((e) => mesmaUnidade(e, ref));
  });

  readonly todasSelecionadas = computed(() => {
    const list = this.selecionaveisDoLote();
    if (list.length === 0) return false;
    const sel = this.selecionadas();
    return list.every(e => sel.has(e.id));
  });

  readonly aguardando = computed(() => this.encomendas().filter((e) => e.status === 'Aguardando').length);
  readonly retiradas = computed(() => this.encomendas().filter((e) => e.status === 'Retirada').length);
  readonly esperando = computed(() => this.encomendas().filter((e) => e.status === 'Esperando').length);

  novo: CreateEncomenda = this.estadoInicial();
  selectedApto: Apartamento | null = null;
  showForm = false;
  // App zoneless: o que muda dentro de callbacks assíncronos (decodificação da foto, HTTP) precisa ser
  // signal ou marcar a view, senão o drawer não re-renderiza.
  readonly fotoVolume = signal<string | null>(null);
  readonly lendoEtiqueta = signal(false);
  readonly avisoEtiqueta = signal(false);

  fecharForm() {
    this.showForm = false;
    this.formError.set(null);
    this.limparFoto();
  }

  private limparFoto() {
    this.fotoVolume.set(null);
    this.lendoEtiqueta.set(false);
    this.avisoEtiqueta.set(false);
  }

  async onFotoEscolhida(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.avisoEtiqueta.set(false);
    if (this.formError() === FOTO_ILEGIVEL) this.formError.set(null);
    let imagem: string;
    try {
      imagem = await reduzirImagem(file);
    } catch {
      // ex.: HEIC no desktop; avisa sem travar o cadastro manual
      this.formError.set(FOTO_ILEGIVEL);
      return;
    }
    this.fotoVolume.set(imagem);
    this.lendoEtiqueta.set(true);
    this.api.lerEtiqueta(imagem).subscribe({
      next: (r) => {
        if (this.fotoVolume() !== imagem) return; // resposta de uma foto já trocada/removida
        this.lendoEtiqueta.set(false);
        const res = aplicarLeitura(this.novo, this.selectedApto, this.apartamentos(), r);
        this.novo = res.novo;
        this.selectedApto = res.selecionado;
        this.avisoEtiqueta.set(res.preencheu);
        this.cdr.markForCheck();
      },
      // falha/timeout: silencioso, formulário segue manual (só a foto atual desliga o "Lendo etiqueta…")
      error: () => {
        if (this.fotoVolume() === imagem) this.lendoEtiqueta.set(false);
      },
    });
  }

  removerFoto() {
    this.limparFoto();
  }

  ngOnInit() {
    this.carregar();
    this.carregarApartamentos();
    this.route.queryParams.subscribe((params) => {
      if (params['novo'] === 'true') {
        this.formError.set(null);
        this.showForm = true;
      }
      // Atalho do painel ("Aguardando retirada") abre já filtrado.
      if (STATUS_DA_ROTA.includes(params['status'])) this.filtro.set(params['status']);
    });
    // Recarga silenciosa com a aba visível: encomenda recebida/retirada em
    // outro posto aparece sem o porteiro recarregar a página.
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      this.recarregarSilencioso();
    }, INTERVALO_RECARGA_MS);
    this.destroyRef.onDestroy(() => {
      clearInterval(timer);
      this.recargaSilenciosa?.unsubscribe();
      this.stopCamera();
    });
  }

  carregar() {
    // Resposta atrasada da recarga automática não sobrescreve a carga nova.
    this.recargaSilenciosa?.unsubscribe();
    this.error.set(null);
    this.loading.set(true);
    this.api.list(undefined, { leve: true }).subscribe({
      next: (data) => {
        const antes = this.encomendas();
        this.encomendas.set(data);
        this.pagina.set(1);
        this.manterSelecaoValida(antes, data);
        this.semConexao.set(false);
        this.loading.set(false);
      },
      error: (e) => { this.error.set(mensagemErro(e, 'Erro')); this.loading.set(false); },
    });
  }

  /** Recarga sem spinner nem banner: mantém página, seleção válida e modais abertos. */
  recarregarSilencioso() {
    // Carga normal ou retirada em andamento: a recarga automática espera a próxima vez.
    if (this.loading() || this.retirando()) return;
    this.recargaSilenciosa?.unsubscribe();
    // Só o que ainda muda (aguardando, a chegar e as retiradas recentes), sem
    // assinatura/foto: o custo da recarga não cresce com o histórico.
    this.recargaSilenciosa = this.api.list(undefined, { leve: true, retiradasDias: RECARGA_RETIRADAS_DIAS }).subscribe({
      next: (recentes) => {
        const antes = this.encomendas();
        const data = this.juntarComRetiradasAntigas(antes, recentes);
        this.encomendas.set(data);
        const total = Math.max(1, Math.ceil(this.encomendasFiltradas().length / this.itensPorPagina));
        if (this.pagina() > total) this.pagina.set(total);
        this.manterSelecaoValida(antes, data);
        this.semConexao.set(false);
      },
      // Falha passageira: a lista na tela continua, com um aviso discreto; o
      // erro de ação (banner) não é tocado.
      error: () => this.semConexao.set(true),
    });
  }

  /**
   * A recarga traz só as retiradas recentes: as mais antigas da tela (que
   * não mudam mais) continuam, sem repetir as que vieram de novo. O corte usa
   * a hora do servidor (ServerClockService); a margem de 1 h cobre o resto.
   */
  private juntarComRetiradasAntigas(antes: Encomenda[], recentes: Encomenda[]): Encomenda[] {
    const limite = this.relogio.agora().getTime() - RECARGA_RETIRADAS_DIAS * 86_400_000 + 3_600_000;
    const vieram = new Set(recentes.map((e) => e.id));
    const antigas = antes.filter((e) =>
      !vieram.has(e.id) && e.status === 'Retirada' && !!e.retirado_em && new Date(e.retirado_em).getTime() < limite);
    if (!antigas.length) return recentes;
    return [...recentes, ...antigas].sort((a, b) => new Date(b.recebido_em).getTime() - new Date(a.recebido_em).getTime());
  }

  /** Recibo da retirada: a lista leve só diz se existe (`tem_comprovante`). */
  temComprovante(e: Encomenda): boolean {
    return e.tem_comprovante ?? !!(e.retirado_assinatura || e.retirado_foto);
  }

  emAndamento(id: number): boolean {
    return this.acoesEmAndamento().has(id);
  }

  private marcarAndamento(id: number, ligado: boolean) {
    const s = new Set(this.acoesEmAndamento());
    if (ligado) s.add(id);
    else s.delete(id);
    this.acoesEmAndamento.set(s);
  }

  /**
   * Tira da seleção o que não está mais aguardando retirada (retirada em outro
   * posto, removida) e o que mudou de unidade (o lote é de um destinatário só).
   */
  private manterSelecaoValida(antes: Encomenda[], data: Encomenda[]) {
    const sel = this.selecionadas();
    if (sel.size === 0) return;
    const unidade = (e: Encomenda) => `${(e.destinatario_bloco ?? '').trim()}|${e.destinatario_apto.trim()}`;
    const anterior = new Map(antes.map((e) => [e.id, unidade(e)]));
    const atual = new Map(data.filter((e) => e.status === 'Aguardando').map((e) => [e.id, unidade(e)]));
    const valida = new Set([...sel].filter((id) => atual.has(id) && (!anterior.has(id) || anterior.get(id) === atual.get(id))));
    if (valida.size !== sel.size) this.selecionadas.set(valida);
  }

  /** "Ninguém foi avisado" quando a API diz que o aviso não alcançou ninguém. */
  private avisarSeNinguem(r: { avisados?: number } | null | undefined) {
    if (r?.avisados === 0) this.aviso.set(NINGUEM_AVISADO);
  }

  carregarApartamentos() {
    this.aptosApi.list().subscribe({
      next: (data) => {
        data.sort((a, b) => {
          if (a.bloco === b.bloco) return a.apto.localeCompare(b.apto, 'pt', { numeric: true });
          return (a.bloco ?? '').localeCompare(b.bloco ?? '');
        });
        this.apartamentos.set(data);
      }
    });
  }

  registrar() {
    if (this.salvando()) return;
    this.formError.set(null);
    if (!this.novo.descricao?.trim() || !this.selectedApto) {
      this.formError.set('Descrição e apto destinatário são obrigatórios.');
      return;
    }
    
    this.novo.destinatario_bloco = this.selectedApto.bloco || '';
    this.novo.destinatario_apto = this.selectedApto.apto;

    const dto: CreateEncomenda = { ...this.novo };
    const foto = this.fotoVolume();
    if (foto) dto.foto_volume = foto;

    this.aviso.set(null);
    this.salvando.set(true);
    this.api.create(dto).subscribe({
      next: (r) => {
        this.salvando.set(false);
        this.formError.set(null);
        this.showForm = false;
        this.novo = this.estadoInicial();
        this.selectedApto = null;
        this.limparFoto();
        this.avisarSeNinguem(r);
        this.carregar();
      },
      error: (e) => {
        this.salvando.set(false);
        this.formError.set(mensagemErro(e, 'Erro'));
      },
    });
  }

  notificar(e: Encomenda) {
    if (this.emAndamento(e.id)) return;
    this.error.set(null);
    this.aviso.set(null);
    this.loading.set(true);
    this.marcarAndamento(e.id, true);
    this.api.notificar(e.id).subscribe({
      next: (r) => {
        this.marcarAndamento(e.id, false);
        this.avisarSeNinguem(r);
        this.carregar();
      },
      error: (err) => {
        this.marcarAndamento(e.id, false);
        this.loading.set(false);
        this.error.set(mensagemErro(err, 'Erro ao notificar morador'));
        // Já retirada (o morador deu baixa pelo app): a lista na tela estava velha.
        if (err?.status === 409) this.recarregarSilencioso();
      }
    });
  }

  /** Porteiro confirma o recebimento de uma encomenda "a chegar" (Esperando). */
  receber(e: Encomenda) {
    if (this.emAndamento(e.id)) return;
    this.error.set(null);
    this.aviso.set(null);
    this.loading.set(true);
    this.marcarAndamento(e.id, true);
    this.api.receber(e.id).subscribe({
      next: (r) => {
        this.marcarAndamento(e.id, false);
        this.avisarSeNinguem(r);
        this.carregar();
      },
      error: (err) => {
        this.marcarAndamento(e.id, false);
        this.error.set(mensagemErro(err, 'Erro ao receber encomenda'));
        this.loading.set(false);
      },
    });
  }

  abrirCorrecao(e: Encomenda) {
    this.corrigindo.set(e);
    this.correcaoErro.set(null);
    this.novaUnidade = null;
  }

  fecharCorrecao() {
    this.corrigindo.set(null);
    this.correcaoErro.set(null);
    this.novaUnidade = null;
  }

  /** Grava a unidade certa; a nova unidade é avisada pela API. */
  salvarCorrecao() {
    const e = this.corrigindo();
    if (!e || this.salvandoCorrecao()) return;
    if (!this.novaUnidade) {
      this.correcaoErro.set('Escolha a unidade certa.');
      return;
    }
    this.correcaoErro.set(null);
    this.aviso.set(null);
    this.salvandoCorrecao.set(true);
    this.api.corrigirUnidade(e.id, {
      destinatario_apto: this.novaUnidade.apto,
      destinatario_bloco: this.novaUnidade.bloco || '',
    }).subscribe({
      next: (r) => {
        this.salvandoCorrecao.set(false);
        this.fecharCorrecao();
        this.avisarSeNinguem(r);
        this.carregar();
      },
      error: (err) => {
        this.salvandoCorrecao.set(false);
        this.correcaoErro.set(mensagemErro(err, 'Não foi possível corrigir a unidade.'));
        if (err?.status === 409) this.recarregarSilencioso();
      },
    });
  }

  abrirRetirada(e: Encomenda) {
    this.retirandoEncomenda.set(e);
    this.isBatchRetirada = false;
    this.retiradaErro.set(null);
    this.retiranteNome = '';
    this.retiranteDocumento = '';
    this.retiranteParentesco = 'Morador';
    this.capturedPhoto = null;
    this.stopCamera();
  }

  abrirRetiradaLote() {
    if (this.selecionadas().size === 0) return;
    this.retirandoEncomenda.set(null);
    this.isBatchRetirada = true;
    this.retiradaErro.set(null);
    this.retiranteNome = '';
    this.retiranteDocumento = '';
    this.retiranteParentesco = 'Morador';
    this.capturedPhoto = null;
    this.stopCamera();
  }

  fecharRetirada() {
    this.retirandoEncomenda.set(null);
    this.isBatchRetirada = false;
    this.retiradaErro.set(null);
    this.capturedPhoto = null;
    this.stopCamera();
    this.cdr.markForCheck();
  }

  async confirmarRetirada(): Promise<void> {
    if (this.retirando()) return;
    if (!this.retiranteNome.trim()) {
      this.retiradaErro.set('Nome do retirante é obrigatório.');
      return;
    }

    const canvas = document.getElementById('signatureCanvas') as HTMLCanvasElement;
    let signature: string | null = null;
    if (canvas) {
      const blank = document.createElement('canvas');
      blank.width = canvas.width;
      blank.height = canvas.height;
      if (canvas.toDataURL() !== blank.toDataURL()) {
        signature = canvas.toDataURL('image/png');
      }
    }

    const photo = this.capturedPhoto;
    const details = `${this.retiranteNome} (${this.retiranteParentesco})`;

    this.error.set(null);
    this.aviso.set(null);
    this.retiradaErro.set(null);
    if (this.isBatchRetirada) {
      await this.retirarLote(Array.from(this.selecionadas()), details, signature, photo);
      return;
    }
    const e = this.retirandoEncomenda();
    if (!e) return;
    this.retirando.set(true);
    this.api.retirar(e.id, details, this.retiranteDocumento || undefined, signature || undefined, photo || undefined).subscribe({
      next: () => {
        this.retirando.set(false);
        this.fecharRetirada();
        this.carregar();
      },
      error: (err) => {
        this.retirando.set(false);
        const msg = mensagemErro(err, 'Erro ao registrar retirada');
        if (err?.status === 409) {
          // Já retirada (outro posto, outro clique): a lista na tela estava velha.
          this.fecharRetirada();
          this.carregar();
          this.error.set(msg);
          return;
        }
        this.retiradaErro.set(msg);
      }
    });
  }

  /**
   * Retirada em lote, uma por vez (a 1ª sobe assinatura/foto; as seguintes
   * reaproveitam a URL). Já retiradas (409) são puladas e contadas; outro erro
   * para o lote e aparece no modal, com o que já saiu fora da seleção.
   */
  private async retirarLote(ids: number[], details: string, signature: string | null, photo: string | null) {
    this.retirando.set(true);
    let currentSignature: string | undefined = signature || undefined;
    let currentPhoto: string | undefined = photo || undefined;
    let retiradas = 0;
    let jaRetiradas = 0;
    const tirarDaSelecao = (id: number) => {
      const s = new Set(this.selecionadas());
      s.delete(id);
      this.selecionadas.set(s);
    };
    for (const id of ids) {
      try {
        const res = await lastValueFrom(
          this.api.retirar(id, details, this.retiranteDocumento || undefined, currentSignature, currentPhoto),
        );
        if (res?.retirado_assinatura) currentSignature = res.retirado_assinatura;
        if (res?.retirado_foto) currentPhoto = res.retirado_foto;
        retiradas++;
        tirarDaSelecao(id);
      } catch (e: any) {
        if (e?.status === 409) {
          jaRetiradas++;
          tirarDaSelecao(id);
          continue;
        }
        this.retirando.set(false);
        const feitas = retiradas ? ` (${this.resumoLote(retiradas, jaRetiradas)} antes da falha)` : '';
        this.retiradaErro.set(mensagemErro(e, 'Erro ao retirar lote') + feitas);
        this.recarregarSilencioso();
        this.cdr.markForCheck();
        return;
      }
    }
    this.retirando.set(false);
    this.fecharRetirada();
    this.carregar();
    this.aviso.set(`${this.resumoLote(retiradas, jaRetiradas)}.`);
  }

  private resumoLote(retiradas: number, jaRetiradas: number): string {
    const feitas = retiradas === 1 ? '1 retirada' : `${retiradas} retiradas`;
    if (!jaRetiradas) return feitas;
    return `${feitas}, ${jaRetiradas === 1 ? '1 já estava retirada' : `${jaRetiradas} já estavam retiradas`}`;
  }

  toggleSelecionado(id: number) {
    const current = new Set(this.selecionadas());
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    this.selecionadas.set(current);
  }

  toggleSelecionarTodos() {
    const list = this.selecionaveisDoLote();
    if (list.length === 0) return;

    const current = new Set(this.selecionadas());
    if (this.todasSelecionadas()) {
      list.forEach(e => current.delete(e.id));
    } else {
      list.forEach(e => current.add(e.id));
    }
    this.selecionadas.set(current);
  }

  deveDesabilitarCheckbox(e: Encomenda): boolean {
    const sel = this.selecionadas();
    if (sel.size === 0) return false;

    const refId = Array.from(sel)[0];
    const ref = this.encomendas().find(item => item.id === refId);
    if (!ref) return false;

    return !mesmaUnidade(e, ref);
  }

  notificarLote() {
    const sel = Array.from(this.selecionadas());
    if (sel.length === 0 || this.notificandoLote()) return;

    this.error.set(null);
    this.aviso.set(null);
    this.loading.set(true);
    this.notificandoLote.set(true);
    // Import estático: o dinâmico não tinha catch e, se falhasse, deixava
    // notificandoLote e loading ligados para sempre.
    const requests = sel.map(id => this.api.notificar(id));
    forkJoin(requests).subscribe({
      next: (respostas) => {
        this.notificandoLote.set(false);
        // O lote é de uma unidade só: todas sem ninguém alcançado = ninguém avisado.
        if (respostas.length && respostas.every((r) => r?.avisados === 0)) this.aviso.set(NINGUEM_AVISADO);
        this.selecionadas.set(new Set());
        this.carregar();
      },
      error: (e) => {
        this.notificandoLote.set(false);
        this.loading.set(false);
        this.error.set(mensagemErro(e, 'Erro ao notificar lote'));
        // Alguma já retirada: a seleção na tela estava velha (a recarga tira da seleção o que saiu).
        if (e?.status === 409) this.recarregarSilencioso();
      }
    });
  }

  limparSelecao() {
    this.selecionadas.set(new Set());
  }

  imprimirLote() {
    const sel = this.selecionadas();
    if (sel.size === 0) return;

    const list = this.encomendas().filter(e => sel.has(e.id));
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) return;

    let htmlContent = `
      <html><head><title>Etiquetas em Lote</title>
      <style>
        body{font-family:Arial,sans-serif;padding:20px;margin:0}
        .label{border:2px solid #000;padding:16px;border-radius:8px;margin-bottom:20px;page-break-inside:avoid}
        .id{font-size:11px;color:#666;letter-spacing:2px;text-transform:uppercase}
        .apto{font-size:36px;font-weight:bold;margin:8px 0;letter-spacing:-1px}
        .desc{font-size:14px;margin:8px 0;border-top:1px dashed #999;padding-top:8px}
        .meta{font-size:11px;color:#666;margin-top:12px}
      </style></head><body>
    `;

    list.forEach(e => {
      htmlContent += `
        <div class="label">
          <div class="id">Encomenda #${esc(e.id)}</div>
          <div class="apto">${e.destinatario_bloco ? esc(e.destinatario_bloco) + ' / ' : ''}${esc(e.destinatario_apto)}</div>
          <div class="desc">${esc(e.descricao)}</div>
          <div class="meta">Recebido de: ${esc(e.recebido_de ?? '—')}<br>Em: ${esc(new Date(e.recebido_em).toLocaleString('pt-BR'))}</div>
        </div>
      `;
    });

    htmlContent += `
      <script>window.onload=()=>window.print()</script>
      </body></html>
    `;

    w.document.write(htmlContent);
    w.document.close();
  }

  imprimir(e: Encomenda) {
    const w = window.open('', '_blank', 'width=400,height=300');
    if (!w) return;
    w.document.write(`
      <html><head><title>Etiqueta #${esc(e.id)}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:20px;margin:0}
        .label{border:2px solid #000;padding:16px;border-radius:8px}
        .id{font-size:11px;color:#666;letter-spacing:2px;text-transform:uppercase}
        .apto{font-size:48px;font-weight:bold;margin:8px 0;letter-spacing:-1px}
        .desc{font-size:14px;margin:8px 0;border-top:1px dashed #999;padding-top:8px}
        .meta{font-size:11px;color:#666;margin-top:12px}
      </style></head><body>
      <div class="label">
        <div class="id">Encomenda #${esc(e.id)}</div>
        <div class="apto">${e.destinatario_bloco ? esc(e.destinatario_bloco) + ' / ' : ''}${esc(e.destinatario_apto)}</div>
        <div class="desc">${esc(e.descricao)}</div>
        <div class="meta">Recebido de: ${esc(e.recebido_de ?? '—')}<br>Em: ${esc(new Date(e.recebido_em).toLocaleString('pt-BR'))}</div>
      </div>
      <script>window.onload=()=>window.print()</script>
      </body></html>
    `);
    w.document.close();
  }

  async remover(e: Encomenda) {
    const ok = await this.confirm.ask({
      title: 'Remover encomenda',
      message: `A encomenda "${e.descricao}" será excluída do registro.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.error.set(null);
    this.api.remove(e.id).subscribe({
      next: () => this.carregar(),
      error: (err) => this.error.set(mensagemErro(err, 'Não foi possível remover a encomenda.')),
    });
  }

  /** Dias de calendário na portaria (recebida ontem às 23 h é "há 1 dia" às 8 h de hoje). */
  diasArmazenada(e: Encomenda): number {
    const recebido = new Date(e.recebido_em);
    const ref = e.retirado_em ? new Date(e.retirado_em) : new Date();
    const dia = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.max(0, Math.round((dia(ref) - dia(recebido)) / 86400000));
  }

  /** "hoje" / "há 1 dia" / "há N dias" — tempo que a encomenda ficou (ou está) na portaria. */
  textoArmazenada(e: Encomenda): string {
    const d = this.diasArmazenada(e);
    return d <= 0 ? 'hoje' : d === 1 ? 'há 1 dia' : `há ${d} dias`;
  }

  /** Urgência de quem ainda aguarda retirada: ≥3 dias atenção, ≥7 crítico. */
  nivelArmazenada(e: Encomenda): 'ok' | 'atencao' | 'critico' {
    if (e.status !== 'Aguardando') return 'ok';
    const d = this.diasArmazenada(e);
    return d >= 7 ? 'critico' : d >= 3 ? 'atencao' : 'ok';
  }

  /** "Apto 101 · Bloco A" (o bloco pode vir "A" ou "Bloco A"). */
  rotuloDestino(e: Pick<Encomenda, 'destinatario_bloco' | 'destinatario_apto'>): string {
    const bloco = (e.destinatario_bloco ?? '').toString().trim();
    const blocoTxt = bloco ? (/^bloco\s/i.test(bloco) ? bloco : `Bloco ${bloco}`) : '';
    return blocoTxt ? `Apto ${e.destinatario_apto} · ${blocoTxt}` : `Apto ${e.destinatario_apto}`;
  }

  /** Rótulo do filtro de blocos: evita duplicar o prefixo quando o nome já vem como "Bloco A". */
  rotuloBloco(bloco: string): string {
    const b = (bloco ?? '').toString().trim();
    return /^bloco\s/i.test(b) ? b : `Bloco ${b}`;
  }

  private estadoInicial(): CreateEncomenda {
    return { descricao: '', destinatario_apto: '', destinatario_bloco: '', recebido_de: '', codigo_rastreio: '' };
  }

  // Barcode / QR Code Scanner properties
  isScanning = false;
  scanError: string | null = null;
  private codeReader: any;

  async loadZXing(): Promise<any> {
    if ((window as any).ZXing) return (window as any).ZXing;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/@zxing/library@0.19.1/umd/index.min.js';
      script.onload = () => resolve((window as any).ZXing);
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
  }

  async startScan() {
    try {
      this.isScanning = true;
      this.scanError = null;
      const ZXing = await this.loadZXing();
      this.codeReader = new ZXing.BrowserMultiFormatReader();
      
      const videoDevices = await this.codeReader.listVideoInputDevices();
      if (videoDevices.length === 0) {
        throw new Error('Nenhuma câmera encontrada.');
      }
      
      const selectedDevice = videoDevices.find((device: any) => 
        device.label.toLowerCase().includes('back') || 
        device.label.toLowerCase().includes('traseira') ||
        device.label.toLowerCase().includes('rear')
      ) || videoDevices[0];

      setTimeout(() => {
        const videoElement = document.getElementById('scanVideo') as HTMLVideoElement;
        if (videoElement) {
          this.codeReader.decodeFromVideoDevice(
            selectedDevice.deviceId,
            videoElement,
            (result: any) => {
              if (result) {
                try {
                  const context = new AudioContext();
                  const osc = context.createOscillator();
                  osc.type = 'sine';
                  osc.frequency.value = 1000;
                  osc.connect(context.destination);
                  osc.start();
                  setTimeout(() => osc.stop(), 100);
                } catch {}

                this.onBarcodeScanned(result.text);
              }
            }
          );
        }
      }, 300);
    } catch (err: any) {
      console.error('Scan error:', err);
      this.scanError = err?.message || 'Erro ao inicializar scanner de código.';
      this.isScanning = false;
    }
  }

  stopScan() {
    if (this.codeReader) {
      this.codeReader.reset();
    }
    this.isScanning = false;
  }

  onBarcodeScanned(code: string) {
    this.novo.codigo_rastreio = code;
    
    const cleanCode = code.trim().toUpperCase();
    if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(cleanCode)) {
      this.novo.recebido_de = 'Correios';
      this.novo.descricao = `Volume Correios (${cleanCode})`;
    } else if (/^(ML|MLB)\d+/.test(cleanCode)) {
      this.novo.recebido_de = 'Mercado Livre';
      this.novo.descricao = `Volume Mercado Livre (${cleanCode})`;
    } else if (cleanCode.startsWith('AMZN') || cleanCode.startsWith('AZ')) {
      this.novo.recebido_de = 'Amazon';
      this.novo.descricao = `Volume Amazon (${cleanCode})`;
    } else {
      this.novo.descricao = `Volume Escaneado (${cleanCode})`;
    }
    
    this.stopScan();
  }

  // Camera & Photo properties
  cameraStream: MediaStream | null = null;
  capturedPhoto: string | null = null;
  isCameraActive = false;

  // Signature drawing properties
  private isDrawing = false;
  private lastX = 0;
  private lastY = 0;

  // Signature Drawing handlers
  onMouseDown(e: MouseEvent) {
    const canvas = e.target as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    this.isDrawing = true;
    this.lastX = e.clientX - rect.left;
    this.lastY = e.clientY - rect.top;
  }

  onMouseMove(e: MouseEvent) {
    if (!this.isDrawing) return;
    const canvas = e.target as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--qr-ink').trim() || '#000'; // tinta da assinatura: token do tema
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(this.lastX, this.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();

    this.lastX = x;
    this.lastY = y;
  }

  onMouseUp() {
    this.isDrawing = false;
  }

  onTouchStart(e: TouchEvent) {
    if (e.touches.length === 0) return;
    const canvas = e.target as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    this.isDrawing = true;
    const touch = e.touches[0];
    this.lastX = touch.clientX - rect.left;
    this.lastY = touch.clientY - rect.top;
    e.preventDefault();
  }

  onTouchMove(e: TouchEvent) {
    if (!this.isDrawing || e.touches.length === 0) return;
    const canvas = e.target as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    ctx.beginPath();
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--qr-ink').trim() || '#000'; // tinta da assinatura: token do tema
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(this.lastX, this.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();

    this.lastX = x;
    this.lastY = y;
    e.preventDefault();
  }

  clearSignature() {
    const canvas = document.getElementById('signatureCanvas') as HTMLCanvasElement;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }

  async startCamera() {
    try {
      this.isCameraActive = true;
      this.capturedPhoto = null;
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' }
      });
      setTimeout(() => {
        const video = document.getElementById('webcamVideo') as HTMLVideoElement;
        if (video && this.cameraStream) {
          video.srcObject = this.cameraStream;
          video.play().catch(err => console.log('Erro ao dar play no video:', err));
        }
      }, 200);
    } catch (err) {
      console.error('Erro ao acessar webcam:', err);
      alert('Não foi possível acessar a câmera. Verifique as permissões de vídeo.');
      this.isCameraActive = false;
    }
  }

  capturePhoto() {
    const video = document.getElementById('webcamVideo') as HTMLVideoElement;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      this.capturedPhoto = canvas.toDataURL('image/jpeg', 0.8);
    }
    this.stopCamera();
  }

  stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(track => track.stop());
      this.cameraStream = null;
    }
    this.isCameraActive = false;
  }

  readonly viewingProof = signal<{ signature: string | null; photo: string | null; descricao: string } | null>(null);

  abrirComprovante(e: Encomenda) {
    if (e.retirado_assinatura || e.retirado_foto) {
      this.viewingProof.set({
        signature: e.retirado_assinatura ?? null,
        photo: e.retirado_foto ?? null,
        descricao: e.descricao
      });
      return;
    }
    // Lista leve: assinatura e foto vêm só quando o recibo é aberto.
    this.api.get(e.id).subscribe({
      next: (completa) => this.viewingProof.set({
        signature: completa.retirado_assinatura ?? null,
        photo: completa.retirado_foto ?? null,
        descricao: completa.descricao ?? e.descricao,
      }),
      error: (err) => this.error.set(mensagemErro(err, 'Não foi possível abrir o comprovante.')),
    });
  }
}
