import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { ConfirmService } from '../../shared/confirm.service';
import { API_BASE } from '../../shared/api.config';
import { ConfiguracoesPageComponent } from '../configuracoes-page.component';
import { InterfoneConfigComponent, analisarRamais, bloqueiaSalvar } from './interfone-config.component';
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
  conta: 'fac9', senha: 'abcDEF123456789012345678', servidor: 'voz.prestarecondominios.com.br', porta: 5080,
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
  it('duplicado, inválido e unidade sem ramal e sem sugestão', () => {
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

  it('unidade sem dígitos (sem ramal, sem sugestão, sem conflito) é "sem_numero", informativo e sem bloquear', () => {
    const itens: RamalUnidade[] = [{ id_apartamento: 9, unidade: 'Cobertura', ramal: null, sugestao: null, conflito: false }];
    const r = analisarRamais(itens, {});
    expect(r.get(9)).toBe('sem_numero');
    expect(bloqueiaSalvar('sem_numero')).toBe(false);
    expect(analisarRamais(itens, { 9: '900' }).get(9)).toBeNull();
  });

  it('vazio com sugestão não é problema; só duplicado e inválido bloqueiam salvar', () => {
    const r = analisarRamais(RAMAIS, {});
    expect(r.get(3)).toBeNull();
    expect(bloqueiaSalvar('pendente')).toBe(false);
    expect(bloqueiaSalvar(null)).toBe(false);
    expect(bloqueiaSalvar('duplicado')).toBe(true);
    expect(bloqueiaSalvar('invalido')).toBe(true);
  });
});

describe('InterfoneConfigComponent', () => {
  let http: HttpTestingController;
  afterEach(() => TestBed.resetTestingModule());

  function render(faciais: FacialInterfone[] = [FACIAL]) {
    TestBed.configureTestingModule({ imports: [InterfoneConfigComponent], providers: providers(SINDICO, 'Síndico') });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(InterfoneConfigComponent);
    fixture.detectChanges();
    http.expectOne(`${URL}/config`).flush(CONFIG);
    http.expectOne(`${URL}/faciais`).flush(faciais);
    http.expectOne(`${URL}/ramais`).flush(RAMAIS);
    http.expectOne(`${URL}/monitores`).flush([]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const salvarRamais = () => el.querySelector('button[data-salvar-ramais]') as HTMLButtonElement;
    return { fixture, el, salvarRamais };
  }

  it('unidade sem ramal e sem sugestão aparece destacada, mas não bloqueia salvar as outras', () => {
    const { fixture, el, salvarRamais } = render();
    expect(el.querySelectorAll('[data-conflito]')).toHaveLength(2);
    expect(el.textContent).toContain('Conflito');
    expect(el.querySelector('[data-sem-ramal]')?.textContent).toContain('3 sem ramal');
    expect(el.querySelector('[data-a-resolver]')).toBeNull();
    // Nada mudou ainda: não há o que salvar.
    expect(salvarRamais().disabled).toBe(true);

    const input = el.querySelector('input[data-ramal="3"]') as HTMLInputElement;
    input.value = '201';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-sem-ramal]')?.textContent).toContain('2 sem ramal');
    expect(salvarRamais().disabled).toBe(false);
    salvarRamais().click();
    const req = http.expectOne({ method: 'PUT', url: `${URL}/ramais` });
    expect(req.request.body).toEqual([{ id_apartamento: 3, ramal: '201' }]);
    req.flush(RAMAIS.map((r) => (r.id_apartamento === 3 ? { ...r, ramal: '201' } : r)));
  });

  it('ramal preenchido repetido ou inválido bloqueia salvar e conta em "a resolver"', () => {
    const { fixture, el, salvarRamais } = render();
    const input = (id: number) => el.querySelector(`input[data-ramal="${id}"]`) as HTMLInputElement;
    input(1).value = '1106';
    input(1).dispatchEvent(new Event('input'));
    input(2).value = '1106';
    input(2).dispatchEvent(new Event('input'));
    input(3).value = '20a';
    input(3).dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-a-resolver]')?.textContent).toContain('3 a resolver');
    expect(salvarRamais().disabled).toBe(true);
    input(2).value = '2106';
    input(2).dispatchEvent(new Event('input'));
    input(3).value = '';
    input(3).dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-a-resolver]')).toBeNull();
    expect(salvarRamais().disabled).toBe(false);
  });

  it('tabela de ramais cabe no painel: sem largura mínima, colunas fixas e situação cortada com reticências', () => {
    const { el } = render();
    const tabela = el.querySelector('table[data-tabela-ramais]') as HTMLTableElement;
    expect(tabela.className).toContain('!min-w-0');
    expect(tabela.className).toContain('table-fixed');
    const tag = el.querySelector('[data-conflito] [data-situacao]') as HTMLElement;
    expect(tag.className).toContain('max-w-full');
    expect(tag.querySelector('.truncate')?.textContent).toContain('Conflito');
    expect(tag.getAttribute('title')).toContain('Conflito');
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

  it('coluna Sugestão só mostra o número quando o ramal está vazio; com ramal preenchido mostra "—"', () => {
    const { fixture, el } = render();
    const sug = (id: number) => el.querySelector(`td[data-sugestao="${id}"]`)?.textContent?.trim();
    expect(sug(3)).toBe('201');
    const input = el.querySelector('input[data-ramal="3"]') as HTMLInputElement;
    input.value = '1201';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(sug(3)).toBe('—');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(sug(3)).toBe('201');
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
    expect(el.textContent).toContain('fac9');
  });

  describe('configurar automaticamente (Intelbras)', () => {
    const botaoConfigurar = (el: HTMLElement) => el.querySelector('button[data-configurar-facial="9"]') as HTMLButtonElement | null;

    it('só aparece para facial com config_automatica (Intelbras) habilitado', () => {
      expect(botaoConfigurar(render().el)).toBeNull();
      TestBed.resetTestingModule();
      expect(botaoConfigurar(render([{ ...FACIAL, habilitado: false, config_automatica: true }]).el)).toBeNull();
      TestBed.resetTestingModule();
      expect(botaoConfigurar(render([{ ...FACIAL, config_automatica: true }]).el)?.textContent).toContain('Configurar automaticamente');
    });

    it('sucesso: chama a rota, trava o botão enquanto roda e mostra "Facial configurado"', () => {
      const { fixture, el } = render([{ ...FACIAL, config_automatica: true }]);
      botaoConfigurar(el)!.click();
      fixture.detectChanges();
      const req = http.expectOne({ method: 'POST', url: `${URL}/faciais/9/configurar` });
      expect(req.request.body).toEqual({ forcar: false });
      expect(botaoConfigurar(el)!.disabled).toBe(true);
      expect(botaoConfigurar(el)!.textContent).toContain('Configurando');
      req.flush({ ok: true });
      fixture.detectChanges();
      expect(botaoConfigurar(el)!.disabled).toBe(false);
      expect(el.querySelector('[data-resultado-config="9"]')?.textContent).toContain('Facial configurado');
    });

    it('falha do aparelho ({ok:false, erro}) e erro HTTP aparecem no card, com os dados manuais ainda na tela', () => {
      const { fixture, el } = render([{ ...FACIAL, config_automatica: true }]);
      botaoConfigurar(el)!.click();
      http.expectOne(`${URL}/faciais/9/configurar`).flush({ ok: false, erro: 'interfone: o aparelho não devolveu a configuração SIP' });
      fixture.detectChanges();
      const res = () => el.querySelector('[data-resultado-config="9"]')?.textContent ?? '';
      expect(res()).toContain('não devolveu a configuração SIP');
      expect(el.textContent).toContain('fac9');

      botaoConfigurar(el)!.click();
      http.expectOne(`${URL}/faciais/9/configurar`).flush(null, { status: 502, statusText: 'Bad Gateway' });
      fixture.detectChanges();
      expect(res()).toContain('Não foi possível configurar');
    });

    it('parcial: avisa para clicar de novo; conflitos aparecem no card', () => {
      const { fixture, el } = render([{ ...FACIAL, config_automatica: true }]);
      botaoConfigurar(el)!.click();
      http.expectOne(`${URL}/faciais/9/configurar`).flush({ ok: true, parcial: true, restantes: 15, conflitos: ['301'], avisos: [] });
      fixture.detectChanges();
      const res = el.querySelector('[data-resultado-config="9"]')?.textContent ?? '';
      expect(res).toContain('Parcial: clique de novo para continuar');
      expect(res).toContain('15');
      expect(res).toContain('301');
    });

    it('sucesso com avisos ou conflitos: "Configurado com ressalvas"', () => {
      const { fixture, el } = render([{ ...FACIAL, config_automatica: true }]);
      botaoConfigurar(el)!.click();
      http.expectOne(`${URL}/faciais/9/configurar`).flush({
        ok: true, parcial: false, restantes: 0, conflitos: ['301'], avisos: ['contato 106: o aparelho mostra "Bloco A"'],
      });
      fixture.detectChanges();
      const res = el.querySelector('[data-resultado-config="9"]')?.textContent ?? '';
      expect(res).toContain('Configurado com ressalvas');
      expect(res).toContain('301');
      expect(res).toContain('o aparelho mostra');
      expect(res).not.toContain('Facial configurado');
    });

    it('conta SIP de outro servidor: pergunta antes; confirmando, manda de novo com forcar', async () => {
      const { fixture, el } = render([{ ...FACIAL, config_automatica: true }]);
      const confirm = TestBed.inject(ConfirmService) as unknown as { ask: jest.Mock };
      botaoConfigurar(el)!.click();
      http.expectOne(`${URL}/faciais/9/configurar`).flush({ ok: false, erro: 'sip_de_outro_servidor', servidor_atual: '10.0.0.5' });
      await fixture.whenStable();
      expect(confirm.ask).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('10.0.0.5') }));
      const segunda = http.expectOne(`${URL}/faciais/9/configurar`);
      expect(segunda.request.body).toEqual({ forcar: true });
      segunda.flush({ ok: true, parcial: false, restantes: 0, conflitos: [], avisos: [] });
      fixture.detectChanges();
      expect(el.querySelector('[data-resultado-config="9"]')?.textContent).toContain('Facial configurado');
    });

    it('conta SIP de outro servidor: recusando a confirmação, nada é regravado', async () => {
      const { fixture, el } = render([{ ...FACIAL, config_automatica: true }]);
      const confirm = TestBed.inject(ConfirmService) as unknown as { ask: jest.Mock };
      confirm.ask.mockResolvedValueOnce(false);
      botaoConfigurar(el)!.click();
      http.expectOne(`${URL}/faciais/9/configurar`).flush({ ok: false, erro: 'sip_de_outro_servidor', servidor_atual: '10.0.0.5' });
      await fixture.whenStable();
      http.expectNone(`${URL}/faciais/9/configurar`);
      fixture.detectChanges();
      const res = el.querySelector('[data-resultado-config="9"]')?.textContent ?? '';
      expect(res).toContain('10.0.0.5');
      expect(res).toContain('nada foi alterado');
    });
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
