import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VeiculosApi, Tag, VeiculoComMorador } from '../moradores/veiculos.service';
import { Morador, MoradoresApi } from '../moradores/moradores.service';
import { ConfirmService } from '../shared/confirm.service';

@Component({
  selector: 'app-veiculos-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './veiculos-page.component.html',
})
export class VeiculosPageComponent implements OnInit {
  private api = inject(VeiculosApi);
  private moradoresApi = inject(MoradoresApi);
  private confirm = inject(ConfirmService);

  readonly tab = signal<'veiculos' | 'tags'>('veiculos');
  readonly loading = signal(true);
  readonly veiculos = signal<VeiculoComMorador[]>([]);
  readonly tags = signal<Tag[]>([]);
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
    this.api.listAll().subscribe({
      next: (data) => {
        this.veiculos.set(data);
        this.api.listTags().subscribe({
          next: (t) => { this.tags.set(t); this.loading.set(false); },
          error: () => this.loading.set(false),
        });
      },
      error: () => this.loading.set(false),
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
      next: (data) => { this.moradoresEncontrados.set(data); this.buscandoMoradores.set(false); },
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

    const dto = {
      placa,
      cor: this.novoVeiculo.cor.trim() || null,
      marca_modelo: this.novoVeiculo.marca_modelo.trim() || null,
      id_tag: this.novoVeiculo.id_tag || null,
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
      error: (e) => {
        this.salvandoVeiculo.set(false);
        this.erroVeiculo.set(e?.error?.message ?? e?.message ?? 'Falha ao salvar veículo.');
      },
    });
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
        this.erroTag.set(e?.error?.message ?? e?.message ?? 'Falha ao cadastrar tag.');
      },
    });
  }

  tagLabel(idTag: number | null): string {
    if (!idTag) return '—';
    const t = this.tags().find((x) => x.id === idTag);
    return t ? t.codigo : `#${idTag}`;
  }
}
