import { Injectable, signal } from '@angular/core';

const EVENTOS_GESTO = ['pointerdown', 'keydown'] as const;

/**
 * Toque da chamada no console: um WAV curto (public/assets/interfone/toque.wav, gerado por
 * scripts/gerar-toque-interfone.mjs) em loop. Injetável para o teste trocar por um falso.
 *
 * Autoplay: o navegador recusa `play()` (NotAllowedError) até a pessoa interagir com a página — um console aberto
 * num monitor sem ninguém clicar ficaria mudo. Por isso:
 * - `bloqueado` liga quando o play é recusado, ou já no `preparar()` se a página ainda não teve interação
 *   (`navigator.userActivation`); o painel mostra "Clique para ativar o som do interfone";
 * - o primeiro clique/tecla em qualquer lugar da página (ouvinte instalado no `preparar()`) também destrava.
 */
@Injectable({ providedIn: 'root' })
export class ToqueInterfone {
  readonly bloqueado = signal(false);

  private audio: HTMLAudioElement | null = null;
  /** Há chamada tocando agora (o que o store pediu), independentemente de o navegador ter deixado. */
  private querTocar = false;
  private ouvindoGesto = false;
  private readonly aoGesto = () => this.desbloquear();

  /** Liga o destravamento no primeiro gesto da página. Chamado quando o painel do interfone fica ativo. */
  preparar(): void {
    const ativa = (globalThis.navigator as (Navigator & { userActivation?: { hasBeenActive: boolean } }) | undefined)
      ?.userActivation;
    if (ativa && !ativa.hasBeenActive) this.bloqueado.set(true);
    this.ouvirGesto();
  }

  tocar(): void {
    this.querTocar = true;
    const audio = this.elemento();
    if (!audio || !audio.paused) return;
    this.tentarTocar(audio);
  }

  parar(): void {
    this.querTocar = false;
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  /**
   * Destrava o áudio dentro de um gesto do usuário (clique no aviso ou primeiro clique na página). Sem chamada
   * tocando, dá play mudo e pausa — o elemento fica liberado para o próximo toque.
   */
  desbloquear(): void {
    const audio = this.elemento();
    if (!audio) return;
    audio.muted = !this.querTocar;
    let p: Promise<void> | undefined;
    try {
      p = audio.play();
    } catch {
      return;
    }
    Promise.resolve(p).then(
      () => {
        if (!this.querTocar) {
          audio.pause();
          audio.currentTime = 0;
        }
        audio.muted = false;
        this.bloqueado.set(false);
        this.pararDeOuvirGesto();
      },
      (e: { name?: string }) => {
        audio.muted = false;
        // Só a regra de autoplay conta como bloqueio; outra falha (ex.: AbortError) não acende o aviso.
        if (e?.name === 'NotAllowedError') this.bloqueado.set(true);
      },
    );
  }

  /** Solta o ouvinte de gesto e para o som (saída do console). */
  descartar(): void {
    this.parar();
    this.pararDeOuvirGesto();
  }

  private tentarTocar(audio: HTMLAudioElement): void {
    let p: Promise<void> | undefined;
    try {
      p = audio.play();
    } catch {
      return; // sem áudio no ambiente
    }
    Promise.resolve(p).then(
      () => this.bloqueado.set(false),
      (e: { name?: string }) => {
        if (e?.name === 'NotAllowedError') {
          this.bloqueado.set(true);
          this.ouvirGesto();
        }
      },
    );
  }

  private elemento(): HTMLAudioElement | null {
    if (this.audio) return this.audio;
    if (typeof Audio === 'undefined') return null;
    this.audio = new Audio('/assets/interfone/toque.wav');
    this.audio.loop = true;
    return this.audio;
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
