import { TestBed } from '@angular/core/testing';
import { ToqueInterfone } from './toque';

/** Audio falso: o jsdom não toca mídia. `recusar` simula a regra de autoplay (NotAllowedError). */
class AudioFalso {
  static ultimo: AudioFalso | null = null;
  static recusar = false;
  loop = false;
  muted = false;
  paused = true;
  currentTime = 0;
  play = jest.fn(() => {
    if (AudioFalso.recusar) return Promise.reject(Object.assign(new Error('bloqueado'), { name: 'NotAllowedError' }));
    this.paused = false;
    return Promise.resolve();
  });
  pause = jest.fn(() => {
    this.paused = true;
  });
  constructor(public src?: string) {
    AudioFalso.ultimo = this;
  }
}

const tique = () => new Promise((r) => setTimeout(r, 0));

describe('ToqueInterfone — autoplay', () => {
  const original = (globalThis as any).Audio;
  let toque: ToqueInterfone;

  beforeEach(() => {
    (globalThis as any).Audio = AudioFalso;
    AudioFalso.recusar = false;
    AudioFalso.ultimo = null;
    TestBed.configureTestingModule({});
    toque = TestBed.inject(ToqueInterfone);
  });

  afterEach(() => {
    toque.descartar();
    (globalThis as any).Audio = original;
    TestBed.resetTestingModule();
  });

  it('toca em loop o WAV do interfone', async () => {
    toque.tocar();
    await tique();
    expect(AudioFalso.ultimo!.src).toBe('/assets/interfone/toque.wav');
    expect(AudioFalso.ultimo!.loop).toBe(true);
    expect(AudioFalso.ultimo!.paused).toBe(false);
    expect(toque.bloqueado()).toBe(false);
  });

  it('play recusado marca bloqueado; o clique no aviso volta a tocar', async () => {
    AudioFalso.recusar = true;
    toque.tocar();
    await tique();
    expect(toque.bloqueado()).toBe(true);
    AudioFalso.recusar = false;
    toque.desbloquear();
    await tique();
    expect(toque.bloqueado()).toBe(false);
    expect(AudioFalso.ultimo!.paused).toBe(false); // ainda havia chamada tocando
    expect(AudioFalso.ultimo!.muted).toBe(false);
  });

  it('o primeiro clique em qualquer lugar da página desbloqueia', async () => {
    toque.preparar();
    AudioFalso.recusar = true;
    toque.tocar();
    await tique();
    expect(toque.bloqueado()).toBe(true);
    AudioFalso.recusar = false;
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await tique();
    expect(toque.bloqueado()).toBe(false);
    expect(AudioFalso.ultimo!.paused).toBe(false);
  });

  it('falha que não é de autoplay (AbortError) não marca bloqueado', async () => {
    toque.tocar();
    await tique();
    toque.parar();
    AudioFalso.ultimo!.play = jest.fn(() => Promise.reject(Object.assign(new Error('abortado'), { name: 'AbortError' })));
    toque.desbloquear();
    await tique();
    expect(toque.bloqueado()).toBe(false);
    toque.tocar();
    await tique();
    expect(toque.bloqueado()).toBe(false);
  });

  it('desbloquear sem chamada tocando destrava e fica em silêncio', async () => {
    toque.preparar();
    document.body.dispatchEvent(new Event('keydown', { bubbles: true }));
    await tique();
    expect(AudioFalso.ultimo!.play).toHaveBeenCalled();
    expect(AudioFalso.ultimo!.pause).toHaveBeenCalled();
    expect(AudioFalso.ultimo!.paused).toBe(true);
    expect(toque.bloqueado()).toBe(false);
  });

  it('página ainda sem interação do usuário: já começa marcado como bloqueado', () => {
    const nav = globalThis.navigator as any;
    const antes = Object.getOwnPropertyDescriptor(nav, 'userActivation');
    Object.defineProperty(nav, 'userActivation', { value: { hasBeenActive: false }, configurable: true });
    try {
      toque.preparar();
      expect(toque.bloqueado()).toBe(true);
    } finally {
      if (antes) Object.defineProperty(nav, 'userActivation', antes);
      else delete nav.userActivation;
    }
  });
});
