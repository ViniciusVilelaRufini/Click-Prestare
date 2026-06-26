import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { API_BASE } from './api.config';
import { AuthService } from '../auth/auth.service';

/**
 * Modal de captura pela CÂMERA do terminal facial, com preview ao vivo.
 *
 * O aparelho não expõe vídeo (MJPEG vazio; só RTSP H.264). Então o "ao vivo" é
 * uma sucessão de snapshots (~3 fps, teto do aparelho). Dois caminhos:
 *
 *   1. AGENTE LOCAL (preferido): se o navegador está no PC da portaria (mesma
 *      máquina/rede do agente), consome http://localhost:8788/liveview (MJPEG
 *      montado pelo agente) — rápido, sem a nuvem. Captura via /snapshot local.
 *   2. NUVEM (fallback): se o localhost não responde (navegador em outro PC),
 *      cai para snapshots via API (mais lento). O preview avisa.
 */
@Component({
  selector: 'app-facial-capture',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (open) {
      <div
        class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        (click)="cancelar()"
      >
        <div
          class="bg-graphite rounded-2xl border border-white/10 p-4 w-full max-w-md shadow-2xl"
          (click)="$event.stopPropagation()"
        >
          <div class="text-sm font-semibold text-white mb-3">
            Capturar pela câmera do facial
          </div>

          <div
            class="relative aspect-[3/4] rounded-xl overflow-hidden bg-black flex items-center justify-center"
          >
            @if (liveUrl()) {
              <img
                [src]="liveUrl()"
                (error)="onLiveErro()"
                class="w-full h-full object-cover"
              />
            } @else if (previewUrl()) {
              <img [src]="previewUrl()" class="w-full h-full object-cover" />
            } @else if (erro()) {
              <div class="text-rose-400 text-xs p-6 text-center">{{ erro() }}</div>
            } @else {
              <div class="flex flex-col items-center gap-2 text-slate-400 text-xs">
                <div
                  class="w-6 h-6 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin"
                ></div>
                Conectando à câmera…
              </div>
            }

            @if (liveUrl() || previewUrl()) {
              <div
                class="pointer-events-none absolute inset-0 flex items-center justify-center"
              >
                <div
                  class="w-40 h-52 border-2 border-emerald-400/80 rounded-[50%]"
                  style="box-shadow: 0 0 0 9999px rgba(0,0,0,0.35)"
                ></div>
              </div>
              <div
                class="absolute top-2 right-2 flex items-center gap-1.5 text-[10px] font-semibold text-emerald-300 bg-black/40 px-2 py-1 rounded-full"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                AO VIVO
              </div>
            }
          </div>

          <div class="text-[11px] text-slate-400 mt-2 text-center">
            @if (liveFalhou()) {
              Preview pela nuvem (mais lento) — abra no PC da portaria para o tempo real.
            } @else {
              Posicione o rosto dentro da moldura e capture no melhor momento.
            }
          </div>

          <div class="flex gap-2 mt-3">
            <button
              type="button"
              (click)="cancelar()"
              class="flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 bg-white/5 border border-white/10 hover:bg-white/10 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              (click)="capturar()"
              [disabled]="capturando() || (!liveUrl() && !previewUrl())"
              class="flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition disabled:opacity-50"
            >
              {{ capturando() ? 'Capturando…' : 'Capturar foto' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class FacialCaptureComponent {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  /** Agente local (preview/captura rápidos). */
  private readonly localBase = 'http://localhost:8788';

  readonly liveUrl = signal<string | null>(null); // MJPEG do agente local
  readonly previewUrl = signal<string | null>(null); // fallback nuvem
  readonly liveFalhou = signal(false);
  readonly erro = signal<string | null>(null);
  readonly capturando = signal(false);

  private _open = false;
  @Input() set open(v: boolean) {
    if (v === this._open) return;
    this._open = v;
    if (v) this.start();
    else this.reset();
  }
  get open(): boolean {
    return this._open;
  }

  @Output() captured = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  private reset() {
    this.liveUrl.set(null);
    this.previewUrl.set(null);
    this.liveFalhou.set(false);
    this.erro.set(null);
    this.capturando.set(false);
  }

  private start() {
    this.reset();
    this.liveUrl.set(`${this.localBase}/liveview?t=${Date.now()}`);
  }

  /** O <img> local falhou: navegador fora do PC do agente → fallback nuvem. */
  onLiveErro() {
    if (this.liveFalhou()) return;
    this.liveFalhou.set(true);
    this.liveUrl.set(null);
    this.tickNuvem();
  }

  private tickNuvem() {
    if (!this._open || !this.liveFalhou()) return;
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    const params = new HttpParams().set('id_condominio', String(cid));
    this.http
      .post<{ foto: string }>(`${API_BASE}/facial/snapshot`, {}, { params })
      .subscribe({
        next: (r) => {
          if (!this._open) return;
          this.previewUrl.set(r.foto);
          setTimeout(() => this.tickNuvem(), 300);
        },
        error: (e) => {
          this.erro.set(
            e?.error?.message ?? 'Falha ao acessar a câmera do terminal.',
          );
        },
      });
  }

  async capturar() {
    this.capturando.set(true);
    try {
      let dataUrl = '';
      if (!this.liveFalhou()) {
        const resp = await fetch(`${this.localBase}/snapshot?t=${Date.now()}`);
        if (!resp.ok) throw new Error('snapshot local falhou');
        dataUrl = await this.blobToDataUrl(await resp.blob());
      } else {
        dataUrl = this.previewUrl() ?? '';
      }
      this.capturando.set(false);
      this._open = false;
      if (dataUrl) this.captured.emit(dataUrl);
    } catch {
      this.capturando.set(false);
      this.erro.set('Falha ao capturar a foto. Tente novamente.');
    }
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  cancelar() {
    this._open = false;
    this.cancelled.emit();
  }
}
