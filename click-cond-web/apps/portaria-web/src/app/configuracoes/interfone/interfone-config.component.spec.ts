import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { ConfirmService } from '../../shared/confirm.service';
import { API_BASE } from '../../shared/api.config';
import { ConfiguracoesPageComponent } from '../configuracoes-page.component';
import { InterfoneConfigComponent, analisarRamais } from './interfone-config.component';
import type { FacialInterfone, RamalUnidade } from '../../interfone/interfone.api';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}

const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });
const PORTEIRO = jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Manhã', tipo_sub: 'funcionario_portaria' });
const URL = `${API_BASE}/interfone`;

const CONFIG = { contratado: true, ativo: true, toque_apto_s: 30, transferir: true, toque_portaria_s: 45 };
const RAMAIS: RamalUnidade[] = [
  { id_apartamento: 1, unidade: 'Bloco A · Apto 106', ramal: null, sugestao: null, conflito: true },
  { id_apartamento: 2, unidade: 'Bloco B · Apto 106', ramal: null, sugestao: null, conflito: true },
  { id_apartamento: 3, unidade: 'Bloco A · Apto 201', ramal: null, sugestao: '201', conflito: false },
];
const FACIAL: FacialInterfone = {
  id: 9, nome: 'Portão social', modelo: 'SS 3532 MF W', habilitado: true, blocos: ['A'], dtmf: '#1',
  conta: 'fac-9', senha: 'abcDEF123456789012345678', servidor: 'voz.prestarecondominios.com.br', porta: 5060,
  registrado: false, registrado_em: null,
};

function providers(token: string, turno: string | null) {
  return [
    provideHttpClient(),
    provideHttpClientTesting(),
    provideRouter([]),
    {
      provide: AuthService,
      useValue: {
        porteiroInfo: signal({ nome: 'Ana', turno, id_condominio: 1 }),
        condominioNome: signal('Residencial Demo'),
        token,
        alterarSenha: jest.fn(),
        tokenRenovado$: { subscribe: () => ({ unsubscribe: () => undefined }) },
      },
    },
    { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
  ];
}

describe('Configurações — aba Interfone', () => {
  let http: HttpTestingController;
  afterEach(() => TestBed.resetTestingModule());

  function render(token: string, turno: string | null) {
    TestBed.configureTestingModule({ imports: [ConfiguracoesPageComponent], providers: providers(token, turno) });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ConfiguracoesPageComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, aba: () => el.querySelector('button[data-aba-interfone]') as HTMLButtonElement | null };
  }

  it('contratado: a aba aparece e abre a tela do módulo', () => {
    const { fixture, el, aba } = render(SINDICO, 'Síndico');
    http.expectOne({ method: 'GET', url: `${URL}/config` }).flush(CONFIG);
    fixture.detectChanges();
    expect(aba()?.textContent).toContain('Interfone');
    aba()!.click();
    fixture.detectChanges();
    expect(el.querySelector('app-interfone-config')).not.toBeNull();
  });

  it('não contratado: a aba some', () => {
    const { fixture, aba } = render(SINDICO, 'Síndico');
    http.expectOne(`${URL}/config`).flush({ ...CONFIG, contratado: false });
    fixture.detectChanges();
    expect(aba()).toBeNull();
  });

  it('403 (não contratado): a aba some e forçar a aba não monta a tela', () => {
    const { fixture, el, aba } = render(SINDICO, 'Síndico');
    http.expectOne(`${URL}/config`).flush({}, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(aba()).toBeNull();
    fixture.componentInstance.currentTab.set('interfone');
    fixture.detectChanges();
    expect(el.querySelector('app-interfone-config')).toBeNull();
  });

  it('porteiro: nem consulta', () => {
    render(PORTEIRO, 'Manhã');
    expect(http.match(`${URL}/config`)).toHaveLength(0);
  });
});

describe('analisarRamais', () => {
  it('duplicado, inválido e conflito sem ramal definido', () => {
    const r = analisarRamais(RAMAIS, { 3: '12a' });
    expect(r.get(1)).toBe('pendente');
    expect(r.get(2)).toBe('pendente');
    expect(r.get(3)).toBe('invalido');
    const r2 = analisarRamais(RAMAIS, { 1: '1106', 2: '1106', 3: '201' });
    expect(r2.get(1)).toBe('duplicado');
    expect(r2.get(2)).toBe('duplicado');
    expect(r2.get(3)).toBeNull();
    const r3 = analisarRamais(RAMAIS, { 1: '1106', 2: '2106' });
    expect([...r3.values()].every((v) => v === null)).toBe(true);
  });
});

describe('InterfoneConfigComponent', () => {
  let http: HttpTestingController;
  afterEach(() => TestBed.resetTestingModule());

  function render() {
    TestBed.configureTestingModule({ imports: [InterfoneConfigComponent], providers: providers(SINDICO, 'Síndico') });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(InterfoneConfigComponent);
    fixture.detectChanges();
    http.expectOne(`${URL}/config`).flush(CONFIG);
    http.expectOne(`${URL}/faciais`).flush([FACIAL]);
    http.expectOne(`${URL}/ramais`).flush(RAMAIS);
    http.expectOne(`${URL}/monitores`).flush([]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const salvarRamais = () => el.querySelector('button[data-salvar-ramais]') as HTMLButtonElement;
    return { fixture, el, salvarRamais };
  }

  it('conflito de ramal aparece destacado e bloqueia salvar', () => {
    const { el, salvarRamais } = render();
    expect(el.querySelectorAll('[data-conflito]')).toHaveLength(2);
    expect(el.textContent).toContain('Conflito');
    expect(salvarRamais().disabled).toBe(true);
  });

  it('resolvido o conflito, salvar manda só o que mudou', () => {
    const { fixture, el, salvarRamais } = render();
    const input = (id: number) => el.querySelector(`input[data-ramal="${id}"]`) as HTMLInputElement;
    input(1).value = '1106';
    input(1).dispatchEvent(new Event('input'));
    input(2).value = '2106';
    input(2).dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-conflito]')).toHaveLength(0);
    expect(salvarRamais().disabled).toBe(false);
    salvarRamais().click();
    const req = http.expectOne({ method: 'PUT', url: `${URL}/ramais` });
    expect(req.request.body).toEqual([
      { id_apartamento: 1, ramal: '1106' },
      { id_apartamento: 2, ramal: '2106' },
    ]);
    req.flush(RAMAIS.map((r, i) => ({ ...r, ramal: ['1106', '2106', null][i], conflito: false })));
  });

  it('aplicar sugestões preenche só quem não tem ramal e tem sugestão', () => {
    const { fixture, el } = render();
    (el.querySelector('button[data-aplicar-sugestoes]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((el.querySelector('input[data-ramal="3"]') as HTMLInputElement).value).toBe('201');
    expect((el.querySelector('input[data-ramal="1"]') as HTMLInputElement).value).toBe('');
  });

  it('facial mostra status e dados do instalador', () => {
    const { el } = render();
    expect(el.textContent).toContain('Portão social');
    expect(el.textContent).toContain('Não registrado');
    expect(el.textContent).toContain('voz.prestarecondominios.com.br');
    expect(el.textContent).toContain('fac-9');
  });

  it('tempo de toque fora da faixa não salva', () => {
    const { fixture, el } = render();
    fixture.componentInstance.toqueApto.set(5);
    fixture.detectChanges();
    (el.querySelector('button[data-salvar-config]') as HTMLButtonElement).click();
    expect(http.match({ method: 'PUT', url: `${URL}/config` })).toHaveLength(0);
    fixture.detectChanges();
    expect(el.textContent).toContain('entre 15 e 60');
  });

  it('gerar nova senha: a API devolve só {senha}; a tela mostra e copia a NOVA', async () => {
    const escrever = jest.fn(() => Promise.resolve());
    const nav = globalThis.navigator as any;
    const antes = Object.getOwnPropertyDescriptor(nav, 'clipboard');
    Object.defineProperty(nav, 'clipboard', { value: { writeText: escrever }, configurable: true });
    try {
      const { fixture, el } = render();
      const botao = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Gerar nova senha')!;
      botao.click();
      await fixture.whenStable();
      const req = http.expectOne({ method: 'POST', url: `${URL}/faciais/9/nova-senha` });
      req.flush({ senha: 'NovaSenhaGerada000000000' });
      fixture.detectChanges();
      expect(el.textContent).toContain('NovaSenhaGerada000000000');
      expect(el.textContent).not.toContain(FACIAL.senha!);
      expect(escrever).toHaveBeenLastCalledWith('NovaSenhaGerada000000000');
      expect(fixture.componentInstance.faciais()[0]).toMatchObject({ id: 9, senha: 'NovaSenhaGerada000000000' });
      expect(Object.keys(fixture.componentInstance.edFacial())).toEqual(['9']);

      escrever.mockClear();
      (el.querySelector('button[aria-label="Copiar senha"]') as HTMLButtonElement).click();
      expect(escrever).toHaveBeenCalledWith('NovaSenhaGerada000000000');
    } finally {
      if (antes) Object.defineProperty(nav, 'clipboard', antes);
      else delete nav.clipboard;
    }
  });

  it('salvar módulo manda a configuração sem "contratado"', () => {
    const { fixture, el } = render();
    fixture.componentInstance.transferir.set(false);
    fixture.detectChanges();
    (el.querySelector('button[data-salvar-config]') as HTMLButtonElement).click();
    const req = http.expectOne({ method: 'PUT', url: `${URL}/config` });
    expect(req.request.body).toEqual({ ativo: true, toque_apto_s: 30, transferir: false, toque_portaria_s: 45 });
    req.flush({ ...CONFIG, transferir: false });
  });
});
