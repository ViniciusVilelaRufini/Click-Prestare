import { Component, OnInit, inject, signal, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CreateTerminalFacial,
  FacialSyncStatus,
  TerminaisFaciaisApi,
  TerminalFacial,
} from './terminais-faciais.service';

@Component({
  selector: 'app-terminais-faciais-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './terminais-faciais-page.component.html',
})
export class TerminaisFaciaisPageComponent implements OnInit {
  @Input() embedded = false;
  private api = inject(TerminaisFaciaisApi);

  readonly loading = signal(false);
  readonly terminais = signal<TerminalFacial[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly testingId = signal<number | null>(null);
  readonly statusMap = signal<Record<number, boolean | null>>({});

  // Sincronização em massa de rostos (back-fill)
  readonly syncing = signal(false);
  readonly syncStatus = signal<FacialSyncStatus | null>(null);

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
  }

  loadSyncStatus() {
    this.api.syncStatus().subscribe({
      next: (s) => this.syncStatus.set(s),
      error: () => this.syncStatus.set(null),
    });
  }

  /**
   * Envia todos os rostos já cadastrados para os terminais faciais (back-fill).
   * Roda em segundo plano no servidor; aqui só dispara e acompanha o status.
   */
  syncAllRostos() {
    this.syncing.set(true);
    this.errorMessage.set(null);
    this.api.syncAll().subscribe({
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
        this.pollSyncStatus(12);
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
  private pollSyncStatus(restantes: number) {
    this.api.syncStatus().subscribe({
      next: (s) => {
        this.syncStatus.set(s);
        if (s.running && restantes > 0) {
          setTimeout(() => this.pollSyncStatus(restantes - 1), 3000);
        }
      },
      error: () => {},
    });
  }

  private emptyForm(): CreateTerminalFacial {
    return {
      nome: '',
      tipo: 'facial',
      sentido: 'auto',
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

  load() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (list) => {
        this.terminais.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(
          err?.error?.message ?? 'Falha ao carregar terminais.',
        );
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
