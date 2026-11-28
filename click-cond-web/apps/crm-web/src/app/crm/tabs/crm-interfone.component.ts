import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ClienteInterfone, DestinoPortaria, FaixaAgenda, InterfoneCrmApi } from '../interfone.service';
import { ToastService } from '../../shared/toast.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';

/** Dias da agenda (0 = domingo, como na API). */
export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const;
const DIAS_UTEIS = [1, 2, 3, 4, 5];
const NUMERO_PORTARIA = /^\d{1,8}$/;

/** Troca as faixas de segunda a sexta por cópias das faixas de `dia`; sábado e domingo ficam como estão. */
export function copiarParaDiasUteis(faixas: FaixaAgenda[], dia: number): FaixaAgenda[] {
  const modelo = faixas.filter((f) => f.dia_semana === dia);
  const fora = faixas.filter((f) => !DIAS_UTEIS.includes(f.dia_semana));
  const copias = DIAS_UTEIS.flatMap((d) => modelo.map((f) => ({ ...f, dia_semana: d })));
  return ordenarAgenda([...fora, ...copias]);
}

function ordenarAgenda(faixas: FaixaAgenda[]): FaixaAgenda[] {
  return [...faixas].sort((a, b) => a.dia_semana - b.dia_semana || a.inicio.localeCompare(b.inicio));
}

function porDia(faixas: FaixaAgenda[]): FaixaAgenda[][] {
  return DIAS_SEMANA.map((_, d) => faixas.filter((f) => f.dia_semana === d).map((f) => ({ ...f })));
}

function mensagem(e: any, padrao: string): string {
  const m = e?.error?.message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m) && m.length) return m.join(' ');
  return padrao;
}

/**
 * Aba Interfone: libera o módulo "Interfone pelo app" condomínio a condomínio quando a venda fecha. Contratar só
 * mostra a aba no console do síndico — quem liga as chamadas é o síndico, lá. Cobrança fica fora.
 * Portaria autônoma: por cliente, "Central contratada", "IA no portão (Entrega 2)", número da portaria,
 * instruções de entrega e a agenda (local ou central por faixa de horário). O síndico só vê.
 */
@Component({
  selector: 'crm-interfone',
  standalone: true,
  imports: [EmptyStateComponent],
  templateUrl: './crm-interfone.component.html',
})
export class CrmInterfoneComponent implements OnInit {
  private readonly api = inject(InterfoneCrmApi);
  private readonly toast = inject(ToastService);

  readonly dias = DIAS_SEMANA;
  readonly carregando = signal(true);
  readonly erro = signal<string | null>(null);
  readonly clientes = signal<ClienteInterfone[]>([]);
  readonly alterando = signal<number | null>(null);
  readonly totalContratados = computed(() => this.clientes().filter((c) => c.contratado).length);

  // ── Central do cliente aberto ──
  readonly aberto = signal<number | null>(null);
  readonly alterandoCentral = signal<number | null>(null);
  readonly edNumero = signal('');
  readonly edInstrucao = signal('');
  readonly salvandoPortaria = signal(false);
  readonly agenda = signal<FaixaAgenda[][]>(porDia([]));
  readonly carregandoAgenda = signal(false);
  readonly salvandoAgenda = signal(false);
  readonly erroAgenda = signal<string | null>(null);
  /** A agenda gravada não carregou: salvar mandaria a lista vazia e apagaria tudo. Fica bloqueado até reabrir. */
  readonly agendaFalhou = signal(false);

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.api.clientes().subscribe({
      next: (lista) => {
        this.clientes.set(
          Array.isArray(lista)
            ? lista.map((c) => ({
                ...c,
                contratado: !!c.contratado,
                central_contratada: !!c.central_contratada,
                ia_portao_ativa: !!c.ia_portao_ativa,
                numero_portaria: c.numero_portaria ?? '0',
                instrucao_entregas: c.instrucao_entregas ?? null,
              }))
            : [],
        );
        this.carregando.set(false);
      },
      error: (e) => {
        this.erro.set(e?.error?.message ?? 'Não foi possível carregar os condomínios.');
        this.carregando.set(false);
      },
    });
  }

  /** Contratar pede confirmação; descontratar vai direto. A caixa volta ao estado real se cancelar ou falhar. */
  alternar(c: ClienteInterfone, caixa: HTMLInputElement): void {
    const ligado = caixa.checked;
    if (ligado) {
      const ok = confirm(
        `Liberar o Interfone pelo app para "${c.nome}"?\n\n` +
          'O síndico passa a ver a aba Interfone no console e decide lá quando ligar as chamadas.',
      );
      if (!ok) {
        caixa.checked = c.contratado;
        return;
      }
    }
    this.alterando.set(c.id);
    this.api.definirContratado(c.id, ligado).subscribe({
      next: (r) => {
        const contratado = typeof r?.contratado === 'boolean' ? r.contratado : ligado;
        this.atualizar(c.id, { contratado });
        caixa.checked = contratado;
        this.alterando.set(null);
        this.toast.trigger(
          contratado ? `Interfone de "${c.nome}" contratado.` : `Interfone de "${c.nome}" desligado.`,
          contratado ? 'success' : 'info',
        );
      },
      error: (e) => {
        caixa.checked = c.contratado;
        this.alterando.set(null);
        this.toast.trigger(e?.error?.message ?? 'Não foi possível alterar.', 'error');
      },
    });
  }

  // ── Central Prestare ──

  abrirCentral(c: ClienteInterfone): void {
    if (this.aberto() === c.id) {
      this.aberto.set(null);
      return;
    }
    this.aberto.set(c.id);
    this.edNumero.set(c.numero_portaria ?? '0');
    this.edInstrucao.set(c.instrucao_entregas ?? '');
    this.erroAgenda.set(null);
    this.agendaFalhou.set(false);
    this.agenda.set(porDia([]));
    this.carregandoAgenda.set(true);
    this.api.agenda(c.id).subscribe({
      next: (l) => {
        if (this.aberto() !== c.id) return;
        this.agenda.set(porDia(Array.isArray(l) ? l : []));
        this.carregandoAgenda.set(false);
      },
      error: (e) => {
        this.carregandoAgenda.set(false);
        this.agendaFalhou.set(true);
        this.erroAgenda.set(mensagem(e, 'Não foi possível carregar a agenda. Feche e abra de novo antes de editar.'));
      },
    });
  }

  /** Ligar a central muda a operação do prédio: pede confirmação. Desligar vai direto. */
  alternarCentral(c: ClienteInterfone, caixa: HTMLInputElement): void {
    const ligado = caixa.checked;
    if (ligado) {
      const ok = confirm(
        `Ligar a Central Prestare para "${c.nome}"?\n\n` +
          'As chamadas da portaria passam a seguir a agenda; sem porteiro conectado, a central atende.',
      );
      if (!ok) {
        caixa.checked = c.central_contratada;
        return;
      }
    }
    this.alterandoCentral.set(c.id);
    this.api.definirCentral(c.id, ligado).subscribe({
      next: (r) => {
        const central = typeof r?.central_contratada === 'boolean' ? r.central_contratada : ligado;
        this.atualizar(c.id, { central_contratada: central });
        caixa.checked = central;
        this.alterandoCentral.set(null);
        this.toast.trigger(
          central ? `Central de "${c.nome}" contratada.` : `Central de "${c.nome}" desligada.`,
          central ? 'success' : 'info',
        );
      },
      error: (e) => {
        caixa.checked = c.central_contratada;
        this.alterandoCentral.set(null);
        this.toast.trigger(mensagem(e, 'Não foi possível alterar a central.'), 'error');
      },
    });
  }

  alternarIa(c: ClienteInterfone, caixa: HTMLInputElement): void {
    const ligado = caixa.checked;
    this.alterandoCentral.set(c.id);
    this.api.definirIa(c.id, ligado).subscribe({
      next: (r) => {
        const ia = typeof r?.ia_portao_ativa === 'boolean' ? r.ia_portao_ativa : ligado;
        this.atualizar(c.id, { ia_portao_ativa: ia });
        caixa.checked = ia;
        this.alterandoCentral.set(null);
      },
      error: (e) => {
        caixa.checked = c.ia_portao_ativa;
        this.alterandoCentral.set(null);
        this.toast.trigger(mensagem(e, 'Não foi possível alterar a IA no portão.'), 'error');
      },
    });
  }

  salvarPortaria(c: ClienteInterfone): void {
    if (this.salvandoPortaria()) return;
    const numero = this.edNumero().trim();
    if (!NUMERO_PORTARIA.test(numero)) {
      this.toast.trigger('Número da portaria: de 1 a 8 dígitos.', 'error');
      return;
    }
    const instrucao = this.edInstrucao().trim() || null;
    this.salvandoPortaria.set(true);
    this.api.salvarPortaria(c.id, { numero_portaria: numero, instrucao_entregas: instrucao }).subscribe({
      next: (r) => {
        this.salvandoPortaria.set(false);
        this.atualizar(c.id, {
          numero_portaria: r?.numero_portaria ?? numero,
          instrucao_entregas: r?.instrucao_entregas !== undefined ? r.instrucao_entregas : instrucao,
        });
        this.toast.trigger(`Portaria de "${c.nome}" salva.`, 'success');
      },
      error: (e) => {
        this.salvandoPortaria.set(false);
        this.toast.trigger(mensagem(e, 'Não foi possível salvar a portaria.'), 'error');
      },
    });
  }

  // ── Agenda ──

  adicionarFaixa(dia: number): void {
    this.agenda.update((a) => {
      const lista = a[dia];
      const inicio = lista.length ? lista[lista.length - 1].fim : '00:00';
      const nova: FaixaAgenda = { dia_semana: dia, inicio: inicio === '24:00' ? '00:00' : inicio, fim: '24:00', destino: 'central' };
      return a.map((l, d) => (d === dia ? [...l, nova] : l));
    });
  }

  removerFaixa(dia: number, idx: number): void {
    this.agenda.update((a) => a.map((l, d) => (d === dia ? l.filter((_, i) => i !== idx) : l)));
  }

  editarFaixa(dia: number, idx: number, campo: 'inicio' | 'fim' | 'destino', valor: string): void {
    this.agenda.update((a) =>
      a.map((l, d) =>
        d === dia
          ? l.map((f, i) => (i === idx ? { ...f, [campo]: campo === 'destino' ? (valor as DestinoPortaria) : valor.trim() } : f))
          : l,
      ),
    );
  }

  copiarUteis(dia: number): void {
    this.agenda.set(porDia(copiarParaDiasUteis(this.agenda().flat(), dia)));
  }

  salvarAgenda(c: ClienteInterfone): void {
    if (this.salvandoAgenda() || this.carregandoAgenda() || this.agendaFalhou()) return;
    this.erroAgenda.set(null);
    this.salvandoAgenda.set(true);
    this.api.salvarAgenda(c.id, ordenarAgenda(this.agenda().flat())).subscribe({
      next: (l) => {
        this.salvandoAgenda.set(false);
        if (Array.isArray(l)) this.agenda.set(porDia(l));
        this.toast.trigger(`Agenda de "${c.nome}" salva.`, 'success');
      },
      error: (e) => {
        this.salvandoAgenda.set(false);
        this.erroAgenda.set(mensagem(e, 'Não foi possível salvar a agenda.'));
      },
    });
  }

  private atualizar(id: number, dados: Partial<ClienteInterfone>): void {
    this.clientes.update((l) => l.map((x) => (x.id === id ? { ...x, ...dados } : x)));
  }
}
