import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { catchError, forkJoin, of } from 'rxjs';
import { ConfirmService } from '../shared/confirm.service';
import {
  AVISO_GUARITA_NAO_VALIDADA,
  GUARITA_VALIDADA_EM_APARELHO,
  GuaritaAlerta,
  GuaritaDevice,
  GuaritaPortao,
  GuaritaService,
  alertaEhPanico,
  alertaEhRemocaoPendente,
  mensagemDaApiGuarita,
} from './guarita.service';

interface PortaoDaPortaria {
  device: GuaritaDevice;
  portao: GuaritaPortao;
}

/**
 * Bloco da portaria para o Módulo Guarita: botões de abrir portão (relé) e
 * alertas pendentes (pânico em destaque). Sem Guarita no condomínio não
 * desenha nada e não faz nenhuma chamada além da lista de aparelhos.
 *
 * Os alertas NÃO têm consulta própria: o painel chama `atualizarAlertas()`
 * na consulta periódica que ele já faz.
 */
@Component({
  selector: 'app-guarita-portaria',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './guarita-portaria.component.html',
  // Sem Guarita o elemento fica oculto: não cria caixa nem mexe no espaçamento do painel.
  host: { '[style.display]': "temGuarita() ? 'block' : 'none'" },
})
export class GuaritaPortariaComponent implements OnInit, OnDestroy {
  private api = inject(GuaritaService);
  private confirm = inject(ConfirmService);

  readonly validadaEmAparelho = GUARITA_VALIDADA_EM_APARELHO;
  readonly avisoNaoValidada = AVISO_GUARITA_NAO_VALIDADA;

  readonly guaritas = signal<GuaritaDevice[]>([]);
  readonly temGuarita = computed(() => this.guaritas().length > 0);
  /** Só os portões com relé: são os que o Prestare sabe abrir. */
  readonly portoes = signal<PortaoDaPortaria[]>([]);
  readonly alertas = signal<GuaritaAlerta[]>([]);
  readonly panicos = computed(() => this.alertas().filter((a) => alertaEhPanico(a)));
  /** Logo abaixo do pânico: dispositivo de ex-morador que ainda abre o portão. */
  readonly remocoesPendentes = computed(() =>
    this.alertas().filter((a) => !alertaEhPanico(a) && alertaEhRemocaoPendente(a)),
  );
  readonly outrosAlertas = computed(() =>
    this.alertas().filter((a) => !alertaEhPanico(a) && !alertaEhRemocaoPendente(a)),
  );

  /** Portão com abertura em andamento (chave `device-portao`). Um clique = uma chamada. */
  readonly abrindo = signal<string | null>(null);
  readonly mensagem = signal<{ texto: string; erro: boolean } | null>(null);
  readonly alertaEmAcao = signal<number | null>(null);
  /** A API recusou a abertura para esta sessão (403): os botões somem e fica a mensagem dela. */
  readonly semPermissaoAbrir = signal<string | null>(null);
  readonly erroAlerta = signal<string | null>(null);

  /** API sem a rota de alertas (404): para de perguntar. */
  private alertasIndisponiveis = false;
  private consultandoAlertas = false;
  private timerMensagem?: ReturnType<typeof setTimeout>;
  private destruido = false;

  ngOnInit(): void {
    this.api.listarGuaritas().subscribe((lista) => {
      if (this.destruido) return;
      this.guaritas.set(lista);
      if (!lista.length) return;
      this.carregarPortoes(lista);
      this.atualizarAlertas();
    });
  }

  ngOnDestroy(): void {
    this.destruido = true;
    if (this.timerMensagem) clearTimeout(this.timerMensagem);
  }

  private carregarPortoes(lista: GuaritaDevice[]) {
    forkJoin(
      lista.map((device) =>
        this.api.portoes(device.id).pipe(
          catchError(() => of([] as GuaritaPortao[])),
        ),
      ),
    ).subscribe((partes) => {
      if (this.destruido) return;
      const todos: PortaoDaPortaria[] = [];
      partes.forEach((ps, i) => {
        for (const portao of Array.isArray(ps) ? ps : []) {
          if (portao && portao.rele != null) todos.push({ device: lista[i], portao });
        }
      });
      this.portoes.set(todos);
    });
  }

  /** Chamado pelo painel a cada consulta periódica dele. Sem Guarita, não faz nada. */
  atualizarAlertas() {
    if (this.destruido || !this.temGuarita() || this.alertasIndisponiveis || this.consultandoAlertas) return;
    this.consultandoAlertas = true;
    this.api.alertas(true).subscribe({
      next: (lista) => {
        this.consultandoAlertas = false;
        if (this.destruido) return;
        this.alertas.set(lista.filter((a) => !a.visto_em));
      },
      error: (err) => {
        this.consultandoAlertas = false;
        if (err?.status === 404) this.alertasIndisponiveis = true;
      },
    });
  }

  chave(p: PortaoDaPortaria): string {
    return `${p.device.id}-${p.portao.id}`;
  }

  async abrir(p: PortaoDaPortaria) {
    if (this.abrindo() !== null || this.semPermissaoAbrir() !== null) return;
    const ok = await this.confirm.ask({
      title: 'Abrir portão',
      message: `Abrir "${p.portao.nome}" agora? O relé do Guarita "${p.device.nome}" será acionado.`,
      confirmLabel: 'Abrir',
      variant: 'primary',
    });
    // A confirmação é assíncrona: confere de novo para um segundo clique não gerar outra chamada.
    if (!ok || this.abrindo() !== null || this.destruido) return;
    this.abrindo.set(this.chave(p));
    this.mensagem.set(null);
    this.api.abrirPortao(p.device.id, p.portao.id).subscribe({
      next: (r) => {
        this.abrindo.set(null);
        if (r?.enviado === false) {
          this.avisar({ texto: `O comando para "${p.portao.nome}" não foi enviado.`, erro: true });
          return;
        }
        // O Guarita não responde ao acionamento: a tela diz só o que sabe.
        this.avisar({ texto: `Comando de abertura enviado para "${p.portao.nome}".`, erro: false });
      },
      error: (err) => {
        this.abrindo.set(null);
        if (err?.status === 403) {
          this.mensagem.set(null);
          this.semPermissaoAbrir.set(mensagemDaApiGuarita(err, 'Esta sessão não pode abrir portões.'));
          return;
        }
        this.avisar({ texto: mensagemDaApiGuarita(err, `Não foi possível abrir "${p.portao.nome}".`), erro: true });
      },
    });
  }

  private avisar(m: { texto: string; erro: boolean }) {
    if (this.destruido) return;
    this.mensagem.set(m);
    if (this.timerMensagem) clearTimeout(this.timerMensagem);
    this.timerMensagem = setTimeout(() => this.mensagem.set(null), m.erro ? 8000 : 5000);
  }

  marcarVisto(a: GuaritaAlerta) {
    if (this.alertaEmAcao() !== null) return;
    this.alertaEmAcao.set(a.id);
    this.erroAlerta.set(null);
    this.api.marcarAlertaVisto(a.id).subscribe({
      next: () => {
        this.alertaEmAcao.set(null);
        this.alertas.update((l) => l.filter((x) => x.id !== a.id));
      },
      error: (err) => {
        this.alertaEmAcao.set(null);
        this.erroAlerta.set(mensagemDaApiGuarita(err, 'Não foi possível marcar o alerta como visto.'));
      },
    });
  }

  nomeDoGuarita(idDevice: number): string {
    return this.guaritas().find((g) => g.id === idDevice)?.nome ?? 'Guarita';
  }
}
