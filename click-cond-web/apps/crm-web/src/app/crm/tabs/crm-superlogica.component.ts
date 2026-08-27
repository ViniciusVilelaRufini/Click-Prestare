import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import {
  ClienteVinculo,
  CondominioSuperlogica,
  PreviewUnidades,
  ResultadoSync,
  SuperlogicaService,
} from '../superlogica.service';
import { ToastService } from '../../shared/toast.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';

/**
 * Aba Superlógica: ativação comercial da integração, condomínio a condomínio.
 *
 * Vincular um condomínio do Clique a um do ERP é o que liga a sincronização de
 * taxa condominial para aquele prédio — o passo do dia em que a venda fecha.
 * Sem vínculo, o condomínio é ignorado pela integração.
 *
 * Estado local (não vai ao CrmStore): nada aqui é compartilhado com outras abas.
 */
@Component({
  selector: 'crm-superlogica',
  standalone: true,
  imports: [CommonModule, FormsModule, EmptyStateComponent],
  templateUrl: './crm-superlogica.component.html',
})
export class CrmSuperlogicaComponent implements OnInit {
  private api = inject(SuperlogicaService);
  private toast = inject(ToastService);

  readonly carregando = signal(true);
  readonly configurado = signal(true);
  readonly erro = signal<string | null>(null);

  readonly clientes = signal<ClienteVinculo[]>([]);
  readonly condominiosErp = signal<CondominioSuperlogica[]>([]);

  /** id do condomínio do Clique cuja linha está com ação em andamento. */
  readonly salvando = signal<number | null>(null);

  /** Seleção do <select> por linha: idCliente → idSuperlogica. */
  readonly selecionado = signal<Record<number, number | null>>({});

  /** Prévia aberta: idCliente → resultado. */
  readonly preview = signal<Record<number, PreviewUnidades | null>>({});
  readonly carregandoPreview = signal<number | null>(null);

  /** id do condomínio importando/sincronizando, para travar os botões. */
  readonly importando = signal<number | null>(null);
  readonly sincronizando = signal<number | null>(null);

  /** Último resultado de sync por condomínio, exibido na linha. */
  readonly ultimoSync = signal<Record<number, ResultadoSync | null>>({});

  /**
   * Importar também os moradores, por condomínio. Desligado por padrão: cria
   * conta para pessoas reais, então é escolha explícita do operador.
   */
  readonly comMoradores = signal<Record<number, boolean>>({});

  alternarMoradores(idCliente: number, marcado: boolean): void {
    this.comMoradores.update((s) => ({ ...s, [idCliente]: marcado }));
  }

  readonly totalAtivados = computed(() => this.clientes().filter((c) => c.idSuperlogica != null).length);

  /** Condomínios do ERP ainda livres, mais o já vinculado à própria linha. */
  disponiveisPara(cliente: ClienteVinculo): CondominioSuperlogica[] {
    return this.condominiosErp().filter(
      (c) => c.vinculadoA == null || c.vinculadoA.id === cliente.id,
    );
  }

  nomeErpDe(cliente: ClienteVinculo): string | null {
    if (cliente.idSuperlogica == null) return null;
    return this.condominiosErp().find((c) => c.idSuperlogica === cliente.idSuperlogica)?.nome ?? `id ${cliente.idSuperlogica}`;
  }

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);

    this.api.status().subscribe({
      next: ({ configurado }) => {
        this.configurado.set(configurado);
        if (!configurado) {
          // Sem credenciais no servidor, consultar o ERP só produziria erro de
          // rede sem explicação. Melhor dizer o que falta.
          this.carregando.set(false);
          return;
        }
        this.carregarDados();
      },
      error: () => {
        this.erro.set('Não foi possível falar com a API do Clique.');
        this.carregando.set(false);
      },
    });
  }

  private carregarDados(): void {
    forkJoin({
      clientes: this.api.clientes(),
      erp: this.api.condominiosDoErp(),
    }).subscribe({
      next: ({ clientes, erp }) => {
        this.clientes.set(clientes);
        this.condominiosErp.set(erp);
        this.carregando.set(false);
      },
      error: (e) => {
        this.erro.set(e?.error?.message ?? 'Não foi possível consultar a Superlógica.');
        this.carregando.set(false);
      },
    });
  }

  aoSelecionar(idCliente: number, valor: string): void {
    this.selecionado.update((s) => ({ ...s, [idCliente]: valor ? Number(valor) : null }));
  }

  ativar(cliente: ClienteVinculo): void {
    const idSuperlogica = this.selecionado()[cliente.id];
    if (idSuperlogica == null) {
      this.toast.trigger('Escolha o condomínio correspondente na Superlógica.', 'error');
      return;
    }

    this.salvando.set(cliente.id);
    this.api.vincular(cliente.id, idSuperlogica).subscribe({
      next: (r) => {
        this.toast.trigger(`"${cliente.nome}" vinculado a "${r.nomeSuperlogica}".`, 'success');
        this.salvando.set(null);
        this.carregarDados();
      },
      error: (e) => {
        // O backend recusa id inexistente e condomínio do ERP já em uso; a
        // mensagem dele é mais específica que qualquer texto genérico daqui.
        this.toast.trigger(e?.error?.message ?? 'Não foi possível ativar.', 'error');
        this.salvando.set(null);
      },
    });
  }

  desativar(cliente: ClienteVinculo): void {
    const ok = confirm(
      `Desativar a integração de "${cliente.nome}"?\n\n` +
        'As cobranças já sincronizadas continuam no app — só param de ser atualizadas.',
    );
    if (!ok) return;

    this.salvando.set(cliente.id);
    this.api.desvincular(cliente.id).subscribe({
      next: () => {
        this.toast.trigger(`Integração de "${cliente.nome}" desativada.`, 'info');
        this.salvando.set(null);
        this.carregarDados();
      },
      error: (e) => {
        this.toast.trigger(e?.error?.message ?? 'Não foi possível desativar.', 'error');
        this.salvando.set(null);
      },
    });
  }

  /** Leitura pura: mostra o que existe dos dois lados, sem importar nada. */
  conferirUnidades(cliente: ClienteVinculo): void {
    this.carregandoPreview.set(cliente.id);
    this.api.previewUnidades(cliente.id).subscribe({
      next: (r) => {
        this.preview.update((p) => ({ ...p, [cliente.id]: r }));
        this.carregandoPreview.set(null);
      },
      error: (e) => {
        this.toast.trigger(e?.error?.message ?? 'Não foi possível ler as unidades.', 'error');
        this.carregandoPreview.set(null);
      },
    });
  }

  fecharPreview(idCliente: number): void {
    this.preview.update((p) => ({ ...p, [idCliente]: null }));
  }

  /**
   * Cria os apartamentos a partir das unidades do ERP.
   *
   * É o passo que faltava entre vincular e ver cobrança: sem apartamento
   * vinculado, a sincronização não tem a quem entregar a cobrança.
   */
  importarUnidades(cliente: ClienteVinculo): void {
    const comMoradores = this.comMoradores()[cliente.id] === true;

    this.importando.set(cliente.id);
    this.api.importarUnidades(cliente.id, comMoradores).subscribe({
      next: (r) => {
        const partes = [`${r.apartamentosCriados} apartamento(s) criado(s)`];
        if (r.apartamentosVinculados) partes.push(`${r.apartamentosVinculados} vinculado(s)`);
        if (comMoradores) {
          partes.push(`${r.moradoresCriados} morador(es)`);
          if (r.moradoresJaExistiam) partes.push(`${r.moradoresJaExistiam} já existia(m)`);
        }
        this.toast.trigger(`Importação concluída: ${partes.join(', ')}.`, 'success');

        // Unidade duplicada não é detalhe de log: ela ficou de fora, e as
        // cobranças dela não vão aparecer para ninguém.
        if (r.duplicadasIgnoradas.length) {
          this.toast.trigger(
            `${r.duplicadasIgnoradas.length} unidade(s) ignorada(s) por identificação repetida: ${r.duplicadasIgnoradas.join(', ')}.`,
            'error',
          );
        }

        this.importando.set(null);
        this.carregarDados();
      },
      error: (e) => {
        this.toast.trigger(e?.error?.message ?? 'Não foi possível importar as unidades.', 'error');
        this.importando.set(null);
      },
    });
  }

  /** Puxa as cobranças agora, sem esperar o ciclo horário. */
  sincronizarAgora(cliente: ClienteVinculo): void {
    this.sincronizando.set(cliente.id);
    this.api.sincronizar(cliente.id).subscribe({
      next: (r) => {
        this.ultimoSync.update((s) => ({ ...s, [cliente.id]: r }));
        this.toast.trigger(
          r.cobrancasLidas === 0
            ? 'Nenhuma cobrança no período. Gere a arrecadação no ERP e sincronize de novo.'
            : `${r.lancamentosGravados} lançamento(s) gravado(s) de ${r.cobrancasLidas} cobrança(s).`,
          r.cobrancasLidas === 0 ? 'info' : 'success',
        );
        this.sincronizando.set(null);
        this.carregarDados();
      },
      error: (e) => {
        this.toast.trigger(e?.error?.message ?? 'Não foi possível sincronizar.', 'error');
        this.sincronizando.set(null);
      },
    });
  }
}
