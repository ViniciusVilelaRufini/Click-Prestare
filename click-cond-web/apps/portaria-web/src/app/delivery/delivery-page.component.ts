import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CriarEntregadorDelivery,
  DeliveryAtendimento,
  DeliveryEntregador,
  DeliveryStatus,
} from './delivery.model';
import { AuthService } from '../auth/auth.service';
import { DeliveryApi } from './delivery.service';

const TERMINAIS: readonly DeliveryStatus[] = ['CONCLUIDA', 'CANCELADA', 'RECUSADA'];

const PROXIMOS_STATUS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  AGENDADA: ['CHEGOU'],
  CHEGOU: ['AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'RETIRADA_NA_PORTARIA', 'RECUSADA'],
  AGUARDANDO_AUTORIZACAO: ['AUTORIZADA', 'RETIRADA_NA_PORTARIA', 'RECUSADA'],
  AUTORIZADA: ['CONCLUIDA'],
  RETIRADA_NA_PORTARIA: ['CONCLUIDA'],
  CONCLUIDA: [],
  CANCELADA: [],
  RECUSADA: [],
};

@Component({
  selector: 'app-delivery-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './delivery-page.component.html',
})
export class DeliveryPageComponent implements OnInit {
  private readonly api = inject(DeliveryApi);
  private readonly auth = inject(AuthService);

  readonly atendimentos = signal<DeliveryAtendimento[]>([]);
  readonly entregadores = signal<DeliveryEntregador[]>([]);
  readonly busca = signal('');
  readonly filtroStatus = signal<DeliveryStatus | ''>('');
  readonly selecionado = signal<DeliveryAtendimento | null>(null);
  readonly carregando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly entregadorSelecionadoId = signal<number | null>(null);
  readonly motivo = signal('');
  readonly aba = signal<'fila' | 'entregadores' | 'historico'>('fila');
  readonly entregadorEmEdicao = signal<DeliveryEntregador | null>(null);

  novoEntregador: CriarEntregadorDelivery = this.novoEntregadorVazio();
  motivoBloqueio = '';

  readonly atendimentosFiltrados = computed(() => {
    const busca = this.normalizar(this.busca());
    const status = this.filtroStatus();
    return this.atendimentos().filter((atendimento) => {
      if (status && atendimento.status !== status) return false;
      return this.correspondeBusca(atendimento, busca);
    });
  });

  readonly filaAtiva = computed(() =>
    this.atendimentosFiltrados().filter((atendimento) => !TERMINAIS.includes(atendimento.status)),
  );

  readonly historicoTerminal = computed(() => {
    const busca = this.normalizar(this.busca());
    return this.atendimentos().filter(
      (atendimento) => TERMINAIS.includes(atendimento.status) && this.correspondeBusca(atendimento, busca),
    );
  });

  readonly contadores = computed(() => {
    const contagem: Partial<Record<DeliveryStatus, number>> = {};
    for (const atendimento of this.atendimentos()) {
      contagem[atendimento.status] = (contagem[atendimento.status] ?? 0) + 1;
    }
    return contagem;
  });

  contador(status: DeliveryStatus): number {
    return this.contadores()[status] ?? 0;
  }

  ngOnInit(): void {
    this.carregar();
    this.carregarEntregadores();
  }

  carregar(): void {
    this.carregando.set(true);
    this.api.listAtendimentos().subscribe({
      next: (atendimentos) => {
        this.atendimentos.set(atendimentos);
        this.carregando.set(false);
      },
      error: (error) => this.definirErro(error, 'Não foi possível carregar a fila de delivery.'),
    });
  }

  carregarEntregadores(busca?: string): void {
    this.api.listEntregadores(busca).subscribe({
      next: (entregadores) => this.entregadores.set(entregadores),
      error: (error) => this.definirErro(error, 'Não foi possível carregar os entregadores.'),
    });
  }

  selecionar(atendimento: DeliveryAtendimento): void {
    this.selecionado.set(atendimento);
    this.entregadorSelecionadoId.set(atendimento.entregador?.id ?? null);
    this.motivo.set('');
  }

  proximosStatus(atendimento: DeliveryAtendimento): readonly DeliveryStatus[] {
    return PROXIMOS_STATUS[atendimento.status];
  }

  textoStatus(status: DeliveryStatus): string {
    // O enum não tem acento; o rótulo exibido tem.
    return status.replaceAll('_', ' ').replace('AUTORIZACAO', 'AUTORIZAÇÃO');
  }

  unidade(atendimento: DeliveryAtendimento): string {
    return [atendimento.apartamento.bloco, atendimento.apartamento.apto].filter(Boolean).join(' ');
  }

  nomeEntregador(atendimento: DeliveryAtendimento): string {
    return atendimento.entregador?.nome?.trim()
      || atendimento.nome_entregador?.trim()
      || 'Entregador ainda não identificado';
  }

  telefoneEntregador(atendimento: DeliveryAtendimento): string | null {
    return atendimento.entregador?.telefone?.trim()
      || atendimento.telefone_entregador?.trim()
      || null;
  }

  podeGerenciarEntregadores(): boolean {
    const turno = this.normalizarPapel(this.auth.porteiroInfo()?.turno);
    return ['SINDICO', 'ADMIN', 'ADMINISTRADOR', 'SUPERADMIN'].includes(turno);
  }

  podeAutorizar(atendimento: DeliveryAtendimento): boolean {
    const idEntregador = this.entregadorSelecionadoId() ?? atendimento.entregador?.id;
    const entregador = this.entregadores().find((item) => item.id === idEntregador) ?? atendimento.entregador;
    return !!entregador && entregador.status === 'ATIVO';
  }

  atualizarStatus(status: DeliveryStatus): void {
    const atendimento = this.selecionado();
    if (!atendimento || !this.proximosStatus(atendimento).includes(status)) return;
    if (status === 'AUTORIZADA' && !this.podeAutorizar(atendimento)) {
      const idEntregador = this.entregadorSelecionadoId() ?? atendimento.entregador?.id;
      this.erro.set(idEntregador
        ? 'Entregador bloqueado não pode ser autorizado.'
        : 'Identifique o entregador antes de autorizar.');
      return;
    }
    const motivo = this.motivo().trim();
    if (status === 'RECUSADA' && !motivo) {
      this.erro.set('Informe o motivo da recusa.');
      return;
    }
    this.carregando.set(true);
    this.api.atualizarStatus(atendimento.id, status, {
      id_entregador: this.entregadorSelecionadoId() ?? undefined,
      motivo: motivo || undefined,
    }).subscribe({
      next: () => {
        this.selecionado.set(null);
        this.carregar();
      },
      error: (error) => this.definirErro(error, 'Não foi possível atualizar o atendimento.'),
    });
  }

  iniciarCadastroNoAtendimento(): void {
    this.novoEntregador = this.novoEntregadorVazio();
    this.aba.set('entregadores');
  }

  criarEntregador(): void {
    if (!this.novoEntregador.nome.trim()) {
      this.erro.set('Nome do entregador é obrigatório.');
      return;
    }
    this.api.criarEntregador(this.novoEntregador).subscribe({
      next: (resposta) => {
        const entregador: DeliveryEntregador = { ...resposta, veiculos: resposta.veiculos ?? [] };
        this.entregadores.update((lista) => [...lista, entregador].sort((a, b) => a.nome.localeCompare(b.nome)));
        this.entregadorSelecionadoId.set(entregador.id);
        this.novoEntregador = this.novoEntregadorVazio();
        this.aba.set('fila');
      },
      error: (error) => this.definirErro(error, 'Não foi possível cadastrar o entregador.'),
    });
  }

  editarEntregador(entregador: DeliveryEntregador): void {
    if (!this.podeGerenciarEntregadores()) return;
    const veiculos = entregador.veiculos.length
      ? entregador.veiculos.map((veiculo) => ({ ...veiculo }))
      : [{ tipo: 'Moto', placa: '', modelo: '', cor: '' }];
    this.entregadorEmEdicao.set({ ...entregador, veiculos });
    this.motivoBloqueio = entregador.motivo_bloqueio ?? '';
  }

  removerVeiculoEmEdicao(): void {
    const entregador = this.entregadorEmEdicao();
    if (entregador) entregador.veiculos = [{ tipo: '', placa: '', modelo: '', cor: '' }];
  }

  salvarEntregador(): void {
    const entregador = this.entregadorEmEdicao();
    if (!entregador) return;
    if (!this.podeGerenciarEntregadores()) {
      this.erro.set('Somente síndico ou administrador pode editar entregadores.');
      return;
    }
    if (entregador.status === 'BLOQUEADO' && !this.motivoBloqueio.trim()) {
      this.erro.set('Informe o motivo do bloqueio.');
      return;
    }
    const principal = entregador.veiculos[0];
    const temVeiculo = principal && [principal.placa, principal.tipo, principal.modelo, principal.cor]
      .some((valor) => !!valor?.trim());
    this.api.atualizarEntregador(entregador.id, {
      nome: entregador.nome,
      telefone: entregador.telefone ?? undefined,
      documento: entregador.documento ?? undefined,
      plataforma: entregador.plataforma ?? undefined,
      status: entregador.status,
      motivo_bloqueio: entregador.status === 'BLOQUEADO' ? this.motivoBloqueio.trim() : undefined,
      veiculo: temVeiculo
        ? {
            placa: principal.placa ?? '',
            tipo: principal.tipo ?? '',
            modelo: principal.modelo ?? '',
            cor: principal.cor ?? '',
          }
        : null,
    }).subscribe({
      next: (atualizado) => {
        this.entregadores.update((lista) => lista.map((item) =>
          item.id === atualizado.id
            ? { ...atualizado, veiculos: atualizado.veiculos ?? item.veiculos ?? [] }
            : item,
        ));
        this.entregadorEmEdicao.set(null);
      },
      error: (error) => this.definirErro(error, 'Não foi possível atualizar o entregador.'),
    });
  }

  private novoEntregadorVazio(): CriarEntregadorDelivery {
    return { nome: '', telefone: '', plataforma: '', veiculo: { placa: '', tipo: 'Moto', modelo: '', cor: '' } };
  }

  private normalizar(valor: string): string {
    return valor.toLocaleUpperCase('pt-BR').replace(/[^A-Z0-9]/g, '');
  }

  private normalizarPapel(valor: string | null | undefined): string {
    return (valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  }

  private correspondeBusca(atendimento: DeliveryAtendimento, busca: string): boolean {
    if (!busca) return true;
    const unidade = `${atendimento.apartamento.bloco ?? ''}${atendimento.apartamento.apto}`;
    const entregador = atendimento.entregador;
    const valores = [
      unidade,
      atendimento.estabelecimento,
      atendimento.nome_entregador,
      atendimento.telefone_entregador,
      entregador?.nome,
      entregador?.telefone,
      ...((entregador?.veiculos ?? []).map((veiculo) => veiculo.placa)),
    ];
    return valores.some((valor) => this.normalizar(valor ?? '').includes(busca));
  }

  private definirErro(error: unknown, fallback: string): void {
    const mensagem = (error as { error?: { message?: string }; message?: string })?.error?.message
      ?? (error as { message?: string })?.message
      ?? fallback;
    this.erro.set(Array.isArray(mensagem) ? mensagem.join(', ') : mensagem);
    this.carregando.set(false);
  }
}
