import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { RealtimeService } from '../shared/realtime.service';
import { InterfoneApi } from './interfone.api';
import { InterfoneStore } from './interfone.store';
import { PainelChamadaComponent } from './painel-chamada.component';
import { SipVoz } from './sip-voz';
import { ToqueInterfone } from './toque';
import {
  CHAMADA_FACIAL,
  CHAMADA_MORADOR,
  InterfoneApiStub,
  RealtimeStub,
  SipVozFalso,
  ToqueFalso,
} from './interfone.testing';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}
const PORTEIRO = jwt({ sub: 3, id_condominio: 1, turno: 'Manhã', tipo_sub: 'funcionario_portaria' });

describe('PainelChamadaComponent', () => {
  let api: InterfoneApiStub;
  let rt: RealtimeStub;
  let sip: SipVozFalso;
  let store: InterfoneStore;

  function render(configurar?: () => void) {
    TestBed.configureTestingModule({
      imports: [PainelChamadaComponent],
      providers: [
        { provide: AuthService, useValue: { token: PORTEIRO, porteiroInfo: signal({ nome: 'João', turno: 'Manhã', id_condominio: 1 }) } },
        { provide: InterfoneApi, useClass: InterfoneApiStub },
        { provide: RealtimeService, useClass: RealtimeStub },
        { provide: SipVoz, useClass: SipVozFalso },
        { provide: ToqueInterfone, useClass: ToqueFalso },
      ],
    });
    api = TestBed.inject(InterfoneApi) as unknown as InterfoneApiStub;
    rt = TestBed.inject(RealtimeService) as unknown as RealtimeStub;
    sip = TestBed.inject(SipVoz) as unknown as SipVozFalso;
    store = TestBed.inject(InterfoneStore);
    configurar?.();
    const fixture = TestBed.createComponent(PainelChamadaComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const botao = (texto: string) =>
      Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim().toUpperCase() === texto) ?? null;
    return { fixture, el, botao };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('liga o store ao montar e desliga ao destruir', () => {
    const { fixture } = render();
    expect(api.hoje).toHaveBeenCalled();
    expect(store.ativo()).toBe(true);
    fixture.destroy();
    expect(store.ativo()).toBe(false);
  });

  it('módulo desligado: não desenha nada', () => {
    const { el } = render(() => api.hoje.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403 }))));
    expect(el.querySelector('[data-painel-interfone]')).toBeNull();
    expect(el.textContent?.trim()).toBe('');
  });

  it('chamada tocando mostra a unidade, o motivo e ATENDER', async () => {
    const { fixture, el, botao } = render();
    rt.emitir('interfone:chamada', CHAMADA_FACIAL);
    await fixture.whenStable();
    expect(el.textContent).toContain('Bloco A · Apto 106');
    expect(el.textContent).toContain('Morador não atendeu');
    expect(botao('ATENDER')).not.toBeNull();
    expect(botao('ABRIR PORTÃO')).toBeNull();
  });

  it.each([
    ['recusou', 'Morador recusou'],
    ['sem_app', 'Ninguém da unidade recebe chamadas'],
  ])('motivo %s', async (motivo, texto) => {
    const { fixture, el } = render();
    rt.emitir('interfone:chamada', { ...CHAMADA_FACIAL, motivo });
    await fixture.whenStable();
    expect(el.textContent).toContain(texto);
  });

  it('morador ligando mostra o nome e "Morador ligando"', async () => {
    const { fixture, el } = render();
    rt.emitir('interfone:chamada', CHAMADA_MORADOR);
    await fixture.whenStable();
    expect(el.textContent).toContain('Morador ligando');
    expect(el.textContent).toContain('Ana Souza');
  });

  it('ATENDER entra na chamada; em chamada de facial mostra ABRIR PORTÃO e ENCERRAR', async () => {
    const { fixture, botao } = render();
    rt.emitir('interfone:chamada', CHAMADA_FACIAL);
    await fixture.whenStable();
    botao('ATENDER')!.click();
    await fixture.whenStable();
    expect(api.atender).toHaveBeenCalledWith(41);
    sip.ultima!.atender();
    await fixture.whenStable();
    expect(botao('ABRIR PORTÃO')).not.toBeNull();
    expect(botao('ENCERRAR')).not.toBeNull();
    botao('ABRIR PORTÃO')!.click();
    expect(api.abrir).toHaveBeenCalledWith(41);
  });

  it('o vídeo do facial usa o <video> do painel', async () => {
    const { fixture, el, botao } = render();
    rt.emitir('interfone:chamada', CHAMADA_FACIAL);
    await fixture.whenStable();
    botao('ATENDER')!.click();
    await fixture.whenStable();
    const [, video, audio] = sip.entrar.mock.calls[0] as unknown as [unknown, HTMLVideoElement, HTMLAudioElement];
    expect(video).toBe(el.querySelector('video'));
    expect(audio).toBe(el.querySelector('audio'));
  });

  it('chamada unidade_portaria não mostra ABRIR PORTÃO', async () => {
    const { fixture, botao } = render();
    rt.emitir('interfone:chamada', CHAMADA_MORADOR);
    await fixture.whenStable();
    botao('ATENDER')!.click();
    await fixture.whenStable();
    sip.ultima!.atender();
    await fixture.whenStable();
    expect(botao('ENCERRAR')).not.toBeNull();
    expect(botao('ABRIR PORTÃO')).toBeNull();
  });

  it('ENCERRAR desliga', async () => {
    const { fixture, botao } = render();
    rt.emitir('interfone:chamada', CHAMADA_FACIAL);
    await fixture.whenStable();
    botao('ATENDER')!.click();
    await fixture.whenStable();
    botao('ENCERRAR')!.click();
    await fixture.whenStable();
    expect(api.encerrar).toHaveBeenCalledWith(41);
    expect(botao('ENCERRAR')).toBeNull();
  });

  it('microfone negado: aviso de que não vai receber chamadas', async () => {
    const { fixture, el } = render();
    store.microfoneNegado.set(true);
    await fixture.whenStable();
    expect(el.textContent).toContain('Você não vai receber chamadas do interfone');
  });
});
