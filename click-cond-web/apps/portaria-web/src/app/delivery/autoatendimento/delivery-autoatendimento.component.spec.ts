import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../../auth/auth.service';
import { API_BASE } from '../../shared/api.config';
import { DeliveryAutoatendimentoComponent } from './delivery-autoatendimento.component';

/**
 * Painel "Autoatendimento no portão" na página de delivery: liga/desliga e
 * horário por condomínio. Só o síndico (typeAccess do token, o mesmo critério
 * do assertSindicoEstrito da API) vê e mexe.
 */

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}

const SINDICO = jwt({ sub: 7, id_condominio: 1, typeAccess: 'Sindico' });
const PORTEIRO = jwt({ sub: 3, id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' });
const URL_CONFIG = `${API_BASE}/entrega/config`;

describe('DeliveryAutoatendimentoComponent', () => {
  let http: HttpTestingController;

  afterEach(() => {
    http?.verify();
    TestBed.resetTestingModule();
  });

  function montar(token: string) {
    TestBed.configureTestingModule({
      imports: [DeliveryAutoatendimentoComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1, turno: 'Síndico' }), token } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DeliveryAutoatendimentoComponent);
    fixture.detectChanges();
    return fixture;
  }

  const botao = (el: HTMLElement, texto: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;

  function carregar(fixture: ReturnType<typeof montar>, corpo = { habilitado: false, inicio: null, fim: null }) {
    const req = http.expectOne((r) => r.url === URL_CONFIG && r.method === 'GET');
    expect(req.request.params.get('id_condominio')).toBe('1');
    req.flush(corpo);
    fixture.detectChanges();
  }

  it('porteiro não vê o painel e nada é buscado', () => {
    const fixture = montar(PORTEIRO);
    http.expectNone(() => true);
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('síndico vê o painel com a explicação, a chave, os horários e "Salvar"', async () => {
    const fixture = montar(SINDICO);
    carregar(fixture, { habilitado: true, inicio: '07:00', fim: '22:00' } as any);
    await fixture.whenStable(); // ngModel grava o valor no input depois de um microtask
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Autoatendimento no portão');
    expect(el.textContent).toContain('O entregador lê o QR no portão, tira uma foto e o morador decide. Gere o QR de cada portão em Terminais.');
    expect((el.querySelector('input[name="habilitado"]') as HTMLInputElement).checked).toBe(true);
    expect(fixture.componentInstance.inicio()).toBe('07:00');
    expect(fixture.componentInstance.fim()).toBe('22:00');
    expect(botao(el, 'Salvar')).toBeTruthy();
  });

  it('"Salvar" envia { id_condominio, habilitado, inicio, fim }; horários vazios vão como null (dia inteiro)', () => {
    const fixture = montar(SINDICO);
    carregar(fixture);
    const c = fixture.componentInstance;
    c.habilitado.set(true);
    c.inicio.set('');
    c.fim.set('');
    fixture.detectChanges();
    botao(fixture.nativeElement, 'Salvar')!.click();
    const req = http.expectOne((r) => r.url === URL_CONFIG && r.method === 'PUT');
    expect(req.request.body).toEqual({ id_condominio: 1, habilitado: true, inicio: null, fim: null });
    req.flush({ habilitado: true, inicio: null, fim: null });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Salvo.');
  });

  it('horário só com início mostra o erro devolvido pela API', () => {
    const fixture = montar(SINDICO);
    carregar(fixture);
    const c = fixture.componentInstance;
    c.habilitado.set(true);
    c.inicio.set('07:00');
    c.fim.set('');
    botao(fixture.nativeElement, 'Salvar')!.click();
    const req = http.expectOne((r) => r.url === URL_CONFIG && r.method === 'PUT');
    expect(req.request.body).toEqual({ id_condominio: 1, habilitado: true, inicio: '07:00', fim: null });
    req.flush({ message: 'Horário inválido. Use HH:MM.' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Horário inválido. Use HH:MM.');
  });

  it('falha ao carregar avisa e não mostra uma chave que mentiria', () => {
    const fixture = montar(SINDICO);
    http.expectOne((r) => r.url === URL_CONFIG).flush({}, { status: 500, statusText: 'x' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Não foi possível carregar o autoatendimento de entregas.');
    expect(fixture.nativeElement.querySelector('input[name="habilitado"]')).toBeNull();
  });
});
