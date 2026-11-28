import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { SipVoz } from '../interfone/sip-voz';
import { ToqueInterfone } from '../interfone/toque';
import { SipVozFalso, ToqueFalso } from '../interfone/interfone.testing';
import { AlarmeCentral } from './central-alarme';
import { CentralApi } from './central-api';
import { CentralAuthService } from './central-auth.service';
import { CentralLoginPageComponent } from './central-login-page.component';
import { CentralPageComponent } from './central-page.component';
import { CentralRealtimeService } from './central-realtime.service';
import {
  AlarmeFalso,
  CHAMADA_A,
  CHAMADA_B,
  CentralApiStub,
  CentralRealtimeStub,
  PANICO,
  PEDIDO,
  tokenDeTeste,
} from './central.testing';

const tique = () => new Promise((r) => setTimeout(r, 0));

describe('Central — tela', () => {
  let api: CentralApiStub;
  let rt: CentralRealtimeStub;
  let sip: SipVozFalso;
  let http: HttpTestingController;

  function montar(token: string | null) {
    localStorage.clear();
    if (token) localStorage.setItem('central_token', token);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CentralApi, useClass: CentralApiStub },
        { provide: CentralRealtimeService, useClass: CentralRealtimeStub },
        { provide: SipVoz, useClass: SipVozFalso },
        { provide: ToqueInterfone, useClass: ToqueFalso },
        { provide: AlarmeCentral, useClass: AlarmeFalso },
      ],
    });
    api = TestBed.inject(CentralApi) as unknown as CentralApiStub;
    rt = TestBed.inject(CentralRealtimeService) as unknown as CentralRealtimeStub;
    sip = TestBed.inject(SipVoz) as unknown as SipVozFalso;
    http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(CentralPageComponent);
    f.detectChanges();
    return f;
  }

  const el = (f: { nativeElement: HTMLElement }) => f.nativeElement as HTMLElement;
  const botao = (f: { nativeElement: HTMLElement }, texto: string) =>
    [...el(f).querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('operador com senha temporária vê só a troca de senha; a central não começa', () => {
    const f = montar(tokenDeTeste({ trocar_senha: true }));
    expect(el(f).querySelector('app-central-trocar-senha')).not.toBeNull();
    expect(el(f).querySelector('app-central-fila')).toBeNull();
    expect(api.fila).not.toHaveBeenCalled();
    expect(rt.on).not.toHaveBeenCalled();
  });

  it('trocou a senha: grava o token novo e a central começa (fila, alertas, socket)', async () => {
    const f = montar(tokenDeTeste({ trocar_senha: true }));
    const inputs = el(f).querySelectorAll('app-central-trocar-senha input');
    const digitar = (i: number, v: string) => {
      (inputs[i] as HTMLInputElement).value = v;
      inputs[i].dispatchEvent(new Event('input'));
    };
    digitar(0, 'temporaria-1');
    digitar(1, 'senha-nova-123');
    digitar(2, 'senha-nova-123');
    (el(f).querySelector('app-central-trocar-senha form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const novo = tokenDeTeste({ cred: 'novo' });
    http.expectOne('/api/central/auth/senha').flush({ access_token: novo, nome: 'Olga Operadora', trocar_senha: false });
    await tique();
    f.detectChanges();
    await f.whenStable();
    expect(localStorage.getItem('central_token')).toBe(novo);
    expect(el(f).querySelector('app-central-trocar-senha')).toBeNull();
    expect(api.fila).toHaveBeenCalled();
    expect(rt.total('interfone:chamada')).toBe(1);
  });

  it('troca de senha com 401 (sessão encerrada): sai e volta para o login', async () => {
    const f = montar(tokenDeTeste({ trocar_senha: true }));
    const nav = jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const inputs = el(f).querySelectorAll('app-central-trocar-senha input');
    ['temporaria-1', 'senha-nova-123', 'senha-nova-123'].forEach((v, i) => {
      (inputs[i] as HTMLInputElement).value = v;
      inputs[i].dispatchEvent(new Event('input'));
    });
    (el(f).querySelector('app-central-trocar-senha form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    http.expectOne('/api/central/auth/senha').flush({ message: 'Sessão encerrada.' }, { status: 401, statusText: 'Unauthorized' });
    await tique();
    f.detectChanges();
    await f.whenStable();
    expect(localStorage.getItem('central_token')).toBeNull();
    expect(nav).toHaveBeenCalledWith('/central/login');
  });

  /** Atende a chamada da fila pela tela e deixa a conversa em curso. */
  async function atenderPelaTela(f: { nativeElement: HTMLElement; detectChanges: () => void }) {
    f.detectChanges();
    (el(f).querySelector('app-central-fila li button') as HTMLButtonElement).click();
    await tique();
    sip.ultima!.atender();
    f.detectChanges();
  }

  it('chamada encerrada: o contexto fica com "Chamada encerrada" até Fechar', async () => {
    const f = montar(tokenDeTeste());
    rt.emitir('interfone:chamada', CHAMADA_A);
    await atenderPelaTela(f);
    botao(f, 'Encerrar')!.click();
    f.detectChanges();
    const aside = () => el(f).querySelector('app-central-atendimento aside')!.textContent!;
    expect(aside()).toContain('Chamada encerrada');
    expect(aside()).toContain('Ana, Bruno');
    expect(el(f).querySelector('input[name="pedido-nome"]')).toBeNull();
    botao(f, 'Fechar')!.click();
    f.detectChanges();
    expect(aside()).not.toContain('Ana, Bruno');
    expect(aside()).not.toContain('Chamada encerrada');
  });

  it('pedido mostra o alcance do push', async () => {
    const f = montar(tokenDeTeste());
    rt.emitir('interfone:chamada', CHAMADA_A);
    await atenderPelaTela(f);
    const ev = (alcance: unknown) => {
      rt.emitir('interfone:pedido', { ...PEDIDO, alcance, id_chamada: 41, id_condominio: 1 });
      f.detectChanges();
    };
    const card = () => el(f).querySelector('[data-teste="pedido"]')!.textContent!;
    ev({ apps: 2, antigos: 0 });
    expect(card()).toContain('Enviado para 2 celulares');
    ev({ apps: 1, antigos: 0 });
    expect(card()).toContain('Enviado para 1 celular');
    ev({ apps: 0, antigos: 0 });
    expect(card()).toContain('Nenhum morador pode responder pelo app');
    expect(card()).not.toContain('desatualizado');
    ev({ apps: 0, antigos: 1 });
    expect(card()).toContain('Nenhum morador pode responder pelo app — morador com app desatualizado');
  });

  it('"Pedir autorização ao morador" só em chamada com portão', async () => {
    const f = montar(tokenDeTeste());
    rt.emitir('interfone:chamada', { ...CHAMADA_A, id: 43, tipo: 'unidade_portaria', foto_url: null, morador_nome: 'Ana' });
    await atenderPelaTela(f);
    expect(el(f).querySelector('app-central-atendimento')!.textContent).toContain('Ana, Bruno');
    expect(botao(f, 'Pedir autorização ao morador')).toBeUndefined();
    botao(f, 'Encerrar')!.click();
    f.detectChanges();
    botao(f, 'Fechar')!.click();
    rt.emitir('interfone:chamada', CHAMADA_A);
    await atenderPelaTela(f);
    expect(botao(f, 'Pedir autorização ao morador')).toBeDefined();
  });

  it('mostra a fila com condomínio, unidade e portão; Atender entra na chamada com o contexto', async () => {
    const f = montar(tokenDeTeste());
    rt.emitir('interfone:chamada', CHAMADA_B);
    rt.emitir('interfone:chamada', CHAMADA_A);
    f.detectChanges();
    const itens = el(f).querySelectorAll('app-central-fila li');
    expect(itens).toHaveLength(2);
    expect(itens[0].textContent).toContain('Residencial Boa Vista');
    expect(itens[0].textContent).toContain('Bloco A · Apto 106');
    expect(itens[0].textContent).toContain('Portão social');
    (itens[0].querySelector('button') as HTMLButtonElement).click();
    await tique();
    f.detectChanges();
    expect(api.atender).toHaveBeenCalledWith(41);
    const ctx = el(f).querySelector('app-central-atendimento')!.textContent!;
    expect(ctx).toContain('Ana, Bruno');
    expect(ctx).toContain('Rodrigo');
    expect(ctx).toContain('Deixe no armário 3.');
  });

  it('Abrir portão pede o motivo: sem motivo não abre; "outro" exige descrição', async () => {
    const f = montar(tokenDeTeste());
    rt.emitir('interfone:chamada', CHAMADA_A);
    f.detectChanges();
    (el(f).querySelector('app-central-fila li button') as HTMLButtonElement).click();
    await tique();
    sip.ultima!.atender();
    f.detectChanges();
    botao(f, 'Abrir portão')!.click();
    f.detectChanges();
    const confirmar = () => botao(f, 'Confirmar e abrir')!;
    expect(confirmar().disabled).toBe(true);
    const radios = [...el(f).querySelectorAll('input[name="motivo-abrir"]')] as HTMLInputElement[];
    expect(radios).toHaveLength(6);
    radios[5].dispatchEvent(new Event('change')); // outro
    f.detectChanges();
    expect(confirmar().disabled).toBe(true);
    const detalhe = el(f).querySelector('input[name="detalhe-abrir"]') as HTMLInputElement;
    detalhe.value = 'Técnico da operadora';
    detalhe.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(confirmar().disabled).toBe(false);
    radios[1].dispatchEvent(new Event('change')); // entrega
    f.detectChanges();
    confirmar().click();
    await tique();
    expect(api.abrir).toHaveBeenCalledWith(41, 'entrega', undefined);
  });

  it('pânico aparece como alerta e "Visto" marca', async () => {
    const f = montar(tokenDeTeste());
    rt.emitir('alerta:novo', { ...PANICO });
    f.detectChanges();
    const alerta = el(f).querySelector('app-central-alertas [role="alert"]');
    expect(alerta?.textContent).toContain('Pânico');
    expect(alerta?.textContent).toContain('Residencial Boa Vista');
    (alerta!.querySelector('button') as HTMLButtonElement).click();
    await tique();
    f.detectChanges();
    expect(api.alertaVisto).toHaveBeenCalledWith(7);
    expect(el(f).querySelector('app-central-alertas [role="alert"]')).toBeNull();
  });

  it('aba Ligar: escolhe o condomínio, busca a unidade e liga', async () => {
    jest.useFakeTimers();
    try {
      const f = montar(tokenDeTeste());
      botao(f, 'Ligar')!.click();
      f.detectChanges();
      const select = el(f).querySelector('select[name="condominio-ligar"]') as HTMLSelectElement;
      select.value = '1';
      select.dispatchEvent(new Event('change'));
      f.detectChanges();
      const busca = el(f).querySelector('input[name="unidade-ligar"]') as HTMLInputElement;
      busca.value = '106';
      busca.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(300);
      f.detectChanges();
      expect(api.unidades).toHaveBeenCalledWith(1, '106');
      (el(f).querySelector('[data-teste="resultados-unidade"] button') as HTMLButtonElement).click();
      await jest.runOnlyPendingTimersAsync();
      expect(api.ligar).toHaveBeenCalledWith(100);
    } finally {
      jest.useRealTimers();
    }
  });

  it('Sair apaga a sessão da central e volta para o login', () => {
    const f = montar(tokenDeTeste());
    const router = TestBed.inject(Router);
    const nav = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    botao(f, 'Sair')!.click();
    f.detectChanges();
    expect(localStorage.getItem('central_token')).toBeNull();
    expect(nav).toHaveBeenCalledWith('/central/login');
    expect(rt.desconectar).toHaveBeenCalled();
  });

  it('a Central derrubou o socket: o aviso diz que está reconectando (logo, sem esperar a carência)', async () => {
    const f = montar(tokenDeTeste());
    rt.conectado.set(false);
    rt.reconectando.set(true);
    f.detectChanges();
    await f.whenStable();
    const aviso = el(f).querySelector('[role="alert"]')?.textContent ?? '';
    expect(aviso).toContain('Tentando reconectar');
    expect(el(f).querySelector('[data-teste="conexao"]')?.textContent).toContain('Reconectando');
    rt.reconectando.set(false);
    rt.conectado.set(true);
    f.detectChanges();
    await f.whenStable();
    expect(el(f).querySelector('[role="alert"]')).toBeNull();
    expect(el(f).querySelector('[data-teste="conexao"]')?.textContent).toContain('Conectado');
  });
});

describe('Central — login', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('senha → código → entra na central', async () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const nav = jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const f = TestBed.createComponent(CentralLoginPageComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const digitar = (sel: string, v: string) => {
      const i = el.querySelector(sel) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    digitar('input[name="email"]', 'olga@central.example');
    digitar('input[name="senha"]', 'senha-de-teste-1');
    f.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    http.expectOne('/api/central/auth/login').flush({ desafio: 'd-1', email_mascarado: 'o***@central.example' });
    await tique();
    f.detectChanges();
    expect(el.textContent).toContain('o***@central.example');
    digitar('input[name="codigo"]', '123456');
    f.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/central/auth/verificar');
    expect(req.request.body).toEqual({ desafio: 'd-1', codigo: '123456' });
    req.flush({ access_token: tokenDeTeste(), nome: 'Olga Operadora', trocar_senha: false });
    await tique();
    expect(nav).toHaveBeenCalledWith('/central');
    expect(TestBed.inject(CentralAuthService).logado()).toBe(true);
  });

  it('senha errada: mensagem genérica em pt-BR', async () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(CentralLoginPageComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    f.componentInstance.email.set('olga@central.example');
    f.componentInstance.senha.set('errada');
    void f.componentInstance.entrar();
    http.expectOne('/api/central/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });
    await tique();
    f.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('E-mail ou senha incorretos.');
  });
});
