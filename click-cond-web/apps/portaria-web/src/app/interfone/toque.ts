import { Injectable } from '@angular/core';

/**
 * Toque da chamada no console: um WAV curto (public/assets/interfone/toque.wav, gerado por
 * scripts/gerar-toque-interfone.mjs) em loop. Injetável para o teste trocar por um falso.
 *
 * O navegador pode bloquear o som antes de a pessoa interagir com a página: o `play()` recusado é ignorado — o
 * painel continua aparecendo.
 */
@Injectable({ providedIn: 'root' })
export class ToqueInterfone {
  private audio: HTMLAudioElement | null = null;

  tocar(): void {
    if (typeof Audio === 'undefined') return;
    if (!this.audio) {
      this.audio = new Audio('/assets/interfone/toque.wav');
      this.audio.loop = true;
    }
    if (!this.audio.paused) return;
    try {
      void this.audio.play()?.catch(() => undefined);
    } catch { /* sem áudio */ }
  }

  parar(): void {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
  }
}
