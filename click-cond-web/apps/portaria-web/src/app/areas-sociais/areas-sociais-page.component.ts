import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgendamentoArea, AreaSocial, AreasSociaisApi } from './areas-sociais.service';
import { ApartamentosApi, Apartamento } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';

/** Intervalo da recarga silenciosa da lista de reservas. */
const RECARGA_RESERVAS_MS = 30_000;

@Component({
  selector: 'app-areas-sociais-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SlideIndicatorDirective],
  templateUrl: './areas-sociais-page.component.html',
})
export class AreasSociaisPageComponent implements OnInit {
  private api = inject(AreasSociaisApi);
  private apartamentosApi = inject(ApartamentosApi);
  private confirm = inject(ConfirmService);
  private destroyRef = inject(DestroyRef);

  readonly areas = signal<AreaSocial[]>([]);
  readonly agendamentos = signal<AgendamentoArea[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly tab = signal<'areas' | 'reservas'>('areas');
  /** Erro da última ação sobre uma reserva (aprovar, recusar, cancelar…). */
  readonly acaoErro = signal<string | null>(null);
  /** Falha da recarga da lista (automática ou depois de uma ação); some quando volta a carregar. */
  readonly recargaErro = signal<string | null>(null);

  // Controle do Modal
  readonly modalAberto = signal(false);
  novaArea: any = { nome: '', capacidade: null, limite_mensal_apto: null, imagem: '', agendar: true, autorizacao: true, regras: '' };
  readonly areaEditando = signal<AreaSocial | null>(null);

  // Upload da foto do espaço
  readonly fotoPreview = signal<string | null>(null);
  readonly fotoNome = signal<string | null>(null);
  readonly fotoErro = signal<string | null>(null);
  readonly modoUrl = signal(false); // alterna entre upload de arquivo e colar URL
  readonly salvando = signal(false);

  // Modal de Reserva (síndico/porteiro agenda em nome do morador)
  readonly modalReserva = signal(false);
  readonly areaReserva = signal<AreaSocial | null>(null);
  readonly apartamentos = signal<Apartamento[]>([]);
  readonly apartamentosCarregando = signal(false);
  readonly buscaApto = signal('');
  readonly reservando = signal(false);
  readonly reservaErro = signal<string | null>(null);
  readonly reservaSucesso = signal(false);
  novaReserva: { id_apartamento: number | null; data: string; horaDe: string; horaAte: string; convidados: number | null } = {
    id_apartamento: null, data: '', horaDe: '', horaAte: '', convidados: null
  };

  // Apartamentos filtrados pela busca digitada no modal de reserva.
  readonly apartamentosFiltrados = computed(() => {
    const q = this.buscaApto().toLowerCase().trim();
    const list = this.apartamentos();
    if (!q) return list;
    return list.filter(a =>
      a.apto.toLowerCase().includes(q) || (a.bloco ?? '').toLowerCase().includes(q)
    );
  });

  // 'cancelado' (dono desistiu) e qualquer status futuro/desconhecido caem
  // aqui: tratamento neutro em vez de herdar a cor vermelha de 'recusado'.
  statusNeutro(status: string): boolean {
    return status !== 'pendente' && status !== 'aprovado' && status !== 'recusado';
  }

  /** Filtro da fila: canceladas e recusadas ficam fora por padrão. */
  readonly filtroReservas = signal<'ativas' | 'pendentes' | 'todas'>('ativas');

  readonly agendamentosVisiveis = computed(() => {
    const f = this.filtroReservas();
    const lista = this.agendamentos();
    if (f === 'todas') return lista;
    if (f === 'pendentes') return lista.filter(a => a.status === 'pendente');
    return lista.filter(a => a.status === 'pendente' || a.status === 'aprovado');
  });

  /** Erro ao excluir um espaço (ex.: reserva ativa ou terminal vinculado). */
  readonly areaErro = signal<string | null>(null);

  /** "Bloco A" para o valor "A" ou "Bloco A" (o cadastro guarda das duas formas). */
  rotuloBloco(bloco: string | null | undefined): string {
    const b = (bloco ?? '').trim();
    if (!b) return '';
    return /^bloco\s/i.test(b) ? b : `Bloco ${b}`;
  }

  readonly pendentesCount = computed(() =>
    this.agendamentos().filter(a => a.status === 'pendente').length
  );

  readonly aprovadasCount = computed(() =>
    this.agendamentos().filter(a => a.status === 'aprovado').length
  );

  readonly ocupacaoTotal = computed(() =>
    this.areas().reduce((acc, a) => acc + (a.tem_monitoramento ? (a.ocupacao ?? 0) : 0), 0)
  );

  readonly areasMonitoradas = computed(() =>
    this.areas().filter(a => a.tem_monitoramento).length
  );

  ngOnInit() {
    this.carregarDados();
    // Recarga silenciosa da lista: outra aba, o síndico no app ou o morador
    // podem ter decidido a reserva enquanto a tela estava aberta.
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (this.loading()) return;
      this.recarregarAgendamentos();
    }, RECARGA_RESERVAS_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  /** Busca só a lista de reservas, sem o spinner da página. */
  recarregarAgendamentos() {
    this.api.listAgendamentos().subscribe({
      next: (ag) => {
        this.agendamentos.set(ag);
        this.recargaErro.set(null);
      },
      // Aviso próprio: não pode cobrir o erro de uma ação que o porteiro precisa ler.
      error: (e) => this.recargaErro.set('Falha ao atualizar as reservas: ' + (e?.error?.message ?? e?.message ?? 'erro')),
    });
  }

  /** Ação recusada pela API (ex.: a reserva já mudou): mostra o motivo e traz o estado real. */
  private falhaNaAcao(e: any) {
    this.acaoErro.set(e?.error?.message ?? e?.message ?? 'Não foi possível concluir a ação.');
    this.recarregarAgendamentos();
  }

  carregarDados() {
    this.loading.set(true);
    this.error.set(null);
    this.api.listAreas().subscribe({
      next: (areas) => {
        this.areas.set(areas);
        this.api.listAgendamentos().subscribe({
          next: (ag) => {
            this.agendamentos.set(ag);
            this.loading.set(false);
          },
          error: (e) => {
            this.loading.set(false);
            this.error.set('Falha ao carregar as reservas: ' + (e?.error?.message ?? e?.message ?? e));
          },
        });
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set('Falha ao carregar as áreas sociais: ' + (e?.error?.message ?? e?.message ?? e));
      },
    });
  }

  alterarStatus(id: number, isAccept: boolean, motivo = '') {
    this.acaoErro.set(null);
    this.api.updateStatus(id, isAccept, motivo).subscribe({
      next: () => {
        // Atualizar lista local na hora
        this.agendamentos.update(list =>
          list.map(item => item.id === id ? { ...item, status: isAccept ? 'aprovado' : 'recusado' } : item)
        );
      },
      error: (e) => this.falhaNaAcao(e),
    });
  }

  // ---- Recusa com motivo (opcional) ----
  readonly recusaAlvo = signal<AgendamentoArea | null>(null);
  motivoRecusa = '';

  abrirRecusa(ag: AgendamentoArea) {
    this.motivoRecusa = '';
    this.recusaAlvo.set(ag);
  }

  fecharRecusa() {
    this.recusaAlvo.set(null);
  }

  confirmarRecusa() {
    const ag = this.recusaAlvo();
    if (!ag) return;
    this.recusaAlvo.set(null);
    this.alterarStatus(ag.id, false, this.motivoRecusa.trim());
  }

  // ---- Horário da reserva (a lista traz dd/mm/aaaa + HH:mm, no relógio do condomínio) ----
  private diaDaReserva(ag: AgendamentoArea): [number, number, number] | null {
    const [d, m, a] = (ag.data ?? '').split('/').map(Number);
    return d && m && a ? [a, m - 1, d] : null;
  }

  /** O horário da reserva já terminou: não faz sentido cancelar nem confirmar. */
  reservaJaTerminou(ag: AgendamentoArea): boolean {
    const dia = this.diaDaReserva(ag);
    if (!dia) return false;
    const [h, min] = (ag.horaAte || '00:00').split(':').map(Number);
    // Término "00:00" é a meia-noite do fim do dia, não o começo.
    const fim = !h && !min ? new Date(dia[0], dia[1], dia[2] + 1) : new Date(dia[0], dia[1], dia[2], h || 0, min || 0);
    return fim.getTime() <= Date.now();
  }

  private reservaEhHoje(ag: AgendamentoArea): boolean {
    const dia = this.diaDaReserva(ag);
    const hoje = new Date();
    return !!dia && dia[0] === hoje.getFullYear() && dia[1] === hoje.getMonth() && dia[2] === hoje.getDate();
  }

  /** Aprovada de hoje, em área com confirmação obrigatória, ainda sem confirmar. */
  aguardandoConfirmacao(ag: AgendamentoArea): boolean {
    return ag.status === 'aprovado' && !!ag.exige_confirmacao && !ag.confirmada_em
      && this.reservaEhHoje(ag) && !this.reservaJaTerminou(ag);
  }

  confirmarPresenca(id: number) {
    this.acaoErro.set(null);
    this.api.confirmar(id).subscribe({
      next: () => {
        const agora = new Date().toISOString();
        this.agendamentos.update(list => list.map(item => item.id === id ? { ...item, confirmada_em: agora } : item));
      },
      error: (e) => this.falhaNaAcao(e),
    });
  }

  async cancelarReserva(id: number) {
    const ok = await this.confirm.ask({
      title: 'Cancelar reserva',
      message: 'A reserva será cancelada e o horário ficará livre novamente. O morador verá a reserva como cancelada.',
      confirmLabel: 'Cancelar reserva',
      variant: 'danger',
    });
    if (!ok) return;
    this.acaoErro.set(null);
    this.api.cancelar(id, 'Cancelada pela administração').subscribe({
      next: () => {
        this.agendamentos.update(list => list.map(item => item.id === id ? { ...item, status: 'cancelado' } : item));
      },
      error: (e) => this.falhaNaAcao(e),
    });
  }

  async excluirArea(id: number) {
    const ok = await this.confirm.ask({
      title: 'Excluir espaço',
      message: 'O espaço será removido com o histórico de reservas. Reservas por acontecer precisam ser canceladas antes.',
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    this.areaErro.set(null);
    this.api.removeArea(id).subscribe({
      next: () => this.areas.update(list => list.filter(a => a.id !== id)),
      error: (e) => this.areaErro.set(e?.error?.message ?? e?.message ?? 'Não foi possível excluir o espaço.'),
    });
  }

  abrirModalArea() {
    this.areaEditando.set(null);
    this.novaArea = { nome: '', capacidade: null, imagem: '', agendar: true, autorizacao: true, exige_confirmacao: false, regras: '' };
    this.fotoPreview.set(null);
    this.fotoNome.set(null);
    this.fotoErro.set(null);
    this.modoUrl.set(false);
    this.salvando.set(false);
    this.modalAberto.set(true);
  }

  abrirModalEditarArea(area: AreaSocial) {
    this.areaEditando.set(area);
    this.novaArea = {
      id: area.id,
      nome: area.nome,
      capacidade: area.capacidade || null,
      limite_mensal_apto: area.limite_mensal_apto || null,
      imagem: area.imagem || '',
      agendar: area.precisa_agendar === 1,
      autorizacao: area.precisa_autorizacao === 1,
      exige_confirmacao: area.exige_confirmacao === 1,
      regras: area.regras || ''
    };
    this.fotoPreview.set(area.imagem || null);
    this.fotoNome.set(area.imagem ? 'Imagem Atual' : null);
    this.fotoErro.set(null);
    const isUrl = !!area.imagem && area.imagem.startsWith('http');
    this.modoUrl.set(isUrl);
    this.salvando.set(false);
    this.modalAberto.set(true);
  }

  fecharModal() {
    this.modalAberto.set(false);
    this.areaEditando.set(null);
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
      ...(this.areaEditando() ? { id: this.areaEditando()?.id } : {}),
      nome: this.novaArea.nome,
      capacidade: this.novaArea.capacidade,
      limite_mensal_apto: this.novaArea.limite_mensal_apto || null,
      imagem: this.novaArea.imagem || 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600',
      agendar: this.novaArea.agendar ? 1 : 0,
      autorizacao: this.novaArea.autorizacao ? 1 : 0,
      exige_confirmacao: this.novaArea.exige_confirmacao ? 1 : 0,
      regras: this.novaArea.regras || '',
      // Edição: devolve a grade que veio do backend (o get-all agora manda
      // `horarios`). Se por algum motivo ela não vier, a chave é OMITIDA — a
      // API preserva a coluna quando o campo está ausente. Nunca mandar o
      // default de 08:00–22:00 numa edição: isso apagava a grade real da área.
      // Criação: aí sim o default faz sentido, a área ainda não tem grade.
      ...(this.areaEditando()
        ? (this.areaEditando()?.horarios ? { horarios: this.areaEditando()?.horarios } : {})
        : {
            horarios: Array.from({ length: 7 }).map(() => ({
              horarios: [{ horarioDe: '08:00', horarioAte: '22:00' }],
            })),
          }),
      // `precisa_pagamento` não é editável nesta tela: a chave fica de fora
      // para a API manter o valor já configurado (antes ela era gravada como
      // 0 a cada salvamento, desligando a cobrança sem ninguém pedir).
    };

    const request = this.areaEditando()
      ? this.api.updateArea(payload)
      : this.api.insertArea(payload);

    request.subscribe({
      next: () => {
        this.salvando.set(false);
        this.fecharModal();
        this.carregarDados();
      },
      error: (e) => {
        this.salvando.set(false);
        this.fotoErro.set(`Falha ao salvar: ${e?.error?.message ?? e?.message ?? 'erro'}`);
      },
    });
  }

  // ==========================================
  // RESERVA EM NOME DO MORADOR (síndico/porteiro)
  // ==========================================
  abrirModalReserva(area: AreaSocial) {
    this.areaReserva.set(area);
    this.novaReserva = { id_apartamento: null, data: '', horaDe: '', horaAte: '', convidados: null };
    this.buscaApto.set('');
    this.reservaErro.set(null);
    this.reservaSucesso.set(false);
    this.reservando.set(false);
    this.modalReserva.set(true);

    // Agenda da área: mostra no modal o que já ocupa o dia escolhido, em vez de
    // o funcionário só descobrir o conflito ao confirmar.
    this.agendaArea.set([]);
    this.agendaErro.set(null);
    this.api.getArea(area.id).subscribe({
      next: (d) => this.agendaArea.set(Array.isArray(d?.agendamentos) ? d.agendamentos : []),
      error: (e) => this.agendaErro.set(
        'Não foi possível carregar os horários ocupados: ' + (e?.error?.message ?? e?.message ?? 'erro'),
      ),
    });

    // Carrega a lista de apartamentos só na primeira abertura.
    if (this.apartamentos().length === 0) {
      this.apartamentosCarregando.set(true);
      this.apartamentosApi.list().subscribe({
        next: (list) => {
          this.apartamentos.set(list);
          this.apartamentosCarregando.set(false);
        },
        error: () => {
          this.apartamentosCarregando.set(false);
          this.reservaErro.set('Não foi possível carregar os apartamentos.');
        },
      });
    }
  }

  fecharModalReserva() {
    this.modalReserva.set(false);
  }

  /** Reservas da área (do `get`), com data dd/mm/aaaa. */
  readonly agendaArea = signal<{ data: string; horaDe: string; horaAte: string; status: string; bloco?: string; apto?: string }[]>([]);
  readonly agendaErro = signal<string | null>(null);

  /** Pendentes e aprovadas no dia escolhido no modal (as que ocupam o horário). */
  ocupadosNoDia() {
    const data = this.novaReserva.data; // YYYY-MM-DD
    if (!data) return [];
    const [a, m, d] = data.split('-');
    const dataBr = `${d}/${m}/${a}`;
    return this.agendaArea()
      .filter(x => x.data === dataBr && (x.status === 'pendente' || x.status === 'aprovado'))
      .sort((x, y) => x.horaDe.localeCompare(y.horaDe));
  }

  selecionarApto(id: number) {
    this.novaReserva.id_apartamento = id;
  }

  // ---- Predefinições de data ----
  /** Atalhos de data: 0 = hoje, 1 = amanhã, ou próximo sábado. */
  private toInputDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dia}`;
  }

  definirDataRelativa(diasAdiante: number) {
    const d = new Date();
    d.setDate(d.getDate() + diasAdiante);
    this.novaReserva.data = this.toInputDate(d);
  }

  /** Próximo sábado (se hoje for sábado, pega o da semana seguinte). */
  definirProximoSabado() {
    const d = new Date();
    const diff = (6 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    this.novaReserva.data = this.toInputDate(d);
  }

  /** Marca o chip de data relativa ativo (compara com hoje/amanhã/etc). */
  dataRelativaAtiva(diasAdiante: number): boolean {
    const d = new Date();
    d.setDate(d.getDate() + diasAdiante);
    return this.novaReserva.data === this.toInputDate(d);
  }

  // ---- Predefinições de horário ----
  /** Períodos prontos mais usados para reserva de espaços. */
  readonly periodosPreset: { label: string; de: string; ate: string }[] = [
    { label: 'Manhã', de: '08:00', ate: '12:00' },
    { label: 'Tarde', de: '14:00', ate: '18:00' },
    { label: 'Noite', de: '18:00', ate: '22:00' },
    { label: 'Dia todo', de: '08:00', ate: '22:00' },
  ];

  definirPeriodo(de: string, ate: string) {
    this.novaReserva.horaDe = de;
    this.novaReserva.horaAte = ate;
  }

  periodoAtivo(de: string, ate: string): boolean {
    return this.novaReserva.horaDe === de && this.novaReserva.horaAte === ate;
  }

  /** A partir do início escolhido, define o término somando X horas. */
  definirDuracao(horas: number) {
    const inicio = this.novaReserva.horaDe || '08:00';
    this.novaReserva.horaDe = inicio;
    const fim = Math.min(this.minutos(inicio) + horas * 60, 23 * 60 + 59);
    const h = String(Math.floor(fim / 60)).padStart(2, '0');
    const m = String(fim % 60).padStart(2, '0');
    this.novaReserva.horaAte = `${h}:${m}`;
  }

  /** Valida o formulário de reserva antes de habilitar o envio. */
  reservaValida(): boolean {
    const r = this.novaReserva;
    if (!r.id_apartamento || !r.data || !r.horaDe || !r.horaAte) return false;
    // hora fim deve ser maior que hora início
    return this.minutos(r.horaAte) > this.minutos(r.horaDe) && !this.reservaNoPassado();
  }

  /** Data de hoje no formato do input (limite mínimo do calendário). */
  hojeInput(): string {
    return this.toInputDate(new Date());
  }

  /** Dia anterior a hoje, ou hoje com término já passado. */
  reservaNoPassado(): boolean {
    const r = this.novaReserva;
    if (!r.data) return false;
    const hoje = this.hojeInput();
    if (r.data < hoje) return true;
    if (r.data > hoje || !r.horaAte) return false;
    const agora = new Date();
    return this.minutos(r.horaAte) <= agora.getHours() * 60 + agora.getMinutes();
  }

  private minutos(hhmm: string): number {
    const [h, m] = (hhmm ?? '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  salvarReserva() {
    if (this.reservando() || !this.reservaValida()) return;
    const area = this.areaReserva();
    if (!area) return;

    this.reservando.set(true);
    this.reservaErro.set(null);

    // O input nativo entrega YYYY-MM-DD; o backend espera DD/MM/YYYY.
    const [ano, mes, dia] = this.novaReserva.data.split('-');
    const dataBr = `${dia}/${mes}/${ano}`;

    const payload = {
      id_area_social: area.id,
      id_apartamento: this.novaReserva.id_apartamento,
      data: dataBr,                        // DD/MM/YYYY
      horaDe: this.novaReserva.horaDe,     // HH:mm
      horaAte: this.novaReserva.horaAte,   // HH:mm
      convidados: this.novaReserva.convidados || null,
    };

    this.api.insertAgendamento(payload).subscribe({
      next: () => {
        this.reservando.set(false);
        this.reservaSucesso.set(true);
        this.carregarDados();
        // Fecha após um instante mostrando o sucesso.
        setTimeout(() => this.modalReserva.set(false), 1200);
      },
      error: (e) => {
        this.reservando.set(false);
        this.reservaErro.set(e?.error?.message ?? e?.message ?? 'Falha ao criar a reserva.');
      },
    });
  }
}
