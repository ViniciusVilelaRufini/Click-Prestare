import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Assembleia, AssembleiasApi, Votacao } from './assembleias.service';
import { ConfirmService } from '../shared/confirm.service';
import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';
import { AuthService } from '../auth/auth.service';
import { papelDoToken } from '../auth/papel';
import { ServerClockService } from '../core/server-clock.service';

/** Mensagem do servidor quando houver; senão a do cliente; senão a padrão. */
function msgErro(e: any, padrao: string): string {
  const m = e?.error?.message ?? e?.message;
  return (Array.isArray(m) ? m.join(' ') : m) || padrao;
}

/** "DD/MM/AAAA" → AAAAMMDD (0 se vazio ou fora do padrão). */
function diaDe(data: string | undefined): number {
  const m = String(data ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
}

/** Dia de `d` como AAAA-MM-DD (valor do input date). */
function diaIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-assembleias-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SlideIndicatorDirective],
  templateUrl: './assembleias-page.component.html',
})
export class AssembleiasPageComponent implements OnInit {
  private api = inject(AssembleiasApi);
  private confirm = inject(ConfirmService);
  private auth = inject(AuthService);
  /** Hora do servidor: o PC da portaria costuma estar com o relógio errado. */
  private relogio = inject(ServerClockService);

  /** Hoje (relógio do servidor) como AAAA-MM-DD. */
  private hojeIso(): string {
    return diaIso(this.relogio.agora());
  }

  /**
   * Agendar, criar pauta/enquete, excluir, encerrar e finalizar são do síndico
   * e do funcionário do app: a API recusa o porteiro de login/senha
   * (assertStaff). Mesmo critério de comunicados — papel do token; a API
   * segue decidindo.
   */
  readonly podeGerir = computed(() => {
    this.auth.porteiroInfo(); // recalcula ao entrar / trocar de condomínio
    const papel = papelDoToken(this.auth.token);
    return papel === 'sindico' || papel === 'funcionario';
  });

  /** Erro da página (lista, painel, excluir, encerrar). */
  readonly erro = signal<string | null>(null);
  /** Erro dentro do drawer de agendar. */
  readonly erroAssembleia = signal<string | null>(null);

  // Finalizar: a ATA em PDF é obrigatória (a API recusa sem ela).
  readonly modalFinalizar = signal(false);
  readonly finalizando = signal(false);
  readonly erroAta = signal<string | null>(null);
  readonly ataNomeArquivo = signal('');
  ataBase64 = '';
  private assembleiaAFinalizar: Assembleia | null = null;

  readonly assembleias = signal<Assembleia[]>([]);

  /** Data de hoje ou futura (ou sem data), na ordem da API (data crescente). */
  readonly assembleiasProximas = computed(() => this.assembleias().filter((a) => !this.ehPassada(a)));
  /** Data já passou (e ninguém finalizou): da mais recente para a mais antiga. */
  readonly assembleiasRealizadas = computed(() =>
    this.assembleias()
      .filter((a) => this.ehPassada(a))
      .sort((x, y) => diaDe(y.data) - diaDe(x.data)),
  );
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
    this.erro.set(null);
    this.api.listAssembleias().subscribe({
      next: (assemb) => {
        this.assembleias.set(assemb);
        this.api.listEnquetes().subscribe({
          next: (enq) => {
            this.enquetes.set(enq);
            this.loading.set(false);
          },
          error: (e) => {
            this.loading.set(false);
            this.erro.set(msgErro(e, 'Falha ao carregar as enquetes.'));
          },
        });
      },
      error: (e) => {
        this.loading.set(false);
        this.erro.set(msgErro(e, 'Falha ao carregar as assembleias.'));
      },
    });
  }

  verAssembleia(id: number) {
    this.loading.set(true);
    this.erro.set(null);
    this.api.getAssembleia(id).subscribe({
      next: (data) => {
        this.selectedAssembleia.set(data);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.erro.set(msgErro(e, 'Falha ao abrir a assembleia.'));
      },
    });
  }

  voltarLista() {
    this.selectedAssembleia.set(null);
    this.carregarGeral();
  }

  /** "Finalizar e Gerar ATA": pede o PDF da ATA antes de chamar a API. */
  abrirFinalizar(assemb: Assembleia) {
    this.assembleiaAFinalizar = assemb;
    this.ataBase64 = '';
    this.ataNomeArquivo.set('');
    this.erroAta.set(null);
    this.modalFinalizar.set(true);
  }

  fecharFinalizar() {
    if (this.finalizando()) return;
    this.modalFinalizar.set(false);
  }

  onAtaSelecionada(event: any) {
    const file: File | undefined = event.target.files?.[0];
    this.ataBase64 = '';
    this.ataNomeArquivo.set('');
    this.erroAta.set(null);
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      this.erroAta.set('Escolha um arquivo PDF.');
      return;
    }
    this.ataNomeArquivo.set(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      // Sem o tipo no arquivo, o navegador devolve "data:application/octet-stream".
      this.ataBase64 = String(reader.result ?? '').replace(/^data:[^;,]*/, 'data:application/pdf');
    };
    reader.onerror = () => this.erroAta.set('Não foi possível ler o arquivo.');
    reader.readAsDataURL(file);
  }

  confirmarFinalizacao() {
    const assemb = this.assembleiaAFinalizar;
    if (!assemb || !this.ataBase64 || this.finalizando()) return;
    this.finalizando.set(true);
    this.erroAta.set(null);
    this.api.finishAssembleia({ ...assemb, doc: this.ataBase64 }).subscribe({
      next: (res) => {
        this.finalizando.set(false);
        this.modalFinalizar.set(false);
        alert(res?.message || 'Assembleia finalizada com sucesso!');
        this.voltarLista();
      },
      error: (e) => {
        this.finalizando.set(false);
        this.erroAta.set(msgErro(e, 'Não foi possível finalizar a assembleia.'));
      },
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
    this.erro.set(null);
    this.api.removeAssembleia(id).subscribe({
      next: () => this.assembleias.update(l => l.filter(a => a.id !== id)),
      error: (e) => this.erro.set(msgErro(e, 'Não foi possível excluir a assembleia.')),
    });
  }

  // Ações de Votação/Enquete
  /** A data da assembleia já passou (hoje ainda conta como próxima). */
  ehPassada(a: Assembleia): boolean {
    const dia = diaDe(a.data);
    return dia > 0 && dia < Number(this.hojeIso().replace(/-/g, ''));
  }

  abrirModalAssembleia() {
    // Campo de data (AAAA-MM-DD): a API aceita esse formato e o DD/MM/AAAA.
    this.novaAssembleia = { titulo: '', descricao: '', data: this.hojeIso(), hora: '19:30', local: 'Salão Principal', link: '' };
    this.erroAssembleia.set(null);
    this.modalAssembleia.set(true);
  }

  salvarAssembleia() {
    this.erroAssembleia.set(null);
    this.api.insertAssembleia(this.novaAssembleia).subscribe({
      next: () => {
        this.modalAssembleia.set(false);
        this.carregarGeral();
      },
      error: (e) => this.erroAssembleia.set(msgErro(e, 'Não foi possível agendar. Confira os dados e tente novamente.')),
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
      error: (e) => this.erroModal.set(msgErro(e, 'Não foi possível salvar. Confira os dados e tente novamente.')),
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
    this.erro.set(null);
    this.api.removeVotacao(id).subscribe({
      next: () => {
        if (idAssembleiaRefresh) {
          this.verAssembleia(idAssembleiaRefresh);
        } else {
          this.enquetes.update(l => l.filter(e => e.id !== id));
        }
      },
      error: (e) => this.erro.set(msgErro(e, 'Não foi possível excluir a votação.')),
    });
  }

  /** Enquete: recarrega a lista. Pauta (`idAssembleiaRefresh`): recarrega o painel da assembleia. */
  encerrarVotacao(id: number, idAssembleiaRefresh?: number) {
    this.erro.set(null);
    this.api.finishVotacao(id).subscribe({
      next: () => (idAssembleiaRefresh ? this.verAssembleia(idAssembleiaRefresh) : this.carregarGeral()),
      error: (e) =>
        this.erro.set(msgErro(e, idAssembleiaRefresh ? 'Não foi possível encerrar a votação.' : 'Não foi possível encerrar a enquete.')),
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
