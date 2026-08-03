import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgendamentoArea, AreaSocial, AreasSociaisApi } from './areas-sociais.service';
import { ApartamentosApi, Apartamento } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';

@Component({
  selector: 'app-areas-sociais-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './areas-sociais-page.component.html',
})
export class AreasSociaisPageComponent implements OnInit {
  private api = inject(AreasSociaisApi);
  private apartamentosApi = inject(ApartamentosApi);
  private confirm = inject(ConfirmService);

  readonly areas = signal<AreaSocial[]>([]);
  readonly agendamentos = signal<AgendamentoArea[]>([]);
  readonly loading = signal(true);
  readonly tab = signal<'areas' | 'reservas'>('areas');

  // Controle do Modal
  readonly modalAberto = signal(false);
  novaArea: any = { nome: '', capacidade: null, imagem: '', agendar: true, autorizacao: true };
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
  novaReserva: { id_apartamento: number | null; data: string; horaDe: string; horaAte: string } = {
    id_apartamento: null, data: '', horaDe: '', horaAte: ''
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
    this.areaEditando.set(null);
    this.novaArea = { nome: '', capacidade: null, imagem: '', agendar: true, autorizacao: true };
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
      imagem: area.imagem || '',
      agendar: area.precisa_agendar === 1,
      autorizacao: area.precisa_autorizacao === 1
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
      imagem: this.novaArea.imagem || 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600',
      agendar: this.novaArea.agendar ? 1 : 0,
      autorizacao: this.novaArea.autorizacao ? 1 : 0,
      horarios: this.areaEditando()?.horarios || Array.from({ length: 7 }).map(() => ({
        horarios: [{ horarioDe: '08:00', horarioAte: '22:00' }]
      }))
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
    this.novaReserva = { id_apartamento: null, data: '', horaDe: '', horaAte: '' };
    this.buscaApto.set('');
    this.reservaErro.set(null);
    this.reservaSucesso.set(false);
    this.reservando.set(false);
    this.modalReserva.set(true);

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
    return this.minutos(r.horaAte) > this.minutos(r.horaDe);
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
