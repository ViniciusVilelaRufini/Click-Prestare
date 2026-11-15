import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { VeiculosApi, Tag, VeiculoComMorador } from '../moradores/veiculos.service';
import { Morador, MoradoresApi } from '../moradores/moradores.service';
import { ConfirmService } from '../shared/confirm.service';
import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';
import { EnrollCaptureComponent } from '../shared/enroll-capture.component';
import { AuthService } from '../auth/auth.service';
import {
  CamposGuaritaDaTag,
  GuaritaDevice,
  GuaritaDispositivo,
  GuaritaService,
  LIMITE_VEICULOS_PARA_VINCULAR,
  MSG_CODIGO_IMPRESSO_INVALIDO,
  PaginaGuarita,
  VeiculoParaVincular,
  ROTULO_TIPO_GUARITA,
  codigoImpressoValido,
  rotuloEstadoGuarita,
} from '../guarita/guarita.service';
import { GuaritaCapturaComponent } from '../guarita/guarita-captura.component';

/** Mensagem de erro da API (texto ou lista do class-validator), ou o padrão. */
function mensagemDaApi(e: any, padrao: string): string {
  const m = e?.error?.message;
  if (Array.isArray(m)) return m.join(' ');
  return (typeof m === 'string' && m) || padrao;
}

@Component({
  selector: 'app-veiculos-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SlideIndicatorDirective, EnrollCaptureComponent, GuaritaCapturaComponent],
  templateUrl: './veiculos-page.component.html',
})
export class VeiculosPageComponent implements OnInit {
  private api = inject(VeiculosApi);
  private moradoresApi = inject(MoradoresApi);
  private confirm = inject(ConfirmService);
  private auth = inject(AuthService);
  private guaritaApi = inject(GuaritaService);

  /** Condomínio do operador — o leitor de captura é escolhido entre os dele. */
  idCondominioAtual = () => this.auth.porteiroInfo()?.id_condominio ?? null;

  readonly tab = signal<'veiculos' | 'tags' | 'a_vincular'>('veiculos');
  readonly loading = signal(true);
  readonly veiculos = signal<VeiculoComMorador[]>([]);
  /** Todas as tags do condomínio, inclusive as bloqueadas. */
  readonly tags = signal<Tag[]>([]);
  /** Falha ao carregar a lista de tags (a aba mostra o erro em vez de "vazio"). */
  readonly erroTags = signal<string | null>(null);
  readonly busca = signal('');

  readonly veiculosFiltrados = computed(() => {
    const q = this.busca().toLowerCase().trim();
    const lista = this.veiculos();
    if (!q) return lista;
    return lista.filter((v) =>
      v.placa.toLowerCase().includes(q) ||
      (v.marca_modelo ?? '').toLowerCase().includes(q) ||
      (v.morador?.nome ?? '').toLowerCase().includes(q) ||
      (v.morador?.apartamento ?? '').toLowerCase().includes(q),
    );
  });

  ngOnInit() {
    this.carregar();
    this.carregarGuarita();
  }

  carregar() {
    this.loading.set(true);
    this.erroTags.set(null);
    const falhouTags = () => {
      this.erroTags.set('Não foi possível carregar as tags.');
      this.loading.set(false);
    };
    this.api.listAll().subscribe({
      next: (data) => {
        this.veiculos.set(data);
        this.api.listTags(false, true).subscribe({
          next: (t) => { this.tags.set(t); this.loading.set(false); },
          error: falhouTags,
        });
      },
      error: falhouTags,
    });
  }

  // ===== Veículo: modal criar/editar =====
  readonly modalVeiculo = signal(false);
  readonly editandoVeiculo = signal<VeiculoComMorador | null>(null);
  readonly salvandoVeiculo = signal(false);
  readonly erroVeiculo = signal<string | null>(null);
  novoVeiculo: { placa: string; cor: string; marca_modelo: string; id_tag: number | null } = {
    placa: '', cor: '', marca_modelo: '', id_tag: null,
  };
  /** Código de tag digitado (ou capturado pelo leitor): ao salvar vira tag e é vinculado. */
  codigoTag = '';

  // Busca de morador (só na criação — na edição o titular não muda)
  readonly buscaMorador = signal('');
  readonly moradoresEncontrados = signal<Morador[]>([]);
  readonly moradorSelecionado = signal<Morador | null>(null);
  readonly buscandoMoradores = signal(false);

  abrirNovoVeiculo() {
    this.editandoVeiculo.set(null);
    this.novoVeiculo = { placa: '', cor: '', marca_modelo: '', id_tag: null };
    this.buscaMorador.set('');
    this.moradoresEncontrados.set([]);
    this.moradorSelecionado.set(null);
    this.codigoTag = '';
    this.erroVeiculo.set(null);
    this.modalVeiculo.set(true);
  }

  abrirEditarVeiculo(v: VeiculoComMorador) {
    this.editandoVeiculo.set(v);
    this.novoVeiculo = {
      placa: v.placa,
      cor: v.cor ?? '',
      marca_modelo: v.marca_modelo ?? '',
      id_tag: v.id_tag,
    };
    this.codigoTag = '';
    this.erroVeiculo.set(null);
    this.modalVeiculo.set(true);
  }

  fecharModalVeiculo() {
    this.modalVeiculo.set(false);
  }

  onBuscarMorador() {
    const termo = this.buscaMorador().trim();
    if (termo.length < 2) {
      this.moradoresEncontrados.set([]);
      return;
    }
    this.buscandoMoradores.set(true);
    this.moradoresApi.list(termo).subscribe({
      next: (data) => {
        // Resposta de uma busca anterior ("Vi") chegando depois da atual
        // ("Vinicius Fam") sobrescrevia a lista com resultados errados.
        if (this.buscaMorador().trim() !== termo) return;
        this.moradoresEncontrados.set(data);
        this.buscandoMoradores.set(false);
      },
      error: () => this.buscandoMoradores.set(false),
    });
  }

  selecionarMorador(m: Morador) {
    this.moradorSelecionado.set(m);
    this.moradoresEncontrados.set([]);
    this.buscaMorador.set(m.nome);
  }

  salvarVeiculo() {
    const placa = this.novoVeiculo.placa.trim();
    if (!placa) { this.erroVeiculo.set('Placa é obrigatória.'); return; }

    const editando = this.editandoVeiculo();
    const idMorador = editando ? editando.id_morador : this.moradorSelecionado()?.id;
    if (!idMorador) { this.erroVeiculo.set('Selecione o morador titular do veículo.'); return; }

    this.salvandoVeiculo.set(true);
    this.erroVeiculo.set(null);

    const falhou = (padrao: string) => (e: any) => {
      this.salvandoVeiculo.set(false);
      this.erroVeiculo.set(mensagemDaApi(e, padrao));
    };

    const gravar = (idTag: number | null) => {
      const dto = {
        placa,
        cor: this.novoVeiculo.cor.trim() || null,
        marca_modelo: this.novoVeiculo.marca_modelo.trim() || null,
        id_tag: idTag,
      };
      const request = editando
        ? this.api.update(editando.id, dto)
        : this.api.create(idMorador, dto);
      request.subscribe({
        next: () => {
          this.salvandoVeiculo.set(false);
          this.fecharModalVeiculo();
          this.carregar();
        },
        error: falhou('Falha ao salvar veículo.'),
      });
    };

    // Código digitado/capturado tem prioridade sobre o select: a API normaliza,
    // valida e devolve a tag (criada ou já existente) para vincular.
    const codigo = this.codigoTag.trim();
    if (!codigo) { gravar(this.novoVeiculo.id_tag || null); return; }
    this.api.createTag({ codigo, tipo: 'rfid' }).subscribe({
      next: (tag) => {
        // Se o veículo falhar a seguir, a tag já existe: fica escolhida no
        // select e o código não é reenviado na nova tentativa.
        this.tags.update((lista) => [tag, ...lista.filter((t) => t.id !== tag.id)]);
        this.novoVeiculo.id_tag = tag.id;
        this.codigoTag = '';
        gravar(tag.id);
      },
      error: falhou('Falha ao cadastrar a tag.'),
    });
  }

  /** Leitura pelo leitor: preenche o campo de código; a tag é criada ao salvar. */
  onTagCapturada(codigo: string) {
    if (!codigo?.trim()) return;
    this.codigoTag = codigo.trim();
    this.erroVeiculo.set(null);
  }

  /** Tags do select: as ativas e, mesmo bloqueada, a que o veículo já usa. */
  tagsParaSelecao(): Tag[] {
    return this.tags().filter((t) => t.ativo !== 0 || t.id === this.novoVeiculo.id_tag);
  }

  async removerVeiculo(v: VeiculoComMorador) {
    const ok = await this.confirm.ask({
      title: 'Remover veículo',
      message: `O veículo de placa ${v.placa} será removido.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.erroAcaoVeiculo.set(null);
    this.api.remove(v.id).subscribe({
      next: () => this.carregar(),
      error: (e) => this.erroAcaoVeiculo.set(mensagemDaApi(e, e?.message ?? 'Falha ao remover o veículo.')),
    });
  }

  /** Erro da última ação sobre um veículo da lista (ex.: remover). */
  readonly erroAcaoVeiculo = signal<string | null>(null);

  // ===== Tag: modal criar =====
  readonly modalTag = signal(false);
  readonly salvandoTag = signal(false);
  readonly erroTag = signal<string | null>(null);
  novaTag: { codigo: string; tipo: string; descricao: string } = { codigo: '', tipo: 'rfid', descricao: '' };

  abrirNovaTag() {
    this.novaTag = { codigo: '', tipo: 'rfid', descricao: '' };
    this.erroTag.set(null);
    this.modalTag.set(true);
  }

  fecharModalTag() {
    this.modalTag.set(false);
  }

  salvarTag() {
    const codigo = this.novaTag.codigo.trim();
    if (!codigo) { this.erroTag.set('Código da tag é obrigatório.'); return; }
    this.salvandoTag.set(true);
    this.erroTag.set(null);
    this.api.createTag({
      codigo,
      tipo: this.novaTag.tipo || 'rfid',
      descricao: this.novaTag.descricao.trim() || undefined,
    }).subscribe({
      next: () => {
        this.salvandoTag.set(false);
        this.fecharModalTag();
        this.carregar();
      },
      error: (e) => {
        this.salvandoTag.set(false);
        this.erroTag.set(mensagemDaApi(e, 'Falha ao cadastrar tag.'));
      },
    });
  }

  // ===== Tags: bloquear / reativar / excluir =====
  /** Id da tag com ação em andamento (desabilita os botões da linha). */
  readonly tagEmAcao = signal<number | null>(null);
  readonly erroAcaoTag = signal<string | null>(null);

  /** Veículo ativo que usa a tag — a rota de tags não devolve o vínculo. */
  veiculoDaTag(t: Tag): VeiculoComMorador | undefined {
    return this.veiculos().find((v) => v.id_tag === t.id);
  }

  definirTagAtiva(t: Tag, ativo: boolean) {
    this.tagEmAcao.set(t.id);
    this.erroAcaoTag.set(null);
    this.api.setTagAtivo(t.id, ativo).subscribe({
      next: (atualizada) => {
        this.tagEmAcao.set(null);
        this.tags.update((lista) => lista.map((x) => (x.id === t.id ? { ...x, ...atualizada } : x)));
      },
      error: (e) => {
        this.tagEmAcao.set(null);
        this.erroAcaoTag.set(mensagemDaApi(e, ativo ? 'Falha ao reativar a tag.' : 'Falha ao bloquear a tag.'));
      },
    });
  }

  async excluirTag(t: Tag) {
    const v = this.veiculoDaTag(t);
    const doGuarita = this.tagNoGuarita(t)
      ? ' O dispositivo também será apagado do Guarita e deixa de abrir o portão.'
      : '';
    const ok = await this.confirm.ask({
      title: 'Excluir tag',
      message: (v
        ? `A tag ${t.codigo} será excluída e o veículo de placa ${v.placa} ficará sem tag.`
        : `A tag ${t.codigo} será excluída.`) + doGuarita,
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    this.tagEmAcao.set(t.id);
    this.erroAcaoTag.set(null);
    this.api.removeTag(t.id).subscribe({
      next: () => {
        this.tagEmAcao.set(null);
        this.carregar();
      },
      error: (e) => {
        this.tagEmAcao.set(null);
        this.erroAcaoTag.set(mensagemDaApi(e, 'Falha ao excluir a tag.'));
      },
    });
  }

  /** Tag do veículo: a da lista (situação mais recente) ou a que veio com ele. */
  private tagDoVeiculo(v: VeiculoComMorador): Tag | null {
    if (!v.id_tag) return null;
    return this.tags().find((x) => x.id === v.id_tag) ?? v.tag ?? null;
  }

  tagLabel(v: VeiculoComMorador): string {
    if (!v.id_tag) return '—';
    return this.tagDoVeiculo(v)?.codigo ?? `#${v.id_tag}`;
  }

  tagBloqueada(v: VeiculoComMorador): boolean {
    return this.tagDoVeiculo(v)?.ativo === 0;
  }

  // ===================== Módulo Guarita (só com aparelho do tipo guarita) =====================

  /** Guaritas ativos do condomínio. Vazio = a tela é exatamente a de sempre. */
  readonly guaritas = signal<GuaritaDevice[]>([]);
  readonly temGuarita = computed(() => this.guaritas().length > 0);
  readonly rotuloTipoGuarita = ROTULO_TIPO_GUARITA;
  /** Tag com aprovar/recusar/vincular em andamento (um clique = uma chamada). */
  readonly guaritaEmAcao = signal<number | null>(null);
  readonly erroGuarita = signal<string | null>(null);
  /** Veículo com o cadastro de controle/tag aberto. */
  readonly capturaVeiculo = signal<VeiculoComMorador | null>(null);

  carregarGuarita() {
    this.guaritaApi.listarGuaritas().subscribe((lista) => {
      this.guaritas.set(lista);
      if (!lista.length) return;
      this.guaritaVincular = lista[0].id;
      this.carregarAVincular();
    });
  }

  private recarregarTudo() {
    this.carregar();
    if (this.temGuarita()) this.carregarAVincular();
  }

  // ---- "A vincular": paginada e com busca no servidor ----

  static readonly POR_PAGINA_A_VINCULAR = 50;
  /** Guarita cuja lista "A vincular" está na tela. */
  guaritaVincular: number | null = null;
  buscaVincular = '';
  readonly pagVincular = signal<PaginaGuarita<GuaritaDispositivo> | null>(null);
  readonly carregandoVincular = signal(false);
  readonly aVincular = computed(() => this.pagVincular()?.itens ?? []);
  readonly totalAVincular = computed(() => this.pagVincular()?.total ?? 0);
  readonly totalPaginasVincular = computed(() => {
    const p = this.pagVincular();
    if (!p || !p.total) return 1;
    return Math.max(1, Math.ceil(p.total / (p.por_pagina || VeiculosPageComponent.POR_PAGINA_A_VINCULAR)));
  });
  private timerBuscaVincular?: ReturnType<typeof setTimeout>;
  /** Evita que a resposta de uma busca antiga sobrescreva a atual. */
  private pedidoVincular = 0;

  carregarAVincular(pagina = 1) {
    const deviceId = this.guaritaVincular;
    if (deviceId == null) return;
    const pedido = ++this.pedidoVincular;
    this.carregandoVincular.set(true);
    this.guaritaApi
      .dispositivos(deviceId, {
        estado: 'a_vincular',
        busca: this.buscaVincular,
        pagina,
        por_pagina: VeiculosPageComponent.POR_PAGINA_A_VINCULAR,
      })
      .subscribe({
        next: (p) => {
          if (pedido !== this.pedidoVincular) return;
          this.carregandoVincular.set(false);
          this.pagVincular.set(p);
        },
        error: (e) => {
          if (pedido !== this.pedidoVincular) return;
          this.carregandoVincular.set(false);
          this.pagVincular.set(null);
          // Rota ausente (API antiga) = lista vazia, sem erro vermelho.
          if (e?.status !== 404) this.erroGuarita.set(mensagemDaApi(e, 'Não foi possível carregar a lista "A vincular".'));
        },
      });
  }

  onBuscaVincular(termo: string) {
    this.buscaVincular = termo;
    if (this.timerBuscaVincular) clearTimeout(this.timerBuscaVincular);
    this.timerBuscaVincular = setTimeout(() => this.carregarAVincular(1), 300);
  }

  trocarGuaritaVincular(id: number) {
    this.guaritaVincular = Number(id);
    this.carregarAVincular(1);
  }

  paginaVincular(delta: number) {
    const atual = this.pagVincular()?.pagina ?? 1;
    const nova = atual + delta;
    if (nova < 1 || nova > this.totalPaginasVincular() || this.carregandoVincular()) return;
    this.carregarAVincular(nova);
  }

  // ---- Vincular um dispositivo: busca do veículo sob demanda (no máximo 20) ----

  readonly vinculando = signal<GuaritaDispositivo | null>(null);
  buscaVeiculoVincular = '';
  readonly opcoesVincular = signal<VeiculoParaVincular[]>([]);
  readonly buscandoVeiculoVincular = signal(false);
  readonly erroVincular = signal<string | null>(null);
  /** A API não tem a busca (404): procura na lista de veículos já carregada. */
  private buscaVeiculoLocal = false;
  private timerBuscaVeiculo?: ReturnType<typeof setTimeout>;
  private pedidoVeiculo = 0;

  abrirVincular(d: GuaritaDispositivo) {
    this.erroVincular.set(null);
    this.buscaVeiculoVincular = '';
    this.opcoesVincular.set([]);
    this.vinculando.set(d);
    this.buscarVeiculoParaVincular();
  }

  fecharVincular() {
    this.vinculando.set(null);
    if (this.timerBuscaVeiculo) clearTimeout(this.timerBuscaVeiculo);
  }

  onBuscaVeiculoVincular(termo: string) {
    this.buscaVeiculoVincular = termo;
    if (this.timerBuscaVeiculo) clearTimeout(this.timerBuscaVeiculo);
    this.timerBuscaVeiculo = setTimeout(() => this.buscarVeiculoParaVincular(), 300);
  }

  private buscarVeiculoParaVincular() {
    const d = this.vinculando();
    if (!d) return;
    const termo = this.buscaVeiculoVincular;
    if (this.buscaVeiculoLocal) {
      this.opcoesVincular.set(this.veiculosLocaisParaVincular(termo));
      return;
    }
    const pedido = ++this.pedidoVeiculo;
    this.buscandoVeiculoVincular.set(true);
    this.guaritaApi.veiculosParaVincular(d.id_device, termo).subscribe({
      next: (lista) => {
        if (pedido !== this.pedidoVeiculo) return;
        this.buscandoVeiculoVincular.set(false);
        this.opcoesVincular.set(lista);
      },
      error: (e) => {
        if (pedido !== this.pedidoVeiculo) return;
        this.buscandoVeiculoVincular.set(false);
        if (e?.status === 404) {
          this.buscaVeiculoLocal = true;
          this.opcoesVincular.set(this.veiculosLocaisParaVincular(termo));
          return;
        }
        this.erroVincular.set(mensagemDaApi(e, 'Não foi possível buscar os veículos.'));
      },
    });
  }

  /** Veículos já carregados nesta tela, sem tag (a API recusa os que têm), filtrados pela busca. */
  private veiculosLocaisParaVincular(termo: string): VeiculoParaVincular[] {
    const q = termo.toLowerCase().trim();
    return this.veiculos()
      .filter((v) => !v.id_tag)
      .filter(
        (v) =>
          !q ||
          v.placa.toLowerCase().includes(q) ||
          (v.morador?.nome ?? '').toLowerCase().includes(q) ||
          (v.morador?.apartamento ?? '').toLowerCase().includes(q),
      )
      .slice(0, LIMITE_VEICULOS_PARA_VINCULAR)
      .map((v) => ({
        id: v.id,
        placa: v.placa,
        marca_modelo: v.marca_modelo,
        morador_nome: v.morador?.nome ?? null,
        apartamento: v.morador?.apartamento ?? null,
        bloco: v.morador?.bloco ?? null,
      }));
  }

  escolherVeiculoParaVincular(op: VeiculoParaVincular) {
    const d = this.vinculando();
    if (!d || this.guaritaEmAcao() !== null) return;
    this.guaritaEmAcao.set(d.id);
    this.erroVincular.set(null);
    this.guaritaApi.vincular(d.id_device, d.id, op.id).subscribe({
      next: () => {
        this.guaritaEmAcao.set(null);
        this.vinculando.set(null);
        this.recarregarTudo();
      },
      error: (e) => {
        this.guaritaEmAcao.set(null);
        this.erroVincular.set(mensagemDaApi(e, 'Não foi possível vincular o dispositivo.'));
      },
    });
  }

  /** Estado no Guarita da tag (colunas da própria tag; a lista de tags já vem inteira). */
  private estadoGuaritaDaTag(t: Tag | null | undefined): { estado: string; erro: string | null } | null {
    if (!this.temGuarita() || !t) return null;
    const g = t as Tag & CamposGuaritaDaTag;
    return g.guarita_estado ? { estado: g.guarita_estado, erro: g.guarita_erro ?? null } : null;
  }

  /** Estado do veículo no Guarita: o da tag dele. */
  private estadoGuaritaDoVeiculo(v: VeiculoComMorador): { estado: string; erro: string | null } | null {
    if (!v.id_tag) return null;
    return this.estadoGuaritaDaTag(this.tagDoVeiculo(v));
  }

  /**
   * A tag está (ou vai estar) gravada no Guarita: bloquear nela é apagar do
   * Guarita, sem volta pela tela. `aguardando_aprovacao`/`recusada` ainda não
   * estão no Guarita e seguem como tag comum.
   */
  tagNoGuarita(t: Tag): boolean {
    const e = this.estadoGuaritaDaTag(t)?.estado;
    return !!e && ['pendente', 'gravado', 'ativo', 'falhou', 'a_vincular', 'removendo', 'incerto'].includes(e);
  }

  seloGuaritaDaTag(t: Tag): { texto: string; dot: string; dica?: string } | null {
    const e = this.estadoGuaritaDaTag(t);
    return e ? rotuloEstadoGuarita(e.estado, e.erro) : null;
  }

  /** Conflito ou "não está mais no Guarita": só desfazer o vínculo (e regravar, no ausente). */
  tagConflitoOuAusente(t: Tag): boolean {
    const e = this.estadoGuaritaDaTag(t)?.estado;
    return e === 'conflito' || e === 'ausente';
  }

  /** A remoção no Guarita desistiu: o dispositivo ainda pode abrir o portão. */
  tagRemocaoFalhou(t: Tag): boolean {
    return this.estadoGuaritaDaTag(t)?.estado === 'remocao_falhou';
  }

  tagRemovendo(t: Tag): boolean {
    return this.estadoGuaritaDaTag(t)?.estado === 'removendo';
  }

  /** "Remover do Guarita": a API apaga o dispositivo do Guarita (o mesmo pedido do bloquear). */
  async removerDoGuarita(t: Tag) {
    if (this.tagEmAcao() !== null) return;
    const ok = await this.confirm.ask({
      title: 'Remover do Guarita',
      message: `O dispositivo ${t.codigo} será apagado do Guarita e deixa de abrir o portão. Para voltar, cadastre de novo pela captura.`,
      confirmLabel: 'Remover do Guarita',
      variant: 'danger',
    });
    if (!ok || this.tagEmAcao() !== null) return;
    this.tagEmAcao.set(t.id);
    this.erroAcaoTag.set(null);
    this.api.setTagAtivo(t.id, false).subscribe({
      next: (atualizada) => {
        this.tagEmAcao.set(null);
        // Pedimos a remoção: até o próximo recarregar, a tela diz "Removendo".
        const estado = 'removendo';
        this.tags.update((lista) =>
          lista.map((x) => (x.id === t.id ? { ...x, ...atualizada, guarita_estado: estado } as Tag : x)),
        );
      },
      error: (e) => {
        this.tagEmAcao.set(null);
        this.erroAcaoTag.set(mensagemDaApi(e, 'Falha ao remover do Guarita.'));
      },
    });
  }

  seloGuarita(v: VeiculoComMorador): { texto: string; dot: string; dica?: string } | null {
    const e = this.estadoGuaritaDoVeiculo(v);
    return e ? rotuloEstadoGuarita(e.estado, e.erro) : null;
  }

  aguardandoAprovacao(v: VeiculoComMorador): boolean {
    return this.estadoGuaritaDoVeiculo(v)?.estado === 'aguardando_aprovacao';
  }

  /** De qual Guarita é a tag: da coluna da tag ou o único do condomínio. */
  private guaritaDaTag(idTag: number): number | null {
    const t = this.tags().find((x) => x.id === idTag) as (Tag & CamposGuaritaDaTag) | undefined;
    if (t?.id_device) return t.id_device;
    const lista = this.guaritas();
    return lista.length === 1 ? lista[0].id : null;
  }

  // ---- Aprovar: confirmar tipo e código impresso antes de gravar no Guarita ----

  /** Tag em aprovação (gaveta aberta). */
  readonly aprovacao = signal<{ v: VeiculoComMorador; idTag: number; deviceId: number } | null>(null);
  /** 1 = controle remoto (só por captura); 2 TA, 3 CT, 6 TP. null = ainda não escolhido. */
  aprovTipo: 1 | 2 | 3 | 6 | null = null;
  aprovCodigo = '';
  readonly erroAprovacao = signal<string | null>(null);
  readonly enviandoAprovacao = signal(false);
  readonly tiposAprovacao: { valor: 1 | 2 | 3 | 6; rotulo: string }[] = [
    { valor: 2, rotulo: 'TAG ativo' },
    { valor: 6, rotulo: 'TAG passivo' },
    { valor: 3, rotulo: 'Cartão' },
    { valor: 1, rotulo: 'Controle remoto' },
  ];

  /** Abre o passo de confirmação, com o código que o morador digitou no app. */
  aprovarTag(v: VeiculoComMorador) {
    const idTag = v.id_tag;
    if (!idTag || this.guaritaEmAcao() !== null) return;
    const deviceId = this.guaritaDaTag(idTag);
    if (deviceId == null) {
      this.erroGuarita.set('Não foi possível saber de qual Guarita é esta tag.');
      return;
    }
    const tag = this.tagDoVeiculo(v) as (Tag & CamposGuaritaDaTag) | null;
    const codigo = tag?.codigo ?? '';
    // "G2-0F086E" é o código interno de uma tag de Guarita, não o impresso.
    this.aprovCodigo = /^G\d-/i.test(codigo) ? '' : codigo;
    const tipo = Number(tag?.guarita_tipo);
    this.aprovTipo = tipo === 2 || tipo === 3 || tipo === 6 ? tipo : null;
    this.erroAprovacao.set(null);
    this.erroGuarita.set(null);
    this.aprovacao.set({ v, idTag, deviceId });
  }

  fecharAprovacao() {
    this.aprovacao.set(null);
  }

  confirmarAprovacao() {
    const a = this.aprovacao();
    if (!a || this.enviandoAprovacao()) return;
    const tipo = this.aprovTipo == null ? null : Number(this.aprovTipo);
    if (tipo == null) {
      this.erroAprovacao.set('Escolha o tipo do dispositivo.');
      return;
    }
    if (tipo === 1) return; // controle remoto: só por captura (botão próprio)
    const codigo = this.aprovCodigo.trim();
    if (!codigoImpressoValido(codigo)) {
      this.erroAprovacao.set(MSG_CODIGO_IMPRESSO_INVALIDO);
      return;
    }
    this.enviandoAprovacao.set(true);
    this.erroAprovacao.set(null);
    this.guaritaApi.aprovar(a.deviceId, a.idTag, { tipo: tipo as 2 | 3 | 6, codigo_impresso: codigo }).subscribe({
      next: () => {
        this.enviandoAprovacao.set(false);
        this.aprovacao.set(null);
        this.recarregarTudo();
      },
      error: (e) => {
        this.enviandoAprovacao.set(false);
        this.erroAprovacao.set(mensagemDaApi(e, 'Não foi possível aprovar a tag.'));
      },
    });
  }

  /** Controle remoto não entra digitado: fecha a aprovação e abre a captura do veículo. */
  capturarAgora() {
    const a = this.aprovacao();
    if (!a) return;
    this.aprovacao.set(null);
    this.abrirCapturaGuarita(a.v);
  }

  async recusarTag(v: VeiculoComMorador) {
    const idTag = v.id_tag;
    if (!idTag || this.guaritaEmAcao() !== null) return;
    const deviceId = this.guaritaDaTag(idTag);
    if (deviceId == null) {
      this.erroGuarita.set('Não foi possível saber de qual Guarita é esta tag.');
      return;
    }
    const ok = await this.confirm.ask({
      title: 'Recusar tag',
      message: 'A tag não será gravada no Guarita. O morador verá que foi recusada pela portaria.',
      confirmLabel: 'Recusar',
      variant: 'danger',
    });
    if (!ok || this.guaritaEmAcao() !== null) return;
    this.executarNoGuarita(idTag, this.guaritaApi.recusar(deviceId, idTag), 'Não foi possível recusar a tag.');
  }

  private executarNoGuarita(idTag: number, req: Observable<unknown>, padrao: string, seRotaAusente?: () => void) {
    this.guaritaEmAcao.set(idTag);
    this.erroGuarita.set(null);
    req.subscribe({
      next: () => {
        this.guaritaEmAcao.set(null);
        this.recarregarTudo();
      },
      error: (e) => {
        this.guaritaEmAcao.set(null);
        if (e?.status === 404 && seRotaAusente) {
          seRotaAusente();
          return;
        }
        this.erroGuarita.set(mensagemDaApi(e, padrao));
      },
    });
  }

  // ---- Conflito / ausente: desfazer o vínculo ou regravar ----

  /** API sem a rota (404): o botão some. */
  readonly semRotaDesfazer = signal(false);
  readonly semRotaRegravar = signal(false);

  estadoGuaritaDaTagId(idTag: number | null | undefined): string | null {
    if (!idTag) return null;
    return this.estadoGuaritaDaTag(this.tags().find((t) => t.id === idTag))?.estado ?? null;
  }

  podeDesfazer(idTag: number | null | undefined): boolean {
    const e = this.estadoGuaritaDaTagId(idTag);
    return (e === 'conflito' || e === 'ausente') && !this.semRotaDesfazer();
  }

  podeRegravar(idTag: number | null | undefined): boolean {
    return this.estadoGuaritaDaTagId(idTag) === 'ausente' && !this.semRotaRegravar();
  }

  async desfazerVinculo(idTag: number | null | undefined) {
    if (!idTag || this.guaritaEmAcao() !== null) return;
    const deviceId = this.guaritaDaTag(idTag);
    if (deviceId == null) {
      this.erroGuarita.set('Não foi possível saber de qual Guarita é esta tag.');
      return;
    }
    const ok = await this.confirm.ask({
      title: 'Desfazer vínculo',
      message: 'A tag sai do Prestare. Nada é alterado no Guarita.',
      confirmLabel: 'Desfazer vínculo',
      variant: 'danger',
    });
    if (!ok || this.guaritaEmAcao() !== null) return;
    this.executarNoGuarita(idTag, this.guaritaApi.desfazer(deviceId, idTag), 'Não foi possível desfazer o vínculo.', () =>
      this.semRotaDesfazer.set(true),
    );
  }

  readonly semRotaRemoverDeNovo = signal(false);

  podeRemoverDeNovo(idTag: number | null | undefined): boolean {
    return this.estadoGuaritaDaTagId(idTag) === 'remocao_falhou' && !this.semRotaRemoverDeNovo();
  }

  removerDeNovo(idTag: number | null | undefined) {
    if (!idTag || this.guaritaEmAcao() !== null) return;
    const deviceId = this.guaritaDaTag(idTag);
    if (deviceId == null) {
      this.erroGuarita.set('Não foi possível saber de qual Guarita é esta tag.');
      return;
    }
    this.executarNoGuarita(idTag, this.guaritaApi.removerDeNovo(deviceId, idTag), 'Não foi possível pedir a remoção de novo.', () =>
      this.semRotaRemoverDeNovo.set(true),
    );
  }

  regravarNoGuarita(idTag: number | null | undefined) {
    if (!idTag || this.guaritaEmAcao() !== null) return;
    const deviceId = this.guaritaDaTag(idTag);
    if (deviceId == null) {
      this.erroGuarita.set('Não foi possível saber de qual Guarita é esta tag.');
      return;
    }
    this.executarNoGuarita(idTag, this.guaritaApi.regravar(deviceId, idTag), 'Não foi possível regravar no Guarita.', () =>
      this.semRotaRegravar.set(true),
    );
  }

  abrirCapturaGuarita(v: VeiculoComMorador) {
    this.erroGuarita.set(null);
    this.capturaVeiculo.set(v);
  }

  fecharCapturaGuarita() {
    this.capturaVeiculo.set(null);
  }

  onGuaritaCadastrado() {
    this.capturaVeiculo.set(null);
    this.recarregarTudo();
  }

  /** "Unidade 101 · Bloco A" do item a vincular (o que o Guarita tem gravado). */
  unidadeDoDispositivo(d: GuaritaDispositivo): string {
    const partes: string[] = [];
    if (d.unidade != null && d.unidade !== '') partes.push(`Unidade ${d.unidade}`);
    if (d.bloco) partes.push(`Bloco ${d.bloco}`);
    return partes.join(' · ') || 'Sem unidade';
  }
}
