import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { RealtimeService } from '../shared/realtime.service';
import { API_BASE } from '../shared/api.config';
import { InterfoneApi } from './interfone.api';
import { InterfoneStore } from './interfone.store';
import { SipVoz } from './sip-voz';
import { ToqueInterfone } from './toque';
import { RealtimeStub, SipVozFalso, ToqueFalso } from './interfone.testing';

/**
 * Contrato com a API (C1 da revisão final): o console só liga o interfone quando
 * `GET /interfone/portaria/hoje` responde 200. Condomínio sem o módulo responde
 * 403 `{ motivo: 'modulo_desligado' }` e o painel fica desligado, sem ouvintes.
 * Aqui o InterfoneApi é o de verdade, sobre o HttpClient de teste.
 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}

const PORTEIRO = jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Manhã', tipo_sub: 'funcionario_portaria' });

describe('InterfoneStore × API (contrato do módulo desligado)', () => {
  let store: InterfoneStore;
  let http: HttpTestingController;
  let rt: RealtimeStub;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        InterfoneApi,
        { provide: AuthService, useValue: { token: PORTEIRO, porteiroInfo: signal({ nome: 'João', turno: 'Manhã', id_condominio: 1 }) } },
        { provide: RealtimeService, useClass: RealtimeStub },
        { provide: SipVoz, useClass: SipVozFalso },
        { provide: ToqueInterfone, useClass: ToqueFalso },
      ],
    });
    store = TestBed.inject(InterfoneStore);
    http = TestBed.inject(HttpTestingController);
    rt = TestBed.inject(RealtimeService) as unknown as RealtimeStub;
  });

  afterEach(() => {
    store.parar();
    http.verify();
    TestBed.resetTestingModule();
  });

  it('403 modulo_desligado da API: painel desligado e nada é ouvido', () => {
    store.iniciar();
    const req = http.expectOne(`${API_BASE}/interfone/portaria/hoje`);
    expect(req.request.method).toBe('GET');
    req.flush(
      { statusCode: 403, motivo: 'modulo_desligado', message: 'O interfone não está ligado neste condomínio.' },
      { status: 403, statusText: 'Forbidden' },
    );
    expect(store.ativo()).toBe(false);
    expect(rt.on).not.toHaveBeenCalled();
    expect(store.semChamadas()).toBeNull();
  });

  it('200 com a lista do dia: painel ligado e ouvindo as chamadas', () => {
    store.iniciar();
    http.expectOne(`${API_BASE}/interfone/portaria/hoje`).flush([]);
    expect(store.ativo()).toBe(true);
    expect(rt.total('interfone:chamada')).toBe(1);
  });

  it('módulo desligado no meio do turno: o 403 do ligar vira a mensagem da API', async () => {
    store.iniciar();
    http.expectOne(`${API_BASE}/interfone/portaria/hoje`).flush([]);
    const p = store.ligar(100, 'Apto 106');
    http
      .expectOne(`${API_BASE}/interfone/portaria/ligar`)
      .flush(
        { statusCode: 403, motivo: 'modulo_desligado', message: 'O interfone não está ligado neste condomínio.' },
        { status: 403, statusText: 'Forbidden' },
      );
    await p;
    expect(store.erro()).toBe('O interfone não está ligado neste condomínio.');
    expect(store.emChamada()).toBeNull();
  });
});
