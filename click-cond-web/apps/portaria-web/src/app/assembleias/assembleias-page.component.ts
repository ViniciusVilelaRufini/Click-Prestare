import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Assembleia, AssembleiasApi, Votacao } from './assembleias.service';
import { ConfirmService } from '../shared/confirm.service';

@Component({
  selector: 'app-assembleias-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './assembleias-page.component.html',
})
export class AssembleiasPageComponent implements OnInit {
  private api = inject(AssembleiasApi);
  private confirm = inject(ConfirmService);

  readonly assembleias = signal<Assembleia[]>([]);
  readonly enquetes = signal<Votacao[]>([]);
  readonly loading = signal(true);
  readonly tab = signal<'assembleias' | 'enquetes'>('assembleias');

  // Controle de Visualização
  readonly selectedAssembleia = signal<{ assembleia: Assembleia; votacoes: Votacao[]; meusVotos: string[] } | null>(null);

  // Modais
  readonly modalAssembleia = signal(false);
  readonly modalEnquete = signal(false);
  /** Erro do backend no modal de votação/enquete — antes o modal só ficava aberto, mudo. */
  readonly erroModal = signal<string | null>(null);

  novaAssembleia: any = { titulo: '', descricao: '', data: '', hora: '', local: '', link: '' };
  novaVotacao: any = { titulo: '', descricao: '', data_inicio: '', data_termino: '', is_enquete: false, id_assembleia: null, opcoes: ['Sim', 'Não'] };

  ngOnInit() {
    this.carregarGeral();
  }

  carregarGeral() {
    this.loading.set(true);
    this.api.listAssembleias().subscribe(assemb => {
      this.assembleias.set(assemb);
      this.api.listEnquetes().subscribe(enq => {
        this.enquetes.set(enq);
        this.loading.set(false);
      });
    });
  }

  verAssembleia(id: number) {
    this.loading.set(true);
    this.api.getAssembleia(id).subscribe(data => {
      this.selectedAssembleia.set(data);
      this.loading.set(false);
    });
  }

  voltarLista() {
    this.selectedAssembleia.set(null);
    this.carregarGeral();
  }

  async finalizarAssembleia(assemb: Assembleia) {
    const ok = await this.confirm.ask({
      title: 'Encerrar assembleia',
      message: 'A assembleia será encerrada e a ATA oficial gerada automaticamente na seção de Documentos. Continuar?',
      confirmLabel: 'Encerrar e gerar ATA',
      variant: 'primary',
    });
    if (!ok) return;
    this.api.finishAssembleia(assemb).subscribe(res => {
      alert(res?.message || 'Assembleia finalizada com sucesso!');
      this.voltarLista();
    });
  }

  async excluirAssembleia(id: number) {
    const ok = await this.confirm.ask({
      title: 'Cancelar assembleia',
      message: 'Esta assembleia será removida permanentemente.',
      confirmLabel: 'Cancelar assembleia',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.removeAssembleia(id).subscribe(() => {
      this.assembleias.update(l => l.filter(a => a.id !== id));
    });
  }

  // Ações de Votação/Enquete
  abrirModalAssembleia() {
    const hoje = new Date();
    const dataStr = hoje.toLocaleDateString('pt-BR');
    this.novaAssembleia = { titulo: '', descricao: '', data: dataStr, hora: '19:30', local: 'Salão Principal', link: '' };
    this.modalAssembleia.set(true);
  }

  salvarAssembleia() {
    this.api.insertAssembleia(this.novaAssembleia).subscribe(() => {
      this.modalAssembleia.set(false);
      this.carregarGeral();
    });
  }

  abrirModalEnquete() {
    const hoje = new Date();
    const dIni = hoje.toLocaleDateString('pt-BR');
    hoje.setDate(hoje.getDate() + 7);
    const dFim = hoje.toLocaleDateString('pt-BR');

    this.novaVotacao = {
      titulo: '', descricao: '', data_inicio: dIni, data_termino: dFim,
      is_enquete: true, id_assembleia: null, opcoes: ['Sim, concordo', 'Não concordo']
    };
    this.erroModal.set(null);
    this.modalEnquete.set(true);
  }

  abrirModalPauta(idAssembleia: number) {
    const hoje = new Date();
    const dIni = hoje.toLocaleDateString('pt-BR');
    hoje.setDate(hoje.getDate() + 3);
    const dFim = hoje.toLocaleDateString('pt-BR');

    this.novaVotacao = {
      titulo: '', descricao: '', data_inicio: dIni, data_termino: dFim,
      is_enquete: false, id_assembleia: idAssembleia, opcoes: ['Aprovar', 'Rejeitar', 'Abster']
    };
    this.erroModal.set(null);
    this.modalEnquete.set(true);
  }

  salvarVotacao() {
    // Filtra opções vazias
    const filtradas = this.novaVotacao.opcoes.filter((o: string) => o.trim() !== '');
    const payload = { ...this.novaVotacao, opcoes: filtradas };

    this.erroModal.set(null);
    this.api.insertVotacao(payload).subscribe({
      next: () => {
        this.modalEnquete.set(false);
        if (this.novaVotacao.id_assembleia) {
          this.verAssembleia(this.novaVotacao.id_assembleia);
        } else {
          this.carregarGeral();
        }
      },
      error: (e) => this.erroModal.set(e?.error?.message ?? 'Não foi possível salvar. Confira os dados e tente novamente.'),
    });
  }

  async removerVotacao(id: number, idAssembleiaRefresh?: number) {
    const ok = await this.confirm.ask({
      title: 'Excluir apuração',
      message: 'A votação e seus votos serão removidos.',
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.removeVotacao(id).subscribe(() => {
      if (idAssembleiaRefresh) {
        this.verAssembleia(idAssembleiaRefresh);
      } else {
        this.enquetes.update(l => l.filter(e => e.id !== id));
      }
    });
  }

  encerrarVotacao(id: number) {
    this.api.finishVotacao(id).subscribe(() => {
      this.carregarGeral();
    });
  }

  // Parse de strings do formato "id;nome;votos"
  parseOpcoes(opcoesStrArray: string[]) {
    if (!Array.isArray(opcoesStrArray)) return [];
    return opcoesStrArray.map(str => {
      const p = str.split(';');
      return { id: p[0], nome: p[1] || 'Opção', votos: Number(p[2] || 0) };
    });
  }

  getTotalVotos(opcoesStrArray: string[]) {
    return this.parseOpcoes(opcoesStrArray).reduce((acc, curr) => acc + curr.votos, 0);
  }

  calcPerc(votos: number, total: number) {
    if (total === 0) return 0;
    return Math.round((votos / total) * 100);
  }
}
