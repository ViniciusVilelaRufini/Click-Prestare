import { Injectable, signal } from '@angular/core';

const EVENTOS_GESTO = ['pointerdown', 'keydown'] as const;
/** Um ciclo da sirene: dois bipes (agudo, grave) e uma pausa. */
const CICLO_MS = 1_200;

type ContextoAudio = AudioContext;

/**
 * Alarme de pânico da Central: sirene gerada pelo Web Audio (dois tons alternados), bem diferente do toque da
 * chamada, tocando até alguém marcar o alerta como visto. Injetável para os testes trocarem por um falso.
 *
 * Autoplay: o navegador só deixa tocar depois de um gesto na página. Sem gesto, `bloqueado` liga e a tela mostra
 * "Clique para ativar o som"; o primeiro clique/tecla em qualquer lugar destrava.
 */
@Injectable({ providedIn: 'root' })
export class AlarmeCentral {
  readonly bloqueado = signal(false);

  private ctx: ContextoAudio | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private querTocar = false;
  private ouvindoGesto = false;
  private readonly aoGesto = () => this.desbloquear();

  preparar(): void {
    const ativa = (globalThis.navigator as (Navigator & { userActivation?: { hasBeenActive: boolean } }) | undefined)
      ?.userActivation;
    if (ativa && !ativa.hasBeenActive) this.bloqueado.set(true);
    this.ouvirGesto();
  }

  tocar(): void {
    if (this.querTocar) return;
    this.querTocar = true;
    const ctx = this.contexto();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
      if (ctx.state === 'suspended') {
        this.bloqueado.set(true);
        this.ouvirGesto();
      }
    }
    this.ciclo();
    this.timer = setInterval(() => this.ciclo(), CICLO_MS);
  }

  parar(): void {
    this.querTocar = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Dentro de um gesto do usuário: o navegador deixa o áudio tocar. */
  desbloquear(): void {
    const ctx = this.contexto();
    if (!ctx) return;
    ctx.resume().then(
      () => {
        this.bloqueado.set(false);
        this.pararDeOuvirGesto();
      },
      () => undefined,
    );
  }

  descartar(): void {
    this.parar();
    this.pararDeOuvirGesto();
  }

  private ciclo(): void {
    const ctx = this.ctx;
    if (!ctx || !this.querTocar || ctx.state !== 'running') return;
    this.bipe(ctx, 960, 0, 0.32);
    this.bipe(ctx, 640, 0.4, 0.32);
  }

  private bipe(ctx: ContextoAudio, freq: number, atraso: number, duracao: number): void {
    try {
      const t0 = ctx.currentTime + atraso;
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      ganho.gain.setValueAtTime(0.0001, t0);
      ganho.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + duracao);
      osc.connect(ganho).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duracao + 0.02);
    } catch {
      /* sem áudio no ambiente */
    }
  }

  private contexto(): ContextoAudio | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    return this.ctx;
  }

  private ouvirGesto(): void {
    if (this.ouvindoGesto || typeof document === 'undefined') return;
    this.ouvindoGesto = true;
    for (const ev of EVENTOS_GESTO) document.addEventListener(ev, this.aoGesto, { capture: true });
  }

  private pararDeOuvirGesto(): void {
    if (!this.ouvindoGesto || typeof document === 'undefined') return;
    this.ouvindoGesto = false;
    for (const ev of EVENTOS_GESTO) document.removeEventListener(ev, this.aoGesto, { capture: true });
  }
}
