import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { TerminaisFaciaisApi, TerminalFacial } from '../../terminais-faciais/terminais-faciais.service';
import { MoradoresApi, Morador } from '../../moradores/moradores.service';
import { VisitantesService } from '../../visitantes/visitantes.service';
import { Visitante } from '../../visitantes/visitante.model';
import { API_BASE } from '../../shared/api.config';

interface LogMessage {
  timestamp: Date;
  tipo: 'info' | 'success' | 'error' | 'sent';
  mensagem: string;
}

@Component({
  selector: 'app-simulador-dispositivos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './simulador-dispositivos.component.html',
})
export class SimuladorDispositivosComponent implements OnInit {
  private devicesApi = inject(TerminaisFaciaisApi);
  private moradoresApi = inject(MoradoresApi);
  private visitantesApi = inject(VisitantesService);
  private http = inject(HttpClient);

  // States
  readonly devices = signal<TerminalFacial[]>([]);
  readonly selectedDeviceId = signal<number | null>(null);
  readonly selectedDevice = computed(() => 
    this.devices().find(d => d.id === this.selectedDeviceId()) || null
  );

  readonly moradores = signal<Morador[]>([]);
  readonly visitantes = signal<Visitante[]>([]);
  readonly loading = signal(false);

  // Simuladores Form State
  // Facial
  facialPessoaId = signal<string>('');
  facialEvent = signal<'entrada' | 'saida'>('entrada');
  facialConfidence = signal<number>(98);

  // RFID
  rfidCardUid = signal<string>('');
  rfidEvent = signal<'entrada' | 'saida'>('entrada');

  // QR Code
  qrcodeValue = signal<string>('');
  qrcodeEvent = signal<'entrada' | 'saida'>('entrada');

  // Catraca
  catracaCredencial = signal<string>('');
  catracaMetodo = signal<'rfid' | 'qrcode' | 'facial'>('rfid');
  catracaDirection = signal<'in' | 'out'>('in');

  // Terminal de Logs do Simulador
  readonly logs = signal<LogMessage[]>([]);

  ngOnInit() {
    this.carregarDados();
    this.addLog('info', 'Simulador inicializado. Selecione um dispositivo para começar.');
  }

  carregarDados() {
    this.loading.set(true);
    // 1. Carregar Dispositivos
    this.devicesApi.list().subscribe({
      next: (data) => {
        this.devices.set(data.filter(d => d.ativo === 1));
        this.loading.set(false);
      },
      error: () => {
        this.addLog('error', 'Falha ao carregar dispositivos de acesso.');
        this.loading.set(false);
      }
    });

    // 2. Carregar Moradores para lista de apoio
    this.moradoresApi.list().subscribe({
      next: (data) => this.moradores.set(data),
      error: () => this.addLog('error', 'Erro ao carregar moradores para o simulador.')
    });

    // 3. Carregar Visitantes para lista de apoio
    this.visitantesApi.list().subscribe({
      next: (data) => this.visitantes.set(data),
      error: () => this.addLog('error', 'Erro ao carregar visitantes para o simulador.')
    });
  }

  selecionarDispositivo(id: number) {
    this.selectedDeviceId.set(id);
    const d = this.selectedDevice();
    if (d) {
      this.addLog('info', `Dispositivo selecionado: ${d.nome} (${d.tipo.toUpperCase()})`);
      // Pré-preencher valores sugeridos
      if (d.tipo === 'tag_reader') {
        const m = this.moradores().find(m => !!m.tag_rfid);
        if (m) this.rfidCardUid.set(m.tag_rfid || '');
      } else if (d.tipo === 'qrcode_reader') {
        const m = this.moradores().find(m => !!m.qrcode_acesso);
        if (m) this.qrcodeValue.set(m.qrcode_acesso || '');
      } else if (d.tipo === 'facial') {
        const m = this.moradores().find(m => !!m.face_id);
        if (m) {
          this.facialPessoaId.set(`morador_${m.id}`);
        }
      }
    }
  }

  copiarCredencialMorador(m: Morador) {
    const d = this.selectedDevice();
    if (!d) return;

    if (d.tipo === 'facial' && m.id) {
      this.facialPessoaId.set(`morador_${m.id}`);
      this.addLog('info', `Sugestão facial copiada: morador_${m.id} (${m.nome})`);
    } else if (d.tipo === 'tag_reader' && m.tag_rfid) {
      this.rfidCardUid.set(m.tag_rfid);
      this.addLog('info', `Sugestão RFID copiada: ${m.tag_rfid} (${m.nome})`);
    } else if (d.tipo === 'qrcode_reader' && m.qrcode_acesso) {
      this.qrcodeValue.set(m.qrcode_acesso);
      this.addLog('info', `Sugestão QR Code copiada: ${m.qrcode_acesso} (${m.nome})`);
    } else if (d.tipo === 'catraca') {
      const val = this.catracaMetodo() === 'rfid' ? m.tag_rfid : (this.catracaMetodo() === 'qrcode' ? m.qrcode_acesso : `morador_${m.id}`);
      this.catracaCredencial.set(val || '');
      this.addLog('info', `Sugestão de credencial copiada para catraca: ${val} (${m.nome})`);
    }
  }

  copiarCredencialVisitante(v: Visitante) {
    const d = this.selectedDevice();
    if (!d) return;

    if (d.tipo === 'facial' && v.id) {
      this.facialPessoaId.set(`visitante_${v.id}`);
      this.addLog('info', `Sugestão facial copiada: visitante_${v.id} (${v.nome})`);
    } else if (d.tipo === 'tag_reader' && v.tag_rfid) {
      this.rfidCardUid.set(v.tag_rfid);
      this.addLog('info', `Sugestão RFID copiada: ${v.tag_rfid} (${v.nome})`);
    } else if (d.tipo === 'qrcode_reader' && v.codigo_acesso) {
      this.qrcodeValue.set(v.codigo_acesso);
      this.addLog('info', `Sugestão QR Code (PIN) copiada: ${v.codigo_acesso} (${v.nome})`);
    } else if (d.tipo === 'catraca') {
      const val = this.catracaMetodo() === 'rfid' ? v.tag_rfid : (this.catracaMetodo() === 'qrcode' ? v.codigo_acesso : `visitante_${v.id}`);
      this.catracaCredencial.set(val || '');
      this.addLog('info', `Sugestão de credencial copiada para catraca: ${val} (${v.nome})`);
    }
  }

  simularFacial() {
    const d = this.selectedDevice();
    if (!d) return;

    const payload = {
      event: this.facialEvent(),
      external_id: this.facialPessoaId().trim(),
      confidence: this.facialConfidence(),
      timestamp: new Date().toISOString()
    };

    this.enviarWebhook(d.webhook_token, payload);
  }

  simularRFID() {
    const d = this.selectedDevice();
    if (!d) return;

    const payload = {
      event: this.rfidEvent(),
      card_uid: this.rfidCardUid().trim(),
      timestamp: new Date().toISOString()
    };

    this.enviarWebhook(d.webhook_token, payload);
  }

  simularQRCode() {
    const d = this.selectedDevice();
    if (!d) return;

    const payload = {
      event: this.qrcodeEvent(),
      qrcode: this.qrcodeValue().trim(),
      timestamp: new Date().toISOString()
    };

    this.enviarWebhook(d.webhook_token, payload);
  }

  simularBotoeira() {
    const d = this.selectedDevice();
    if (!d) return;

    const payload = {
      event: 'acionamento',
      external_id: 'botoeira_fisica',
      timestamp: new Date().toISOString()
    };

    this.enviarWebhook(d.webhook_token, payload);
  }

  simularCatraca() {
    const d = this.selectedDevice();
    if (!d) return;

    const metodo = this.catracaMetodo();
    const credencial = this.catracaCredencial().trim();
    const direction = this.catracaDirection();

    const payload: any = {
      event: direction === 'in' ? 'entrada' : 'saida',
      timestamp: new Date().toISOString()
    };

    if (metodo === 'rfid') {
      payload.card_uid = credencial;
    } else if (metodo === 'qrcode') {
      payload.qrcode = credencial;
    } else {
      payload.external_id = credencial;
      payload.confidence = 99;
    }

    this.enviarWebhook(d.webhook_token, payload);
  }

  private enviarWebhook(token: string, payload: any) {
    const url = `${API_BASE}/facial/webhook/${token}`;
    this.addLog('sent', `POST ${url}\nPayload: ${JSON.stringify(payload, null, 2)}`);

    this.http.post(url, payload).subscribe({
      next: (res: any) => {
        this.addLog('success', `Resposta do Servidor: Acesso Autorizado!\n${JSON.stringify(res || { status: 'sucesso' }, null, 2)}`);
      },
      error: (err) => {
        const errorMsg = err.error?.message || err.message || 'Erro de comunicação';
        this.addLog('error', `Resposta do Servidor (Erro): Acesso Negado!\nMotivo: ${errorMsg}`);
      }
    });
  }

  addLog(tipo: LogMessage['tipo'], mensagem: string) {
    const newLogs = [...this.logs(), { timestamp: new Date(), tipo, mensagem }];
    // Limitar logs a no máximo 50 mensagens
    if (newLogs.length > 50) {
      newLogs.shift();
    }
    this.logs.set(newLogs);
  }

  limparLogs() {
    this.logs.set([]);
    this.addLog('info', 'Terminal de logs limpo.');
  }
}
