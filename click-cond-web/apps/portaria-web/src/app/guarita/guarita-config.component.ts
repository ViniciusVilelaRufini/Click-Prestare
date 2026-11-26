import { Component, Input, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../shared/confirm.service';
import {
  AVISO_GUARITA_NAO_VALIDADA,
  GUARITA_VALIDADA_EM_APARELHO,
  GuaritaBackup,
  GuaritaDevice,
  GuaritaEstado,
  GuaritaOperacao,
  GuaritaPortao,
  GuaritaPortaoDto,
  GuaritaService,
  LIMITE_DELTA_RELOGIO_S,
  ROTULO_TIPO_GUARITA,
  SIGLA_TIPO_GUARITA,
  mensagemDaApiGuarita,
} from './guarita.service';

export type ConexaoGuarita = 'conectado' | 'negado' | 'sem_resposta' | 'aguardando' | 'agente_offline';

/**
 * Situação da ligação com o Guarita a partir do estado que o agente reportou.
 * "Negado" só quando o Guarita recusou a palavra de autorização (ou a API diz
 * que a sessão está aberta mas não autorizada); qualquer outra falta de
 * resposta é "sem resposta" — a tela não adivinha a causa.
 */
export function conexaoDoGuarita(e: GuaritaEstado | null | undefined): ConexaoGuarita | null {
  if (!e) return null;
  // Sem agente não há como saber do Guarita: diz onde está o problema.
  if (e.agente_online === false) return 'agente_offline';
  const recusou = /recusad|negad/i.test(e.erro ?? '');
  if (e.autorizado === false && (e.conectado === true || recusou)) return 'negado';
  if (e.conectado === true) return 'conectado';
  if (e.conectado == null && !e.ultima_comunicacao) return 'aguardando';
  return 'sem_resposta';
}

export const ROTULO_CONEXAO: Record<ConexaoGuarita, string> = {
  conectado: 'Conectado',
  negado: 'Autorização negada',
  sem_resposta: 'Sem resposta',
  aguardando: 'Aguardando o agente',
  agente_offline: 'Agente desconectado',
};

/** Aviso da diferença de relógio; null quando dentro do limite ou desconhecida. */
export function avisoRelogioGuarita(deltaS: number | null | undefined): string | null {
  if (deltaS == null || !Number.isFinite(deltaS)) return null;
  const n = Math.round(Math.abs(deltaS));
  if (n <= LIMITE_DELTA_RELOGIO_S) return null;
  return `O relógio do Guarita difere ${n} s do computador da portaria. O Prestare corrige o horário dos eventos, mas acerte o relógio no próprio Guarita.`;
}

/** Ritmo do acompanhamento de uma importação/conferência. */
const ACOMPANHAR_OPERACAO_MS = 3_000;
/** 200 × 3 s = 10 min acompanhando; depois disso a tela para de perguntar. */
const MAX_CONSULTAS_OPERACAO = 200;
/** Reconsulta do estado do Guarita (mesmo ritmo da lista de aparelhos). */
const RECONSULTA_ESTADO_MS = 15_000;

type TipoOperacaoTela = 'importar' | 'conferir';

interface AndamentoOperacao {
  tipo: TipoOperacaoTela;
  /** Ainda acompanhando (botões travados). */
  emAndamento: boolean;
  texto: string;
  erro: boolean;
}

const NOME_OPERACAO: Record<TipoOperacaoTela, string> = { importar: 'importação', conferir: 'conferência' };

function textoDoAndamento(tipo: TipoOperacaoTela, op: GuaritaOperacao): { texto: string; erro: boolean; fim: boolean } {
  const nome = NOME_OPERACAO[tipo];
  const Nome = nome.charAt(0).toUpperCase() + nome.slice(1);
  switch (op.estado) {
    case 'pendente':
      return { texto: `${Nome} na fila: aguardando o agente pegar o pedido…`, erro: false, fim: false };
    case 'enviada':
      return { texto: `${Nome} em andamento: o agente está lendo o Guarita…`, erro: false, fim: false };
    case 'ok': {
      if (tipo === 'conferir' && op.resumo) {
        const r = op.resumo;
        return {
          texto: `Conferência concluída: ${r.so_no_guarita ?? 0} só no Guarita (foram para "A vincular"), ${r.so_no_prestare ?? 0} só no Prestare, ${r.divergente ?? 0} com dados diferentes.`,
          erro: false,
          fim: true,
        };
      }
      const ri = op.resumo as { total?: number; novos?: number; atualizados?: number; vinculados?: number } | null | undefined;
      if (tipo === 'importar' && ri && ri.total != null) {
        return {
          texto: `Importação concluída: ${ri.total} ${ri.total === 1 ? 'lido' : 'lidos'} do Guarita, ${ri.novos ?? 0} ${(ri.novos ?? 0) === 1 ? 'novo' : 'novos'}, ${ri.atualizados ?? 0} ${(ri.atualizados ?? 0) === 1 ? 'atualizado' : 'atualizados'}, ${ri.vinculados ?? 0} ${(ri.vinculados ?? 0) === 1 ? 'vinculado' : 'vinculados'} a veículo.`,
          erro: false,
          fim: true,
        };
      }
      return { texto: `${Nome} concluída.`, erro: false, fim: true };
    }
    case 'falhou':
      return { texto: `A ${nome} falhou${op.erro ? `: ${op.erro}` : '.'}`, erro: true, fim: true };
    case 'cancelada':
      return { texto: `A ${nome} foi cancelada.`, erro: true, fim: true };
    default:
      return { texto: `${Nome} enviada ao agente.`, erro: false, fim: false };
  }
}

/** Texto de um Blob (`blob.text()` onde houver; FileReader nos navegadores sem ele). */
function lerTextoDoBlob(b: Blob): Promise<string> {
  if (typeof (b as any).text === 'function') return (b as any).text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });
}

function portaoVazio(): GuaritaPortaoDto {
  return { nome: '', tipo_receptor: 1, num_receptor: 1, botao: null, rele: null, sentido: null };
}

/**
 * Painel de um Módulo Guarita em Configurações › Terminais: estado da
 * ligação, importar/conferir o cadastro, cópias de segurança e portões.
 * Só existe na tela quando há um aparelho do tipo `guarita`.
 */
@Component({
  selector: 'app-guarita-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './guarita-config.component.html',
})
export class GuaritaConfigComponent implements OnInit, OnDestroy {
  @Input({ required: true }) device!: GuaritaDevice;

  private api = inject(GuaritaService);
  private confirm = inject(ConfirmService);

  readonly validadaEmAparelho = GUARITA_VALIDADA_EM_APARELHO;
  readonly avisoNaoValidada = AVISO_GUARITA_NAO_VALIDADA;
  readonly rotuloTipo = ROTULO_TIPO_GUARITA;
  readonly siglaTipo = SIGLA_TIPO_GUARITA;
  readonly tiposReceptor = [1, 2, 3, 6];
  readonly receptoresCan = [1, 2, 3, 4, 5, 6, 7, 8];
  readonly botoesOuReles = [1, 2, 3, 4];

  // ---- Estado da ligação ----
  readonly estado = signal<GuaritaEstado | null>(null);
  /** A API ainda não tem a rota de estado (404): mostra texto neutro, sem erro vermelho. */
  readonly estadoIndisponivel = signal(false);
  readonly conexao = computed(() => conexaoDoGuarita(this.estado()));
  readonly rotuloConexao = computed(() => {
    const c = this.conexao();
    return c ? ROTULO_CONEXAO[c] : null;
  });
  readonly avisoRelogio = computed(() => avisoRelogioGuarita(this.estado()?.relogio_delta_s));

  // ---- Atualizar receptores (comando 29) de novo ----
  /** Some depois de um 404 (API sem a rota). */
  readonly podeRetentarReceptores = signal(true);
  readonly retentandoReceptores = signal(false);
  readonly msgReceptores = signal<{ texto: string; erro: boolean } | null>(null);

  // ---- Importar / conferir ----
  readonly andamento = signal<AndamentoOperacao | null>(null);
  readonly ocupado = computed(() => this.andamento()?.emAndamento === true);
  private timerOperacao?: ReturnType<typeof setTimeout>;

  // ---- Cópias de segurança ----
  readonly backups = signal<GuaritaBackup[]>([]);
  readonly erroBackups = signal<string | null>(null);
  readonly baixandoBackup = signal<number | null>(null);

  // ---- Portões ----
  readonly portoes = signal<GuaritaPortao[]>([]);
  readonly erroPortoes = signal<string | null>(null);
  readonly editandoPortao = signal<number | 'novo' | null>(null);
  readonly salvandoPortao = signal(false);
  readonly erroFormPortao = signal<string | null>(null);
  readonly portaoEmAcao = signal<number | null>(null);
  formPortao: GuaritaPortaoDto = portaoVazio();

  private intervaloEstado?: ReturnType<typeof setInterval>;
  private destruido = false;

  ngOnInit(): void {
    this.carregarEstado();
    this.carregarBackups();
    this.carregarPortoes();
    this.intervaloEstado = setInterval(() => this.carregarEstado(), RECONSULTA_ESTADO_MS);
  }

  ngOnDestroy(): void {
    this.destruido = true;
    if (this.intervaloEstado) clearInterval(this.intervaloEstado);
    if (this.timerOperacao) clearTimeout(this.timerOperacao);
  }

  carregarEstado() {
    this.api.estado(this.device.id).subscribe({
      next: (e) => {
        if (this.destruido) return;
        this.estadoIndisponivel.set(false);
        this.estado.set(e ?? {});
      },
      error: (err) => {
        if (this.destruido) return;
        if (err?.status === 404) this.estadoIndisponivel.set(true);
      },
    });
  }

  carregarBackups() {
    this.api.backups(this.device.id).subscribe({
      next: (l) => {
        if (this.destruido) return;
        this.erroBackups.set(null);
        this.backups.set(Array.isArray(l) ? l : []);
      },
      error: (err) => {
        if (this.destruido) return;
        this.backups.set([]);
        // Rota ausente (API antiga) = lista vazia, sem erro vermelho.
        this.erroBackups.set(err?.status === 404 ? null : mensagemDaApiGuarita(err, 'Não foi possível carregar as cópias de segurança.'));
      },
    });
  }

  carregarPortoes() {
    this.api.portoes(this.device.id).subscribe({
      next: (l) => {
        if (this.destruido) return;
        this.erroPortoes.set(null);
        this.portoes.set(Array.isArray(l) ? l : []);
      },
      error: (err) => {
        if (this.destruido) return;
        this.portoes.set([]);
        this.erroPortoes.set(err?.status === 404 ? null : mensagemDaApiGuarita(err, 'Não foi possível carregar os portões.'));
      },
    });
  }

  // ===================== Receptores =====================

  /** Pede ao agente o comando 29 de novo (receptores não atualizados). Um clique = uma chamada. */
  tentarReceptoresDeNovo() {
    if (this.retentandoReceptores() || !this.podeRetentarReceptores()) return;
    this.retentandoReceptores.set(true);
    this.msgReceptores.set(null);
    this.api.atualizarReceptores(this.device.id).subscribe({
      next: () => {
        if (this.destruido) return;
        this.retentandoReceptores.set(false);
        this.msgReceptores.set({ texto: 'Pedido enviado ao agente. O estado se atualiza quando o Guarita responder.', erro: false });
        this.carregarEstado();
      },
      error: (err) => {
        if (this.destruido) return;
        this.retentandoReceptores.set(false);
        if (err?.status === 404) {
          this.podeRetentarReceptores.set(false);
          return;
        }
        this.msgReceptores.set({ texto: mensagemDaApiGuarita(err, 'Não foi possível pedir a atualização dos receptores.'), erro: true });
      },
    });
  }

  // ===================== Importar / conferir =====================

  importar() {
    this.iniciarOperacao('importar');
  }

  conferir() {
    this.iniciarOperacao('conferir');
  }

  private iniciarOperacao(tipo: TipoOperacaoTela) {
    if (this.ocupado()) return;
    this.andamento.set({ tipo, emAndamento: true, texto: 'Enviando o pedido…', erro: false });
    const pedido = tipo === 'importar' ? this.api.importar(this.device.id) : this.api.conferir(this.device.id);
    pedido.subscribe({
      next: (op) => {
        if (this.destruido) return;
        this.aplicarOperacao(tipo, op, MAX_CONSULTAS_OPERACAO);
      },
      error: (err) => {
        if (this.destruido) return;
        this.andamento.set({
          tipo,
          emAndamento: false,
          texto: mensagemDaApiGuarita(err, `Não foi possível pedir a ${NOME_OPERACAO[tipo]}.`),
          erro: true,
        });
      },
    });
  }

  private aplicarOperacao(tipo: TipoOperacaoTela, op: GuaritaOperacao | null | undefined, restantes: number) {
    if (!op || typeof op.id !== 'number') {
      // A API aceitou mas não devolveu a operação: não há o que acompanhar.
      this.andamento.set({ tipo, emAndamento: false, texto: 'Pedido enviado ao agente. Acompanhe pelo estado e pela lista de cópias.', erro: false });
      return;
    }
    const t = textoDoAndamento(tipo, op);
    if (t.fim) {
      this.andamento.set({ tipo, emAndamento: false, texto: t.texto, erro: t.erro });
      this.carregarEstado();
      this.carregarBackups();
      return;
    }
    if (restantes <= 0) {
      this.andamento.set({
        tipo,
        emAndamento: false,
        texto: `A ${NOME_OPERACAO[tipo]} ainda não terminou. Ela continua no agente; confira o estado mais tarde.`,
        erro: false,
      });
      return;
    }
    this.andamento.set({ tipo, emAndamento: true, texto: t.texto, erro: false });
    this.timerOperacao = setTimeout(() => this.acompanhar(tipo, op.id, restantes - 1), ACOMPANHAR_OPERACAO_MS);
  }

  private acompanhar(tipo: TipoOperacaoTela, idOperacao: number, restantes: number) {
    if (this.destruido) return;
    this.api.operacao(this.device.id, idOperacao).subscribe({
      next: (op) => {
        if (this.destruido) return;
        this.aplicarOperacao(tipo, op, restantes);
      },
      error: (err) => {
        if (this.destruido) return;
        if (err?.status === 404) {
          this.andamento.set({
            tipo,
            emAndamento: false,
            texto: 'Pedido enviado ao agente. Acompanhe pelo estado e pela lista de cópias.',
            erro: false,
          });
          return;
        }
        // Falha passageira de rede: continua acompanhando, sem inventar resultado.
        if (restantes <= 0) {
          this.andamento.set({ tipo, emAndamento: false, texto: mensagemDaApiGuarita(err, 'Não foi possível acompanhar a operação.'), erro: true });
          return;
        }
        this.timerOperacao = setTimeout(() => this.acompanhar(tipo, idOperacao, restantes - 1), ACOMPANHAR_OPERACAO_MS);
      },
    });
  }

  // ===================== Cópias de segurança =====================

  baixar(b: GuaritaBackup) {
    if (this.baixandoBackup() !== null) return;
    this.baixandoBackup.set(b.id);
    this.erroBackups.set(null);
    this.api.baixarBackup(this.device.id, b.id).subscribe({
      next: (blob) => {
        this.baixandoBackup.set(null);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `guarita-${this.device.id}-copia-${b.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => {
        this.baixandoBackup.set(null);
        const padrao = 'Não foi possível baixar a cópia de segurança.';
        const corpo = err?.error;
        // Com responseType 'blob' o corpo do erro também é Blob: lê a mensagem dele.
        if (corpo instanceof Blob) {
          lerTextoDoBlob(corpo)
            .then((t) => {
              let msg = padrao;
              try {
                msg = mensagemDaApiGuarita({ error: JSON.parse(t) }, padrao);
              } catch {
                /* corpo que não é JSON: fica o texto padrão */
              }
              if (!this.destruido) this.erroBackups.set(msg);
            })
            .catch(() => !this.destruido && this.erroBackups.set(padrao));
          return;
        }
        this.erroBackups.set(mensagemDaApiGuarita(err, padrao));
      },
    });
  }

  /** Motivos que a API grava em `Guarita_Backups.motivo`; outro = rótulo genérico. */
  rotuloMotivo(m: string): string {
    return (
      ({ importacao: 'Importação', conferencia: 'Conferência', remocao: 'Remoção de dispositivo' } as Record<string, string>)[m] ??
      'Cópia de segurança'
    );
  }

  // ===================== Portões =====================

  novoPortao() {
    this.formPortao = portaoVazio();
    this.erroFormPortao.set(null);
    this.editandoPortao.set('novo');
  }

  editarPortao(p: GuaritaPortao) {
    this.formPortao = {
      nome: p.nome,
      tipo_receptor: p.tipo_receptor,
      num_receptor: p.num_receptor,
      botao: p.botao ?? null,
      rele: p.rele ?? null,
      sentido: p.sentido ?? null,
    };
    this.erroFormPortao.set(null);
    this.editandoPortao.set(p.id);
  }

  cancelarPortao() {
    this.editandoPortao.set(null);
    this.erroFormPortao.set(null);
  }

  salvarPortao() {
    if (this.salvandoPortao()) return;
    const f = this.formPortao;
    const nome = (f.nome ?? '').trim();
    if (!nome) {
      this.erroFormPortao.set('Informe o nome do portão.');
      return;
    }
    const numOuNulo = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
    const dto: GuaritaPortaoDto = {
      nome,
      tipo_receptor: Number(f.tipo_receptor),
      num_receptor: Number(f.num_receptor),
      botao: numOuNulo(f.botao),
      rele: numOuNulo(f.rele),
      sentido: f.sentido || null,
    };
    const alvo = this.editandoPortao();
    if (alvo === null) return;
    this.salvandoPortao.set(true);
    this.erroFormPortao.set(null);
    const req =
      alvo === 'novo'
        ? this.api.criarPortao(this.device.id, dto)
        : this.api.atualizarPortao(this.device.id, alvo, dto);
    req.subscribe({
      next: () => {
        this.salvandoPortao.set(false);
        this.editandoPortao.set(null);
        this.carregarPortoes();
      },
      error: (err) => {
        this.salvandoPortao.set(false);
        this.erroFormPortao.set(mensagemDaApiGuarita(err, 'Não foi possível salvar o portão.'));
      },
    });
  }

  async removerPortao(p: GuaritaPortao) {
    const ok = await this.confirm.ask({
      title: 'Remover portão',
      message: `O portão "${p.nome}" sai do histórico e da portaria. Nada é alterado no Guarita.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok || this.portaoEmAcao() !== null) return;
    this.portaoEmAcao.set(p.id);
    this.erroPortoes.set(null);
    this.api.removerPortao(this.device.id, p.id).subscribe({
      next: () => {
        this.portaoEmAcao.set(null);
        this.carregarPortoes();
      },
      error: (err) => {
        this.portaoEmAcao.set(null);
        this.erroPortoes.set(mensagemDaApiGuarita(err, 'Não foi possível remover o portão.'));
      },
    });
  }

  rotuloSentido(s: string | null): string {
    return s === 'entrada' ? 'Entrada' : s === 'saida' ? 'Saída' : '—';
  }
}
