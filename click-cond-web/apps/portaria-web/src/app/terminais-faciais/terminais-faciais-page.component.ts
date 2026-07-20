import { Component, OnDestroy, OnInit, inject, signal, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CreateTerminalFacial,
  FacialSyncStatus,
  SyncPessoa,
  TerminaisFaciaisApi,
  TerminalFacial,
} from './terminais-faciais.service';
import { AreaSocial, AreasSociaisApi } from '../areas-sociais/areas-sociais.service';

@Component({
  selector: 'app-terminais-faciais-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './terminais-faciais-page.component.html',
})
export class TerminaisFaciaisPageComponent implements OnInit, OnDestroy {
  @Input() embedded = false;
  private api = inject(TerminaisFaciaisApi);
  private areasApi = inject(AreasSociaisApi);
  private statusInterval?: ReturnType<typeof setInterval>;

  // Áreas de lazer do condomínio, para vincular um terminal a uma área
  // (contador de ocupação). Vazio = nenhuma área cadastrada.
  readonly areasSociais = signal<AreaSocial[]>([]);

  readonly loading = signal(false);
  readonly terminais = signal<TerminalFacial[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly testingId = signal<number | null>(null);
  readonly statusMap = signal<Record<number, boolean | null>>({});

  // Sincronização em massa de rostos (back-fill)
  readonly syncing = signal(false);
  readonly cleaning = signal(false);
  readonly syncStatus = signal<FacialSyncStatus | null>(null);
  // Filtro de categoria (vazio = todas). Terminais selecionados (vazio = todos).
  readonly categoriasSync = signal<Set<string>>(new Set());
  readonly terminaisSync = signal<Set<number>>(new Set());
  // Lista por pessoa (quem está pendente/erro e por quê) + visibilidade.
  readonly pessoas = signal<SyncPessoa[]>([]);
  readonly mostrarPessoas = signal(false);
  readonly retryingPessoa = signal<string | null>(null);

  // Estimativa de tempo restante (ETA)
  private syncStartTime: number | null = null;
  private initialPending: number | null = null;
  readonly etaText = signal<string | null>(null);

  // Ciclo de vida da barra de progresso (independente do flag "running" do
  // backend). Mantém o painel visível do clique até um breve estado de
  // "Concluído" em 100%, evitando que a barra apareça e suma bruscamente.
  readonly progressVisible = signal(false);
  readonly progressDone = signal(false);
  readonly displayPercent = signal(0);
  private sawRunning = false;
  private hideProgressTimer?: ReturnType<typeof setTimeout>;

  // Preview de Câmera em tempo real
  readonly viewingCameraTerminal = signal<TerminalFacial | null>(null);
  readonly cameraLiveUrl = signal<string | null>(null);
  readonly cameraPreviewUrl = signal<string | null>(null);
  readonly cameraLiveFailed = signal(false);
  readonly cameraError = signal<string | null>(null);
  readonly cameraLoading = signal(false);
  private cameraActive = false;

  readonly categoriasDisponiveis = [
    { id: 'morador', label: 'Moradores' },
    { id: 'visitante', label: 'Visitantes' },
    { id: 'prestador', label: 'Prestadores' },
    { id: 'funcionario', label: 'Funcionários' },
  ];

  toggleCategoriaSync(cat: string) {
    const s = new Set(this.categoriasSync());
    s.has(cat) ? s.delete(cat) : s.add(cat);
    this.categoriasSync.set(s);
  }

  toggleTerminalSync(id: number) {
    const s = new Set(this.terminaisSync());
    s.has(id) ? s.delete(id) : s.add(id);
    this.terminaisSync.set(s);
  }

  get syncProgressPercentage(): number {
    const s = this.syncStatus();
    if (!s) return 0;
    const total = s.synced + s.pending + s.error;
    if (total === 0) return 0;
    return Math.round(((total - s.pending) / total) * 100);
  }

  // Agente: chave do condomínio + download do executável/config
  readonly agentToken = signal<string | null>(null);
  readonly agentDownloadUrl = signal<string | null>(null);
  readonly baixando = signal<string | null>(null);

  get isAgentOnline(): boolean {
    return this.terminais().some((t) => t.agent_online);
  }

  // Modal
  readonly showModal = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly saving = signal(false);
  readonly triggeringId = signal<number | null>(null);

  form: CreateTerminalFacial = this.emptyForm();

  // Define quais campos e fabricantes fazem sentido por tipo de dispositivo.
  // Mantém o form coerente: terminal facial precisa de credenciais e fabricantes
  // específicos; botoeira simples geralmente é HTTP plain sem auth.
  readonly tiposDispositivo = [
    {
      value: 'facial',
      label: 'Terminal Facial',
      hint: 'Reconhece pessoas por biometria e dispara o acesso quando identifica um rosto cadastrado.',
      requerAuth: true,
      fabricantes: [
        { value: 'control_id', label: 'Control iD' },
        { value: 'intelbras', label: 'Intelbras' },
        { value: 'zkteco', label: 'ZKTeco' },
        { value: 'outro', label: 'Outro' },
      ],
      modeloPlaceholder: 'Ex: iDFace 373',
    },
    {
      value: 'botoeira',
      label: 'Botoeira Relé IP',
      hint: 'Aciona um relé via HTTP para abrir porta ou destravar trinco. Geralmente sem autenticação na LAN.',
      requerAuth: false,
      fabricantes: [
        { value: 'control_id', label: 'Control iD' },
        { value: 'intelbras', label: 'Intelbras' },
        { value: 'hikvision', label: 'HikVision' },
        { value: 'genérico', label: 'Genérico HTTP' },
        { value: 'outro', label: 'Outro' },
      ],
      modeloPlaceholder: 'Ex: ITC-100/IP',
    },
    {
      value: 'catraca',
      label: 'Catraca Eletrônica IP',
      hint: 'Aciona a liberação da catraca. Tipicamente HTTP autenticado no fabricante específico.',
      requerAuth: true,
      fabricantes: [
        { value: 'control_id', label: 'Control iD' },
        { value: 'intelbras', label: 'Intelbras' },
        { value: 'hikvision', label: 'HikVision' },
        { value: 'henry', label: 'Henry' },
        { value: 'topdata', label: 'Topdata' },
        { value: 'outro', label: 'Outro' },
      ],
      modeloPlaceholder: 'Ex: Catraca Henry Pulsar',
    },
    {
      value: 'tag_reader',
      label: 'Leitor de Tags RFID',
      hint: 'Lê tags Mifare/EM-Marin e envia o UID via webhook. Identifica pela coluna tag_rfid do morador.',
      requerAuth: false,
      fabricantes: [
        { value: 'hid', label: 'HID' },
        { value: 'control_id', label: 'Control iD' },
        { value: 'intelbras', label: 'Intelbras' },
        { value: 'genérico', label: 'Genérico (Wiegand→IP)' },
        { value: 'outro', label: 'Outro' },
      ],
      modeloPlaceholder: 'Ex: HID iCLASS R10',
    },
    {
      value: 'qrcode_reader',
      label: 'Leitor de QR Code',
      hint: 'Lê o código QR do morador via app e envia via webhook. Identifica pela coluna qrcode_acesso.',
      requerAuth: false,
      fabricantes: [
        { value: 'genérico', label: 'Genérico' },
        { value: 'control_id', label: 'Control iD' },
        { value: 'intelbras', label: 'Intelbras' },
        { value: 'outro', label: 'Outro' },
      ],
      modeloPlaceholder: 'Ex: Leitor QR USB→IP',
    },
  ] as const;

  get tipoSelecionado() {
    return (
      this.tiposDispositivo.find((t) => t.value === this.form.tipo) ??
      this.tiposDispositivo[0]
    );
  }

  /**
   * Chamado quando o operador troca o tipo no dropdown. Reajusta o
   * fabricante para o primeiro válido daquele tipo, evitando que sobre uma
   * combinação inconsistente (ex: tipo=botoeira + fabricante=zkteco).
   */
  onTipoChange() {
    const tipoCfg = this.tipoSelecionado;
    const fabricanteAtualValido = tipoCfg.fabricantes.some(
      (f) => f.value === this.form.fabricante,
    );
    if (!fabricanteAtualValido) {
      this.form.fabricante = tipoCfg.fabricantes[0].value;
    }
    // Se o tipo novo não precisa de auth, limpa pra não enviar credenciais
    // antigas sem querer.
    if (!tipoCfg.requerAuth) {
      this.form.api_user = '';
      this.form.api_password = '';
    }
  }

  ngOnInit(): void {
    this.load();
    this.loadAreasSociais();
    this.loadSyncStatus();
    this.loadAgentInfo();
    // Atualiza o status online/offline dos aparelhos a cada 15s (silencioso),
    // refletindo o heartbeat do agente sem o operador clicar "Testar Conexão".
    this.statusInterval = setInterval(() => this.load(true), 15_000);
  }

  ngOnDestroy(): void {
    if (this.statusInterval) clearInterval(this.statusInterval);
    if (this.hideProgressTimer) clearTimeout(this.hideProgressTimer);
  }

  loadSyncStatus() {
    this.api.syncStatus().subscribe({
      next: (s) => this.syncStatus.set(s),
      error: () => this.syncStatus.set(null),
    });
  }

  loadAgentInfo() {
    this.api.agentInfo().subscribe({
      next: (i) => {
        this.agentToken.set(i.agent_token);
        this.agentDownloadUrl.set(i.download_url);
      },
      error: () => {},
    });
  }

  /** Baixa a configuração do agente (.env ou instalar.bat) já personalizada. */
  baixarConfig(format: 'env' | 'bat') {
    this.baixando.set(format);
    this.api.downloadAgentConfig(format).subscribe({
      next: (blob) => {
        this.baixando.set(null);
        const nome = format === 'bat' ? 'instalar-agente.bat' : '.env';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nome;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.baixando.set(null);
        this.errorMessage.set('Falha ao gerar a configuração do agente.');
        setTimeout(() => this.errorMessage.set(null), 4000);
      },
    });
  }

  copiarChave() {
    const t = this.agentToken();
    if (!t) return;
    navigator.clipboard?.writeText(t);
    this.successMessage.set('Chave do agente copiada.');
    setTimeout(() => this.successMessage.set(null), 3000);
  }

  /**
   * Envia todos os rostos já cadastrados para os terminais faciais (back-fill).
   * Roda em segundo plano no servidor; aqui só dispara e acompanha o status.
   */
  /** Abre o painel de progresso e zera o estado da barra. */
  private startProgress() {
    if (this.hideProgressTimer) clearTimeout(this.hideProgressTimer);
    this.sawRunning = false;
    this.progressDone.set(false);
    this.displayPercent.set(0);
    this.progressVisible.set(true);
  }

  /** Esconde o painel imediatamente (sem estado de conclusão). */
  private hideProgress() {
    if (this.hideProgressTimer) clearTimeout(this.hideProgressTimer);
    this.progressVisible.set(false);
    this.progressDone.set(false);
  }

  syncAllRostos() {
    this.syncing.set(true);
    this.errorMessage.set(null);
    this.startProgress();
    const cats = Array.from(this.categoriasSync());
    const ids = Array.from(this.terminaisSync());
    this.api.syncAll(cats, ids).subscribe({
      next: (r) => {
        this.syncing.set(false);
        if (r.skipped) {
          this.hideProgress();
          this.errorMessage.set(
            r.reason === 'no_facial_devices'
              ? 'Cadastre um terminal facial antes de sincronizar.'
              : 'Sincronização desativada.',
          );
          setTimeout(() => this.errorMessage.set(null), 5000);
          return;
        }
        if (r.alreadyRunning) {
          this.successMessage.set('Sincronização já está em andamento.');
        } else if (!r.total) {
          // Nada a fazer: não há o que acompanhar, fecha o painel.
          this.hideProgress();
          this.successMessage.set(
            'Nenhum rosto pendente — tudo já sincronizado.',
          );
        } else {
          this.successMessage.set(
            `Enviando ${r.total} rosto(s) para o(s) terminal(is)… acompanhe o progresso abaixo.`,
          );
        }
        setTimeout(() => this.successMessage.set(null), 6000);
        // Acompanha o progresso por alguns ciclos.
        this.pollSyncStatus();
      },
      error: (err) => {
        this.syncing.set(false);
        this.hideProgress();
        this.errorMessage.set(
          err?.error?.message ?? 'Falha ao sincronizar rostos.',
        );
        setTimeout(() => this.errorMessage.set(null), 5000);
      },
    });
  }

  unsyncAllRostos() {
    this.cleaning.set(true);
    this.errorMessage.set(null);
    this.startProgress();
    const cats = Array.from(this.categoriasSync());
    const ids = Array.from(this.terminaisSync());
    this.api.unsyncAll(cats, ids).subscribe({
      next: (r) => {
        this.cleaning.set(false);
        if (r.skipped) {
          this.hideProgress();
          this.errorMessage.set(
            r.reason === 'no_facial_devices'
              ? 'Nenhum terminal facial ativo encontrado.'
              : 'Remoção desativada.',
          );
          setTimeout(() => this.errorMessage.set(null), 5000);
          return;
        }
        if (r.alreadyRunning) {
          this.successMessage.set('Uma operação de sincronização/limpeza já está em andamento.');
        } else if (!r.total) {
          this.hideProgress();
          this.successMessage.set(
            'Nenhum rosto cadastrado no banco para remover.',
          );
        } else {
          this.successMessage.set(
            `Removendo ${r.total} rosto(s) do(s) terminal(is)… acompanhe o progresso abaixo.`,
          );
        }
        setTimeout(() => this.successMessage.set(null), 6000);
        this.pollSyncStatus();
      },
      error: (err) => {
        this.cleaning.set(false);
        this.hideProgress();
        this.errorMessage.set(
          err?.error?.message ?? 'Falha ao remover rostos.',
        );
        setTimeout(() => this.errorMessage.set(null), 5000);
      },
    });
  }

  /** Atualiza o status a cada ~1,2s enquanto o back-fill estiver rodando. */
  private pollSyncStatus(restantes = 200) {
    this.api.syncStatus().subscribe({
      next: (s) => {
        this.syncStatus.set(s);
        if (this.mostrarPessoas()) this.loadPessoas();

        if (s.running) {
          this.sawRunning = true;
          this.displayPercent.set(this.syncProgressPercentage);
          // Inicializa variáveis do cálculo de ETA se acabou de iniciar
          if (this.syncStartTime === null) {
            this.syncStartTime = Date.now();
            this.initialPending = s.pending;
            this.etaText.set('Calculando tempo restante...');
          } else {
            // Calcula progresso e taxa de transferência
            const elapsedMs = Date.now() - this.syncStartTime;
            const processed = (this.initialPending ?? 0) - s.pending;

            if (processed > 0 && elapsedMs > 1000) {
              const ratePerMs = processed / elapsedMs;
              const remainingMs = s.pending / ratePerMs;
              const remainingSeconds = Math.ceil(remainingMs / 1000);

              if (remainingSeconds <= 0) {
                this.etaText.set('Concluindo...');
              } else if (remainingSeconds < 60) {
                this.etaText.set(`Tempo restante: ~${remainingSeconds}s`);
              } else {
                const mins = Math.floor(remainingSeconds / 60);
                const secs = remainingSeconds % 60;
                this.etaText.set(`Tempo restante: ~${mins} min ${secs}s`);
              }
            } else {
              this.etaText.set('Calculando tempo restante...');
            }
          }
        } else {
          // Reseta variáveis do cálculo de ETA se terminou
          this.syncStartTime = null;
          this.initialPending = null;
        }

        // Agendamento do próximo ciclo / encerramento do painel.
        if (s.running && restantes > 0) {
          setTimeout(() => this.pollSyncStatus(restantes - 1), 1200);
        } else if (!s.running) {
          if (this.sawRunning) {
            // Terminou de verdade: segura em 100% "Concluído" por um instante.
            this.finishProgress();
          } else if (restantes > 195) {
            // Pode ainda não ter iniciado no backend; espera alguns ciclos.
            setTimeout(() => this.pollSyncStatus(restantes - 1), 1200);
          } else {
            // Não iniciou após várias tentativas: fecha silenciosamente.
            this.hideProgress();
            this.syncing.set(false);
            this.cleaning.set(false);
          }
        }
      },
      error: () => {},
    });
  }

  /** Segura a barra em 100% com selo de "Concluído" e fecha suavemente. */
  private finishProgress() {
    this.displayPercent.set(100);
    this.progressDone.set(true);
    this.etaText.set(null);
    this.syncStartTime = null;
    this.initialPending = null;
    if (this.hideProgressTimer) clearTimeout(this.hideProgressTimer);
    this.hideProgressTimer = setTimeout(() => {
      this.progressVisible.set(false);
      this.progressDone.set(false);
      this.syncing.set(false);
      this.cleaning.set(false);
      // Recarrega os contadores finais (enviados/erros/sem foto).
      this.loadSyncStatus();
    }, 2600);
  }

  /** Mostra/oculta a lista por pessoa e carrega quando abre. */
  togglePessoas() {
    const novo = !this.mostrarPessoas();
    this.mostrarPessoas.set(novo);
    if (novo) this.loadPessoas();
  }

  loadPessoas() {
    this.api.syncPessoas().subscribe({
      next: (l) => this.pessoas.set(l),
      error: () => this.pessoas.set([]),
    });
  }

  /** Re-tenta o envio de UMA pessoa (ex.: depois de trocar a foto). */
  retryPessoa(p: SyncPessoa) {
    const key = `${p.tipo}_${p.id}`;
    this.retryingPessoa.set(key);
    const obs =
      p.tipo === 'morador'
        ? this.api.syncMorador(p.id)
        : this.api.syncVisitante(p.id);
    obs.subscribe({
      next: () => {
        this.retryingPessoa.set(null);
        this.loadPessoas();
        this.api.syncStatus().subscribe((s) => this.syncStatus.set(s));
      },
      error: () => {
        this.retryingPessoa.set(null);
        this.loadPessoas();
      },
    });
  }

  /** Label legível da categoria. */
  labelCategoria(cat: string): string {
    return (
      { morador: 'Morador', funcionario: 'Funcionário', visitante: 'Visitante', prestador: 'Prestador' }[
        cat
      ] ?? cat
    );
  }

  private emptyForm(): CreateTerminalFacial {
    return {
      nome: '',
      tipo: 'facial',
      sentido: 'auto',
      confianca_minima: 0,
      fabricante: 'control_id',
      modelo: '',
      ip: '',
      porta: 80,
      api_user: '',
      api_password: '',
      id_area_social: null,
      controle_acesso_facial: false,
    };
  }

  loadAreasSociais() {
    this.areasApi.listAreas().subscribe({
      next: (list) => this.areasSociais.set(list ?? []),
      error: () => this.areasSociais.set([]),
    });
  }

  // Botoeira é só acionador (não identifica pessoa), então sentido não se aplica.
  get mostrarSentido(): boolean {
    return this.form.tipo !== 'botoeira';
  }

  // Vincular a uma área de lazer só faz sentido em terminais que identificam
  // pessoas (facial/catraca) — botoeira não conta ocupação.
  get mostrarArea(): boolean {
    return this.form.tipo !== 'botoeira';
  }

  // Confiança mínima só faz sentido em reconhecimento facial.
  get mostrarConfianca(): boolean {
    return this.form.tipo === 'facial';
  }

  load(silent = false) {
    if (!silent) this.loading.set(true);
    this.api.list().subscribe({
      next: (list) => {
        this.terminais.set(list);
        // Status automático do aparelho: vem do heartbeat do agente
        // (device_online). Se ainda é desconhecido (null) mas o operador testou
        // manualmente, preserva o resultado do teste.
        this.statusMap.update((m) => {
          const next = { ...m };
          for (const t of list) {
            if (t.device_online === true || t.device_online === false) {
              next[t.id] = t.device_online;
            } else if (next[t.id] === undefined) {
              next[t.id] = null;
            }
          }
          return next;
        });
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        if (!silent) {
          this.errorMessage.set(
            err?.error?.message ?? 'Falha ao carregar terminais.',
          );
        }
      },
    });
  }

  openCreate() {
    this.editingId.set(null);
    this.form = this.emptyForm();
    this.showModal.set(true);
  }

  openEdit(t: TerminalFacial) {
    this.editingId.set(t.id);
    this.form = {
      nome: t.nome,
      tipo: t.tipo || 'facial',
      sentido: t.sentido || 'auto',
      confianca_minima: t.confianca_minima ?? 0,
      fabricante: t.fabricante,
      modelo: t.modelo ?? '',
      ip: t.ip,
      porta: t.porta,
      api_user: t.api_user ?? '',
      api_password: '',
      id_area_social: t.id_area_social ?? null,
      controle_acesso_facial: t.controle_acesso_facial === 1,
    };
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
    this.editingId.set(null);
  }

  save() {
    if (!this.form.nome || !this.form.ip) {
      this.errorMessage.set('Nome e IP são obrigatórios.');
      return;
    }
    // Tipos que exigem auth (facial/catraca) precisam de usuário e senha — sem
    // eles o terminal recusa as chamadas (401). Na edição, senha em branco
    // significa "manter a atual", então só cobramos no cadastro.
    if (this.tipoSelecionado.requerAuth) {
      const senhaObrigatoria = this.editingId() == null;
      if (
        !this.form.api_user ||
        (senhaObrigatoria && !this.form.api_password)
      ) {
        this.errorMessage.set(
          'Usuário e senha da API são obrigatórios para este tipo de dispositivo.',
        );
        return;
      }
    }
    this.saving.set(true);
    this.errorMessage.set(null);

    const payload: CreateTerminalFacial = {
      nome: this.form.nome,
      tipo: this.form.tipo || 'facial',
      sentido: this.mostrarSentido ? this.form.sentido || 'auto' : 'auto',
      confianca_minima: this.mostrarConfianca
        ? Number(this.form.confianca_minima) || 0
        : 0,
      fabricante: this.form.fabricante,
      modelo: this.form.modelo || undefined,
      ip: this.form.ip,
      porta: Number(this.form.porta) || 80,
      api_user: this.form.api_user || undefined,
      api_password: this.form.api_password || undefined,
      id_area_social: this.mostrarArea
        ? (this.form.id_area_social ? Number(this.form.id_area_social) : null)
        : null,
      // Só faz sentido com área vinculada; sem área, sempre 0.
      controle_acesso_facial:
        this.mostrarArea && this.form.id_area_social
          ? !!this.form.controle_acesso_facial
          : false,
    };

    const id = this.editingId();
    const obs =
      id != null ? this.api.update(id, payload) : this.api.create(payload);
    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.successMessage.set(
          id != null ? 'Dispositivo atualizado.' : 'Dispositivo cadastrado.',
        );
        setTimeout(() => this.successMessage.set(null), 4000);
        this.closeModal();
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMessage.set(err?.error?.message ?? 'Falha ao salvar.');
      },
    });
  }

  remove(t: TerminalFacial) {
    if (!confirm(`Remover o dispositivo "${t.nome}"?`)) return;
    this.api.remove(t.id).subscribe({
      next: () => {
        this.successMessage.set('Dispositivo removido.');
        setTimeout(() => this.successMessage.set(null), 4000);
        this.load();
      },
      error: (err) =>
        this.errorMessage.set(err?.error?.message ?? 'Falha ao remover.'),
    });
  }

  trigger(t: TerminalFacial) {
    this.triggeringId.set(t.id);
    this.errorMessage.set(null);
    this.api.trigger(t.id).subscribe({
      next: () => {
        this.triggeringId.set(null);
        this.successMessage.set(
          `Dispositivo "${t.nome}" acionado com sucesso.`,
        );
        setTimeout(() => this.successMessage.set(null), 4000);
      },
      error: (err) => {
        this.triggeringId.set(null);
        this.errorMessage.set(
          err?.error?.message ?? 'Falha ao acionar dispositivo.',
        );
        setTimeout(() => this.errorMessage.set(null), 4000);
      },
    });
  }

  test(t: TerminalFacial) {
    this.testingId.set(t.id);
    this.api.test(t.id).subscribe({
      next: (r) => {
        this.testingId.set(null);
        this.statusMap.update((m) => ({ ...m, [t.id]: r.online }));
      },
      error: () => {
        this.testingId.set(null);
        this.statusMap.update((m) => ({ ...m, [t.id]: false }));
      },
    });
  }

  copyToken(t: TerminalFacial) {
    // Usa o protocolo atual do console (https em produção). Forçar http:// aqui
    // quebrava o simulador servido por HTTPS (Mixed Content → "Failed to fetch").
    const url = `${window.location.origin}/api/facial/webhook/${t.webhook_token}`;
    navigator.clipboard?.writeText(url);
    this.successMessage.set('URL do webhook copiada.');
    setTimeout(() => this.successMessage.set(null), 3000);
  }

  /**
   * Rotação do token do webhook: o token antigo (possivelmente exposto em
   * screenshot/log) para de valer NA HORA. O Agente Local e qualquer push
   * configurado com a URL antiga precisam ser atualizados.
   */
  rotateToken(t: TerminalFacial) {
    const confirmou = window.confirm(
      `Gerar um NOVO token de webhook para "${t.nome}"?\n\n` +
        'O token atual deixa de funcionar imediatamente. Você precisará ' +
        'atualizar a URL no Agente Local (arquivo .env) e em qualquer ' +
        'integração que use a URL antiga.',
    );
    if (!confirmou) return;
    this.api.rotateToken(t.id).subscribe({
      next: (res) => {
        t.webhook_token = res.webhook_token;
        const url = `${window.location.origin}/api/facial/webhook/${res.webhook_token}`;
        navigator.clipboard?.writeText(url);
        this.successMessage.set(
          'Token rotacionado — a NOVA URL do webhook já está na área de transferência.',
        );
        setTimeout(() => this.successMessage.set(null), 6000);
      },
      error: (err) => {
        this.errorMessage.set(
          err?.error?.message ?? 'Falha ao rotacionar o token do webhook.',
        );
        setTimeout(() => this.errorMessage.set(null), 5000);
      },
    });
  }

  openCameraPreview(t: TerminalFacial) {
    this.viewingCameraTerminal.set(t);
    this.cameraLiveUrl.set(null);
    this.cameraPreviewUrl.set(null);
    this.cameraLiveFailed.set(false);
    this.cameraError.set(null);
    this.cameraLoading.set(true);
    this.cameraActive = true;

    // Tenta primeiro o Agent Local (localhost)
    this.cameraLiveUrl.set(`http://localhost:8788/liveview?t=${Date.now()}`);
  }

  closeCameraPreview() {
    this.cameraActive = false;
    this.viewingCameraTerminal.set(null);
    this.cameraLiveUrl.set(null);
    this.cameraPreviewUrl.set(null);
    this.cameraLiveFailed.set(false);
    this.cameraError.set(null);
    this.cameraLoading.set(false);
  }

  onCameraLiveError() {
    if (this.cameraLiveFailed()) return;
    this.cameraLiveFailed.set(true);
    this.cameraLiveUrl.set(null);
    this.tickCameraNuvem();
  }

  private tickCameraNuvem() {
    if (!this.cameraActive) return;
    const t = this.viewingCameraTerminal();
    if (!t) return;

    this.api.snapshot(t.id).subscribe({
      next: (r) => {
        if (!this.cameraActive) return;
        this.cameraLoading.set(false);
        this.cameraPreviewUrl.set(r.foto);
        // Próximo frame em 400ms
        setTimeout(() => this.tickCameraNuvem(), 400);
      },
      error: (e) => {
        if (!this.cameraActive) return;
        this.cameraLoading.set(false);
        this.cameraError.set(
          e?.error?.message ?? 'Falha ao conectar na câmera do terminal.',
        );
      },
    });
  }
}
