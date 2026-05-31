import { Component, EventEmitter, Input, OnDestroy, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_BASE } from './api.config';

interface FacialDevice {
  id: number;
  nome: string;
  tipo: string;
  ativo: number;
}

interface EnrollSession {
  id: string;
  idDevice: number;
  status: 'waiting' | 'captured';
  capturedValue: string | null;
  expiresAt: number;
}

/**
 * Captura guiada de UID RFID / código QR via leitor cadastrado.
 *
 * Operador clica "Capturar via leitor", escolhe qual leitor usar, e o portal
 * fica em polling. Quando o leitor reporta uma credencial não cadastrada, o
 * backend desvia esse valor para a sessão (em vez de processar como acesso
 * negado), e o componente emite o valor capturado para o pai preencher o
 * input correspondente.
 *
 * Evita o operador ter que digitar UIDs (que vêm em hex, decimal, com ou
 * sem padding zerado dependendo do leitor) — fonte clássica de bug de "tag
 * cadastrada mas não funciona".
 */
@Component({
  selector: 'app-enroll-capture',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <button type="button"
            class="text-xs px-2.5 py-1.5 rounded-md bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 transition"
            (click)="openModal()">
      📡 Capturar via leitor
    </button>

    @if (modalOpen()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
           (click)="closeModal()">
        <div class="w-full max-w-md rounded-2xl bg-graphite-200 border border-white/10 p-6 shadow-2xl"
             (click)="$event.stopPropagation()">

          <h3 class="text-lg font-semibold text-white mb-1">
            Capturar {{ tipoLeitor === 'tag_reader' ? 'tag RFID' : 'QR Code' }}
          </h3>
          <p class="text-xs text-slate-400 mb-5">
            Apresente o crachá/QR no leitor escolhido — o valor será preenchido automaticamente.
          </p>

          @if (!session()) {
            <label class="text-xs text-slate-400 block mb-1.5">Leitor a usar</label>
            @if (loadingDevices()) {
              <p class="text-sm text-slate-500 py-3">Carregando leitores…</p>
            } @else if (devices().length === 0) {
              <p class="text-sm text-amber-400 py-3">
                Nenhum leitor {{ tipoLeitor === 'tag_reader' ? 'RFID' : 'QR' }} ativo cadastrado neste condomínio.
              </p>
            } @else {
              <select [(ngModel)]="selectedDeviceId" (change)="onDeviceChange($event)"
                      class="w-full px-3 py-2.5 text-sm rounded-lg bg-graphite border border-white/10 text-white mb-4">
                <option [ngValue]="null">— escolher —</option>
                @for (d of devices(); track d.id) {
                  <option [ngValue]="d.id">{{ d.nome }}</option>
                }
              </select>

              <div class="flex gap-2">
                <button type="button"
                        class="flex-1 px-3 py-2.5 rounded-lg bg-white/5 text-slate-300 text-sm hover:bg-white/10"
                        (click)="closeModal()">Cancelar</button>
                <button type="button"
                        [disabled]="!selectedDeviceId"
                        class="flex-1 px-3 py-2.5 rounded-lg bg-accent text-graphite font-semibold text-sm hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
                        (click)="startCapture()">Iniciar captura</button>
              </div>
            }
          } @else if (session()!.status === 'waiting') {
            <div class="py-8 text-center">
              <div class="inline-flex w-16 h-16 rounded-full bg-accent/10 items-center justify-center mb-4">
                <div class="w-12 h-12 rounded-full border-4 border-accent border-t-transparent animate-spin"></div>
              </div>
              <p class="text-white font-medium mb-1">Aguardando leitura…</p>
              <p class="text-xs text-slate-400 mb-3">Apresente o crachá/QR agora</p>
              <p class="text-xs text-slate-500 font-mono">Expira em {{ secondsLeft() }}s</p>
            </div>

            <button type="button"
                    class="w-full px-3 py-2.5 rounded-lg bg-white/5 text-slate-300 text-sm hover:bg-white/10"
                    (click)="cancelCapture()">Cancelar captura</button>
          } @else {
            <div class="py-6 text-center">
              <div class="inline-flex w-16 h-16 rounded-full bg-emerald-500/10 items-center justify-center mb-4">
                <span class="text-3xl">✓</span>
              </div>
              <p class="text-white font-medium mb-2">Capturado!</p>
              <code class="block text-sm font-mono text-emerald-400 bg-black/30 rounded-lg px-3 py-2 break-all mb-4">
                {{ session()!.capturedValue }}
              </code>
              <button type="button"
                      class="w-full px-3 py-2.5 rounded-lg bg-accent text-graphite font-semibold text-sm hover:bg-accent/90"
                      (click)="confirmCapture()">Usar este valor</button>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class EnrollCaptureComponent implements OnDestroy {
  private http = inject(HttpClient);

  @Input() tipoLeitor: 'tag_reader' | 'qrcode_reader' = 'tag_reader';
  @Input() idCondominio: number | null = null;
  @Output() captured = new EventEmitter<string>();

  modalOpen = signal(false);
  loadingDevices = signal(false);
  devices = signal<FacialDevice[]>([]);
  selectedDeviceId: number | null = null;

  session = signal<EnrollSession | null>(null);
  secondsLeft = signal(90);

  private pollTimer: any = null;
  private countdownTimer: any = null;

  ngOnDestroy(): void {
    this.stopTimers();
  }

  openModal() {
    this.modalOpen.set(true);
    this.session.set(null);
    this.loadDevices();
  }

  closeModal() {
    this.stopTimers();
    if (this.session()?.status === 'waiting') {
      this.cancelCapture();
    }
    this.modalOpen.set(false);
    this.session.set(null);
  }

  onDeviceChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.selectedDeviceId = target.value ? Number(target.value) : null;
  }

  private loadDevices() {
    if (!this.idCondominio) return;
    this.loadingDevices.set(true);
    this.http
      .get<FacialDevice[]>(`${API_BASE}/facial/devices?id_condominio=${this.idCondominio}`)
      .subscribe({
        next: (list) => {
          this.devices.set(list.filter((d) => d.tipo === this.tipoLeitor && d.ativo === 1));
          this.loadingDevices.set(false);
        },
        error: () => {
          this.devices.set([]);
          this.loadingDevices.set(false);
        },
      });
  }

  startCapture() {
    if (!this.selectedDeviceId) return;
    this.http
      .post<EnrollSession>(`${API_BASE}/facial/enroll/start`, { id_device: this.selectedDeviceId })
      .subscribe({
        next: (s) => {
          this.session.set(s);
          this.secondsLeft.set(Math.ceil((s.expiresAt - Date.now()) / 1000));
          this.pollTimer = setInterval(() => this.poll(), 800);
          this.countdownTimer = setInterval(() => {
            const left = Math.ceil((s.expiresAt - Date.now()) / 1000);
            this.secondsLeft.set(Math.max(0, left));
            if (left <= 0) this.cancelCapture();
          }, 1000);
        },
      });
  }

  private poll() {
    const current = this.session();
    if (!current) return;
    this.http.get<EnrollSession>(`${API_BASE}/facial/enroll/${current.id}`).subscribe({
      next: (s) => {
        this.session.set(s);
        if (s.status === 'captured') this.stopTimers();
      },
      error: () => {
        this.stopTimers();
        this.session.set(null);
      },
    });
  }

  confirmCapture() {
    const s = this.session();
    if (s && s.capturedValue) {
      this.captured.emit(s.capturedValue);
    }
    this.modalOpen.set(false);
    this.session.set(null);
  }

  cancelCapture() {
    const s = this.session();
    if (s) {
      this.http.delete(`${API_BASE}/facial/enroll/${s.id}`).subscribe({ error: () => {} });
    }
    this.stopTimers();
    this.session.set(null);
  }

  private stopTimers() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.pollTimer = null;
    this.countdownTimer = null;
  }
}
