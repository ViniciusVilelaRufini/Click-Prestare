import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VeiculosApi, Tag, VeiculoComMorador } from '../moradores/veiculos.service';
import { Morador, MoradoresApi } from '../moradores/moradores.service';
import { ConfirmService } from '../shared/confirm.service';
import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';
import { EnrollCaptureComponent } from '../shared/enroll-capture.component';
import { AuthService } from '../auth/auth.service';

/** Mensagem de erro da API (texto ou lista do class-validator), ou o padrão. */
function mensagemDaApi(e: any, padrao: string): string {
  const m = e?.error?.message;
  if (Array.isArray(m)) return m.join(' ');
  return (typeof m === 'string' && m) || padrao;
}

@Component({
  selector: 'app-veiculos-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SlideIndicatorDirective, EnrollCaptureComponent],
  templateUrl: './veiculos-page.component.html',
})
export class VeiculosPageComponent implements OnInit {
  private api = inject(VeiculosApi);
  private moradoresApi = inject(MoradoresApi);
  private confirm = inject(ConfirmService);
  private auth = inject(AuthService);

  /** Condomínio do operador — o leitor de captura é escolhido entre os dele. */
  idCondominioAtual = () => this.auth.porteiroInfo()?.id_condominio ?? null;

  readonly tab = signal<'veiculos' | 'tags'>('veiculos');
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
    this.api.remove(v.id).subscribe({ next: () => this.carregar() });
  }

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
    const ok = await this.confirm.ask({
      title: 'Excluir tag',
      message: v
        ? `A tag ${t.codigo} será excluída e o veículo de placa ${v.placa} ficará sem tag.`
        : `A tag ${t.codigo} será excluída.`,
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
}
