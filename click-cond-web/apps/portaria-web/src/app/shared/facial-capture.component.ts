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
 * Modal de captura pela CÂMERA do terminal facial, com preview "ao vivo".
 *
 * A câmera está na LAN do condomínio (IP privado) — o browser não a alcança.
 * Então o preview é montado por SNAPSHOTS em sequência (POST /facial/snapshot,
 * que vai pelo Agente Local). Não é vídeo fluido — é uma sucessão de quadros a
 * poucos FPS, o bastante para o operador posicionar o rosto na moldura e
 * capturar no melhor momento. "Capturar" congela o quadro exibido e o devolve.
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
            @if (previewUrl()) {
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

            <!-- Moldura guia (oval) com vinheta ao redor -->
            @if (previewUrl()) {
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
            Posicione o rosto dentro da moldura e capture no melhor momento.
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
              (click)="confirmar()"
              [disabled]="!previewUrl()"
              class="flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition disabled:opacity-50"
            >
              Capturar foto
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

  readonly previewUrl = signal<string | null>(null);
  readonly erro = signal<string | null>(null);

  private _open = false;
  @Input() set open(v: boolean) {
    if (v === this._open) return;
    this._open = v;
    if (v) {
      this.previewUrl.set(null);
      this.erro.set(null);
      this.tick();
    }
  }
  get open(): boolean {
    return this._open;
  }

  @Output() captured = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  /** Busca um quadro e agenda o próximo enquanto o modal estiver aberto. */
  private tick(): void {
    if (!this._open) return;
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    const params = new HttpParams().set('id_condominio', String(cid));
    this.http
      .post<{ foto: string }>(`${API_BASE}/facial/snapshot`, {}, { params })
      .subscribe({
        next: (r) => {
          if (!this._open) return;
          this.previewUrl.set(r.foto);
          // Pequeno respiro entre quadros; o limite real é o ciclo do agente.
          setTimeout(() => this.tick(), 250);
        },
        error: (e) => {
          this.erro.set(
            e?.error?.message ?? 'Falha ao acessar a câmera do terminal facial.',
          );
        },
      });
  }

  confirmar(): void {
    const f = this.previewUrl();
    this._open = false;
    if (f) this.captured.emit(f);
  }

  cancelar(): void {
    this._open = false;
    this.cancelled.emit();
  }
}
