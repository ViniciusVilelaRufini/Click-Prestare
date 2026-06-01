import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgendamentoArea, AreaSocial, AreasSociaisApi } from './areas-sociais.service';
import { ConfirmService } from '../shared/confirm.service';

@Component({
  selector: 'app-areas-sociais-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './areas-sociais-page.component.html',
})
export class AreasSociaisPageComponent implements OnInit {
  private api = inject(AreasSociaisApi);
  private confirm = inject(ConfirmService);

  readonly areas = signal<AreaSocial[]>([]);
  readonly agendamentos = signal<AgendamentoArea[]>([]);
  readonly loading = signal(true);
  readonly tab = signal<'areas' | 'reservas'>('areas');

  // Controle do Modal
  readonly modalAberto = signal(false);
  novaArea: any = { nome: '', capacidade: null, imagem: '', agendar: true, autorizacao: true };

  // Upload da foto do espaço
  readonly fotoPreview = signal<string | null>(null);
  readonly fotoNome = signal<string | null>(null);
  readonly fotoErro = signal<string | null>(null);
  readonly modoUrl = signal(false); // alterna entre upload de arquivo e colar URL
  readonly salvando = signal(false);

  readonly pendentesCount = computed(() =>
    this.agendamentos().filter(a => a.status === 'pendente').length
  );

  readonly aprovadasCount = computed(() =>
    this.agendamentos().filter(a => a.status === 'aprovado').length
  );

  ngOnInit() {
    this.carregarDados();
  }

  carregarDados() {
    this.loading.set(true);
    this.api.listAreas().subscribe(areas => {
      this.areas.set(areas);
      this.api.listAgendamentos().subscribe(ag => {
        this.agendamentos.set(ag);
        this.loading.set(false);
      });
    });
  }

  alterarStatus(id: number, isAccept: boolean) {
    this.api.updateStatus(id, isAccept).subscribe(() => {
      // Atualizar lista local na hora
      this.agendamentos.update(list =>
        list.map(item => item.id === id ? { ...item, status: isAccept ? 'aprovado' : 'recusado' } : item)
      );
    });
  }

  async excluirArea(id: number) {
    const ok = await this.confirm.ask({
      title: 'Excluir espaço',
      message: 'O espaço será removido junto com todas as reservas associadas.',
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.removeArea(id).subscribe(() => {
      this.areas.update(list => list.filter(a => a.id !== id));
    });
  }

  abrirModalArea() {
    this.novaArea = { nome: '', capacidade: null, imagem: '', agendar: true, autorizacao: true };
    this.fotoPreview.set(null);
    this.fotoNome.set(null);
    this.fotoErro.set(null);
    this.modoUrl.set(false);
    this.salvando.set(false);
    this.modalAberto.set(true);
  }

  fecharModal() {
    this.modalAberto.set(false);
  }

  /** Lê o arquivo escolhido, valida e gera o preview/base64 enviado ao backend. */
  onFotoSelecionada(event: Event) {
    this.fotoErro.set(null);
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.fotoErro.set('Selecione um arquivo de imagem (JPG, PNG, WEBP...).');
      input.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.fotoErro.set('Imagem maior que 5MB. Comprima e tente novamente.');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => this.fotoErro.set('Falha ao ler o arquivo.');
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      this.novaArea.imagem = dataUrl; // backend faz o upload e troca pela URL final
      this.fotoPreview.set(dataUrl);
      this.fotoNome.set(file.name);
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  removerFoto() {
    this.novaArea.imagem = '';
    this.fotoPreview.set(null);
    this.fotoNome.set(null);
    this.fotoErro.set(null);
  }

  alternarModoImagem() {
    this.modoUrl.update(v => !v);
    // ao trocar de modo, limpa o que estava preenchido para evitar confusão
    this.removerFoto();
  }

  salvarArea() {
    if (this.salvando()) return;
    this.salvando.set(true);

    const payload = {
      nome: this.novaArea.nome,
      capacidade: this.novaArea.capacidade,
      imagem: this.novaArea.imagem || 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600',
      agendar: this.novaArea.agendar ? 1 : 0,
      autorizacao: this.novaArea.autorizacao ? 1 : 0,
      horarios: Array.from({ length: 7 }).map(() => ({
        horarios: [{ horarioDe: '08:00', horarioAte: '22:00' }]
      }))
    };

    this.api.insertArea(payload).subscribe({
      next: () => {
        this.salvando.set(false);
        this.fecharModal();
        this.carregarDados();
      },
      error: (e) => {
        this.salvando.set(false);
        this.fotoErro.set(`Falha ao cadastrar: ${e?.error?.message ?? e?.message ?? 'erro'}`);
      },
    });
  }
}
