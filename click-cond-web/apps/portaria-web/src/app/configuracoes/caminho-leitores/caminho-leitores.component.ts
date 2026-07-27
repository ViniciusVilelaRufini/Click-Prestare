import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CaminhoAcesso,
  CaminhoLeitoresService,
  DispositivoResumo,
} from './caminho-leitores.service';

/** Etapa em edição. `id_leitor = 0` significa "ainda não escolhido". */
interface EtapaEdit {
  id_leitor: number;
  id_abertura: number | null;
}

/**
 * Caminho de Leitores — monta a sequência física de entrada.
 *
 * Existe porque, sem ela, qualquer leitor que identifica aciona TODAS as
 * aberturas do condomínio. Num prédio com antecâmara (portão da rua + portão
 * interno), a leitura da placa abriria os dois de uma vez.
 */
@Component({
  selector: 'app-caminho-leitores',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './caminho-leitores.component.html',
})
export class CaminhoLeitoresComponent implements OnInit {
  private readonly service = inject(CaminhoLeitoresService);

  readonly caminhos = signal<CaminhoAcesso[]>([]);
  readonly dispositivos = signal<DispositivoResumo[]>([]);
  readonly loading = signal(false);
  readonly salvando = signal(false);
  readonly erro = signal<string | null>(null);

  // Editor
  readonly editando = signal(false);
  readonly editandoId = signal<number | null>(null);
  nome = '';
  descricao = '';
  ativo = 1;
  readonly etapas = signal<EtapaEdit[]>([]);

  /** Aparelhos que IDENTIFICAM — podem ser leitor de uma etapa. */
  readonly leitores = computed(() =>
    this.dispositivos().filter((d) =>
      ['facial', 'lpr', 'tag_reader', 'qrcode_reader'].includes(d.tipo),
    ),
  );

  /** Aparelhos que ABREM passagem. */
  readonly aberturas = computed(() =>
    this.dispositivos().filter((d) => ['botoeira', 'catraca'].includes(d.tipo)),
  );

  ngOnInit() {
    this.carregar();
  }

  carregar() {
    this.loading.set(true);
    this.erro.set(null);
    this.service.list().subscribe({
      next: (lista) => {
        this.caminhos.set(lista ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.erro.set('Não foi possível carregar os caminhos.');
        this.loading.set(false);
      },
    });
    this.service.listDispositivos().subscribe({
      next: (ds) => this.dispositivos.set(ds ?? []),
      error: () => {
        // Engolir a falha aqui deixava o seletor vazio sem explicação — o
        // operador via "nenhum leitor cadastrado" mesmo tendo cadastrado.
        this.dispositivos.set([]);
        this.erro.set(
          'Não foi possível carregar os dispositivos. Recarregue a página.',
        );
      },
    });
  }

  rotuloTipo(tipo: string): string {
    switch (tipo) {
      case 'lpr': return 'Câmera LPR';
      case 'facial': return 'Terminal Facial';
      case 'tag_reader': return 'Leitor de Tag';
      case 'qrcode_reader': return 'Leitor de QR Code';
      case 'botoeira': return 'Botoeira';
      case 'catraca': return 'Catraca';
      default: return tipo;
    }
  }

  novo() {
    this.editandoId.set(null);
    this.nome = '';
    this.descricao = '';
    this.ativo = 1;
    // Duas etapas já criadas: é o formato mais comum (portão da rua + interno)
    // e deixa claro, de cara, que o caminho é uma sequência.
    this.etapas.set([
      { id_leitor: 0, id_abertura: null },
      { id_leitor: 0, id_abertura: null },
    ]);
    this.editando.set(true);
    this.erro.set(null);
  }

  editar(c: CaminhoAcesso) {
    this.editandoId.set(c.id);
    this.nome = c.nome;
    this.descricao = c.descricao ?? '';
    this.ativo = c.ativo;
    this.etapas.set(
      c.etapas.map((e) => ({
        id_leitor: e.id_leitor,
        id_abertura: e.id_abertura ?? null,
      })),
    );
    this.editando.set(true);
    this.erro.set(null);
  }

  cancelar() {
    this.editando.set(false);
    this.erro.set(null);
  }

  adicionarEtapa() {
    this.etapas.update((e) => [...e, { id_leitor: 0, id_abertura: null }]);
  }

  removerEtapa(i: number) {
    this.etapas.update((e) => e.filter((_, idx) => idx !== i));
  }

  moverEtapa(i: number, direcao: -1 | 1) {
    const destino = i + direcao;
    this.etapas.update((lista) => {
      if (destino < 0 || destino >= lista.length) return lista;
      const copia = [...lista];
      [copia[i], copia[destino]] = [copia[destino], copia[i]];
      return copia;
    });
  }

  setLeitor(i: number, id: number) {
    this.etapas.update((lista) =>
      lista.map((e, idx) => (idx === i ? { ...e, id_leitor: Number(id) } : e)),
    );
  }

  setAbertura(i: number, id: number | string) {
    const valor = Number(id);
    this.etapas.update((lista) =>
      lista.map((e, idx) =>
        idx === i ? { ...e, id_abertura: valor > 0 ? valor : null } : e,
      ),
    );
  }

  nomeDispositivo(id: number | null): string {
    if (!id) return '';
    return this.dispositivos().find((d) => d.id === id)?.nome ?? `#${id}`;
  }

  salvar() {
    this.erro.set(null);

    const etapas = this.etapas();
    if (!this.nome.trim()) {
      this.erro.set('Dê um nome ao caminho (ex: "Entrada de veículos").');
      return;
    }
    if (etapas.length === 0) {
      this.erro.set('Adicione ao menos uma etapa.');
      return;
    }
    if (etapas.some((e) => !e.id_leitor)) {
      this.erro.set('Toda etapa precisa de um leitor selecionado.');
      return;
    }
    // O backend também recusa, mas avisar aqui evita a ida ao servidor e diz
    // exatamente o que está ambíguo.
    const ids = etapas.map((e) => e.id_leitor);
    if (new Set(ids).size !== ids.length) {
      this.erro.set(
        'O mesmo leitor aparece em duas etapas. Cada leitor só pode estar em uma.',
      );
      return;
    }

    const dto = {
      nome: this.nome.trim(),
      descricao: this.descricao.trim() || null,
      ativo: this.ativo,
      etapas: etapas.map((e) => ({
        id_leitor: e.id_leitor,
        id_abertura: e.id_abertura,
      })),
    };

    this.salvando.set(true);
    const id = this.editandoId();
    const req = id ? this.service.update(id, dto) : this.service.create(dto);
    req.subscribe({
      next: () => {
        this.salvando.set(false);
        this.editando.set(false);
        this.carregar();
      },
      error: (err) => {
        this.salvando.set(false);
        this.erro.set(
          err?.error?.message ?? 'Não foi possível salvar o caminho.',
        );
      },
    });
  }

  remover(c: CaminhoAcesso) {
    if (!confirm(`Remover o caminho "${c.nome}"?`)) return;
    this.service.remove(c.id).subscribe({
      next: () => this.carregar(),
      error: () => this.erro.set('Não foi possível remover o caminho.'),
    });
  }
}
