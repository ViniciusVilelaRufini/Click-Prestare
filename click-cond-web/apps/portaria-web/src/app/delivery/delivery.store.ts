import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import {
  CriarEntregadorDelivery,
  DeliveryAtendimento,
  DeliveryEntregador,
  DeliveryStatus,
} from './delivery.model';
import { DeliveryApi } from './delivery.service';
import { PROXIMOS_STATUS } from './shared/delivery-status';

export type AbaDelivery = 'fila' | 'entregadores' | 'historico';

/** Estado da página de delivery; provido em `DeliveryPageComponent.providers`. */
@Injectable()
export class DeliveryStore {
  private readonly api = inject(DeliveryApi);
  private readonly auth = inject(AuthService);

  readonly aba = signal<AbaDelivery>('fila');
  readonly ativos = signal<DeliveryAtendimento[]>([]);
  readonly entregadores = signal<DeliveryEntregador[]>([]);
  readonly busca = signal('');
  readonly filtroStatus = signal<DeliveryStatus | ''>('');
  readonly selecionado = signal<DeliveryAtendimento | null>(null);
  readonly carregando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly entregadorSelecionadoId = signal<number | null>(null);
  readonly motivo = signal('');
  readonly entregadorEmEdicao = signal<DeliveryEntregador | null>(null);
  readonly agora = signal(new Date());

  novoEntregador: CriarEntregadorDelivery = this.novoEntregadorVazio();
  motivoBloqueio = '';

  readonly fila = computed(() => {
    const busca = this.normalizar(this.busca());
    const status = this.filtroStatus();
    return this.ativos().filter((a) => (!status || a.status === status) && this.correspondeBusca(a, busca));
  });

  readonly contadores = computed(() => {
    const contagem: Partial<Record<DeliveryStatus, number>> = {};
    for (const a of this.ativos()) contagem[a.status] = (contagem[a.status] ?? 0) + 1;
    return contagem;
  });

  contador(status: DeliveryStatus): number {
    return this.contadores()[status] ?? 0;
  }

  trocarAba(aba: AbaDelivery): void {
    this.erro.set(null);
    this.aba.set(aba);
  }

  alternarFiltro(status: DeliveryStatus): void {
    this.filtroStatus.update((atual) => (atual === status ? '' : status));
  }

  carregarFila(opts: { silencioso?: boolean } = {}): void {
    if (!opts.silencioso) this.carregando.set(true);
    this.api.listAtivos().subscribe({
      next: (lista) => {
        this.ativos.set(lista);
        this.agora.set(new Date());
        // Mantém o painel no mesmo atendimento com dados novos; some se saiu da fila.
        const aberto = this.selecionado();
        if (aberto) this.selecionado.set(lista.find((a) => a.id === aberto.id) ?? null);
        if (opts.silencioso) {
          // Recarga automática que voltou a funcionar: some o aviso de conexão; não mexe em `carregando`.
          this.erro.set(null);
        } else {
          this.carregando.set(false);
        }
      },
      error: (error) => this.definirErro(error, 'Não foi possível carregar a fila de delivery.', opts.silencioso),
    });
  }

  carregarEntregadores(busca?: string): void {
    this.api.listEntregadores(busca).subscribe({
      next: (lista) => this.entregadores.set(lista),
      error: (error) => this.definirErro(error, 'Não foi possível carregar os entregadores.'),
    });
  }

  selecionar(a: DeliveryAtendimento): void {
    this.selecionado.set(a);
    this.entregadorSelecionadoId.set(a.entregador?.id ?? null);
    this.motivo.set('');
  }

  proximosStatus(a: DeliveryAtendimento): readonly DeliveryStatus[] {
    return PROXIMOS_STATUS[a.status] ?? [];
  }

  unidade(a: DeliveryAtendimento): string {
    return [a.apartamento.bloco, a.apartamento.apto].filter(Boolean).join(' ');
  }

  nomeEntregador(a: DeliveryAtendimento): string {
    return a.entregador?.nome?.trim() || a.nome_entregador?.trim() || 'Entregador ainda não identificado';
  }

  telefoneEntregador(a: DeliveryAtendimento): string | null {
    return a.entregador?.telefone?.trim() || a.telefone_entregador?.trim() || null;
  }

  podeGerenciarEntregadores(): boolean {
    const turno = this.normalizarPapel(this.auth.porteiroInfo()?.turno);
    return ['SINDICO', 'ADMIN', 'ADMINISTRADOR', 'SUPERADMIN'].includes(turno);
  }

  podeAutorizar(a: DeliveryAtendimento): boolean {
    const id = this.entregadorSelecionadoId() ?? a.entregador?.id;
    const entregador = this.entregadores().find((e) => e.id === id) ?? a.entregador;
    return !!entregador && entregador.status === 'ATIVO';
  }

  atualizarStatus(status: DeliveryStatus): void {
    this.erro.set(null);
    const a = this.selecionado();
    if (!a || !this.proximosStatus(a).includes(status)) return;
    if (status === 'AUTORIZADA' && !this.podeAutorizar(a)) {
      const id = this.entregadorSelecionadoId() ?? a.entregador?.id;
      this.erro.set(id ? 'Entregador bloqueado não pode ser autorizado.' : 'Identifique o entregador antes de autorizar.');
      return;
    }
    const motivo = this.motivo().trim();
    if (status === 'RECUSADA' && !motivo) {
      this.erro.set('Informe o motivo da recusa.');
      return;
    }
    this.carregando.set(true);
    this.api.atualizarStatus(a.id, status, {
      id_entregador: this.entregadorSelecionadoId() ?? undefined,
      motivo: motivo || undefined,
    }).subscribe({
      next: () => {
        this.motivo.set('');
        this.erro.set(null);
        this.carregarFila();
      },
      error: (error) => this.definirErro(error, 'Não foi possível atualizar o atendimento.'),
    });
  }

  iniciarCadastroNoAtendimento(): void {
    this.novoEntregador = this.novoEntregadorVazio();
    this.entregadorEmEdicao.set(null);
    this.trocarAba('entregadores');
  }

  criarEntregador(): void {
    if (!this.novoEntregador.nome.trim()) {
      this.erro.set('Nome do entregador é obrigatório.');
      return;
    }
    this.api.criarEntregador(this.novoEntregador).subscribe({
      next: (resposta) => {
        const entregador: DeliveryEntregador = { ...resposta, veiculos: resposta.veiculos ?? [] };
        this.entregadores.update((lista) => [...lista, entregador].sort((x, y) => x.nome.localeCompare(y.nome)));
        this.entregadorSelecionadoId.set(entregador.id);
        this.novoEntregador = this.novoEntregadorVazio();
        this.trocarAba('fila');
      },
      error: (error) => this.definirErro(error, 'Não foi possível cadastrar o entregador.'),
    });
  }

  editarEntregador(e: DeliveryEntregador): void {
    if (!this.podeGerenciarEntregadores()) return;
    const veiculos = e.veiculos.length ? e.veiculos.map((v) => ({ ...v })) : [{ tipo: 'Moto', placa: '', modelo: '', cor: '' }];
    this.entregadorEmEdicao.set({ ...e, veiculos });
    this.motivoBloqueio = e.motivo_bloqueio ?? '';
  }

  cancelarEdicao(): void {
    this.entregadorEmEdicao.set(null);
    this.motivoBloqueio = '';
  }

  removerVeiculoEmEdicao(): void {
    const e = this.entregadorEmEdicao();
    if (e) e.veiculos = [{ tipo: '', placa: '', modelo: '', cor: '' }];
  }

  salvarEntregador(): void {
    const e = this.entregadorEmEdicao();
    if (!e) return;
    if (!this.podeGerenciarEntregadores()) {
      this.erro.set('Somente síndico ou administrador pode editar entregadores.');
      return;
    }
    if (e.status === 'BLOQUEADO' && !this.motivoBloqueio.trim()) {
      this.erro.set('Informe o motivo do bloqueio.');
      return;
    }
    const principal = e.veiculos[0];
    const temVeiculo = principal && [principal.placa, principal.tipo, principal.modelo, principal.cor].some((v) => !!v?.trim());
    this.api.atualizarEntregador(e.id, {
      nome: e.nome,
      telefone: e.telefone ?? undefined,
      documento: e.documento ?? undefined,
      plataforma: e.plataforma ?? undefined,
      status: e.status,
      motivo_bloqueio: e.status === 'BLOQUEADO' ? this.motivoBloqueio.trim() : undefined,
      veiculo: temVeiculo
        ? { placa: principal.placa ?? '', tipo: principal.tipo ?? '', modelo: principal.modelo ?? '', cor: principal.cor ?? '' }
        : null,
    }).subscribe({
      next: (atualizado) => {
        this.entregadores.update((lista) => lista.map((item) =>
          item.id === atualizado.id ? { ...atualizado, veiculos: atualizado.veiculos ?? item.veiculos ?? [] } : item,
        ));
        this.cancelarEdicao();
      },
      error: (error) => this.definirErro(error, 'Não foi possível atualizar o entregador.'),
    });
  }

  definirErro(error: unknown, fallback: string, silencioso = false): void {
    const mensagem = (error as { error?: { message?: string } })?.error?.message
      ?? (error as { message?: string })?.message
      ?? fallback;
    this.erro.set(Array.isArray(mensagem) ? mensagem.join(', ') : mensagem);
    if (!silencioso) this.carregando.set(false);
  }

  private novoEntregadorVazio(): CriarEntregadorDelivery {
    return { nome: '', telefone: '', plataforma: '', veiculo: { placa: '', tipo: 'Moto', modelo: '', cor: '' } };
  }

  private normalizar(valor: string): string {
    return valor.toLocaleUpperCase('pt-BR').replace(/[^A-Z0-9]/g, '');
  }

  private normalizarPapel(valor: string | null | undefined): string {
    return (valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  }

  correspondeBusca(a: DeliveryAtendimento, buscaNormalizada: string): boolean {
    if (!buscaNormalizada) return true;
    const e = a.entregador;
    const valores = [
      `${a.apartamento.bloco ?? ''}${a.apartamento.apto}`,
      a.estabelecimento, a.nome_entregador, a.telefone_entregador, e?.nome, e?.telefone,
      ...((e?.veiculos ?? []).map((v) => v.placa)),
    ];
    return valores.some((v) => this.normalizar(v ?? '').includes(buscaNormalizada));
  }

  buscaNormalizada(texto: string): string {
    return this.normalizar(texto);
  }
}
