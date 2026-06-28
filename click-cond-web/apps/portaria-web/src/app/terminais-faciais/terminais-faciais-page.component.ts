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

@Component({
  selector: 'app-terminais-faciais-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './terminais-faciais-page.component.html',
})
export class TerminaisFaciaisPageComponent implements OnInit, OnDestroy {
  @Input() embedded = false;
  private api = inject(TerminaisFaciaisApi);
  private statusInterval?: ReturnType<typeof setInterval>;

  readonly loading = signal(false);
  readonly terminais = signal<TerminalFacial[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly testingId = signal<number | null>(null);
  readonly statusMap = signal<Record<number, boolean | null>>({});

  // Sincronização em massa de rostos (back-fill)
  readonly syncing = signal(false);
  readonly syncStatus = signal<FacialSyncStatus | null>(null);
  // Filtro de categoria (vazio = todas). Terminais selecionados (vazio = todos).
  readonly categoriasSync = signal<Set<string>>(new Set());
  readonly terminaisSync = signal<Set<number>>(new Set());
  // Lista por pessoa (quem está pendente/erro e por quê) + visibilidade.
  readonly pessoas = signal<SyncPessoa[]>([]);
  readonly mostrarPessoas = signal(false);
  readonly retryingPessoa = signal<string | null>(null);

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
    this.loadSyncStatus();
    this.loadAgentInfo();
    // Atualiza o status online/offline dos aparelhos a cada 15s (silencioso),
    // refletindo o heartbeat do agente sem o operador clicar "Testar Conexão".
    this.statusInterval = setInterval(() => this.load(true), 15_000);
  }

  ngOnDestroy(): void {
    if (this.statusInterval) clearInterval(this.statusInterval);
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
  syncAllRostos() {
    this.syncing.set(true);
    this.errorMessage.set(null);
    const cats = Array.from(this.categoriasSync());
    const ids = Array.from(this.terminaisSync());
    this.api.syncAll(cats, ids).subscribe({
      next: (r) => {
        this.syncing.set(false);
        if (r.skipped) {
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
        this.errorMessage.set(
          err?.error?.message ?? 'Falha ao sincronizar rostos.',
        );
        setTimeout(() => this.errorMessage.set(null), 5000);
      },
    });
  }

  /** Atualiza o status a cada 3s enquanto o back-fill estiver rodando. */
  private pollSyncStatus(restantes = 200) {
    this.api.syncStatus().subscribe({
      next: (s) => {
        this.syncStatus.set(s);
        if (this.mostrarPessoas()) this.loadPessoas();
        if (s.running && restantes > 0) {
          setTimeout(() => this.pollSyncStatus(restantes - 1), 3000);
        }
      },
      error: () => {},
    });
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
    };
  }

  // Botoeira é só acionador (não identifica pessoa), então sentido não se aplica.
  get mostrarSentido(): boolean {
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
}
