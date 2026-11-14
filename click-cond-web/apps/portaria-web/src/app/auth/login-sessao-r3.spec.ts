import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { LoginPageComponent } from './login-page.component';
import { authInterceptor } from './auth.interceptor';
import { ThemeService } from '../shared/theme.service';
import { ConfiguracoesPageComponent } from '../configuracoes/configuracoes-page.component';

/**
 * Rodada 3 (raia s), console:
 * B1 — trava por tentativas e "síndico sem condomínio ativo" apareciam como "Login ou senha incorretos".
 * M10 — o porteiro não tinha como recuperar a senha (sem "Esqueci a senha") nem trocá-la (Configurações bloqueada).
 * M11 — todo 401 deslogava e apagava o aparelho confiável, inclusive o 401 de um login que nem tinha sessão.
 * B5 — o QR Code de síndico chegava sem a lista de condomínios e com os fallbacks "Turno QR" e condomínio 1.
 */
describe('Console — login e sessão (rodada 3)', () => {
  function build() {
    TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ThemeService, useValue: { isLight: signal(false), toggleTheme: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(LoginPageComponent);
    const router = TestBed.inject(Router);
    jest.spyOn(router, 'navigate').mockResolvedValue(true);
    return { component: fixture.componentInstance, http: TestBed.inject(HttpTestingController), router };
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  describe('B1 — motivo da recusa do login', () => {
    it.each([
      ['Muitas tentativas falhas. Tente novamente mais tarde.', 'Muitas tentativas falhas. Tente novamente mais tarde.'],
      ['Síndico sem condomínio ativo vinculado.', 'Síndico sem condomínio ativo vinculado.'],
      ['Credenciais inválidas.', 'Login ou senha incorretos'],
    ])('401 "%s" → "%s"', (msgApi, tela) => {
      const { component, http } = build();
      component.loginValue = 'p@x.com';
      component.senhaValue = 'x';
      component.onSubmit();
      http.expectOne('/api/auth/login-portaria').flush({ message: msgApi }, { status: 401, statusText: 'Unauthorized' });
      expect(component.erro()).toBe(tela);
    });
  });

  describe('M11 — 401 sem sessão não apaga o aparelho confiável', () => {
    it('senha errada no login mantém o aparelho confiável do síndico', () => {
      localStorage.setItem('portaria_device_token', 'dev-1');
      const { component, http } = build();
      component.loginValue = 'sindico@x.com';
      component.senhaValue = 'errada';
      component.onSubmit();
      http.expectOne('/api/auth/login-portaria').flush({ message: 'Credenciais inválidas.' }, { status: 401, statusText: 'Unauthorized' });
      expect(localStorage.getItem('portaria_device_token')).toBe('dev-1');
    });

    it('401 de uma sessão aberta continua encerrando a sessão', () => {
      build();
      localStorage.setItem('portaria_token', 'tok');
      localStorage.setItem('portaria_info', JSON.stringify({ nome: 'P', turno: 'Diurno', id_condominio: 7 }));
      const http = TestBed.inject(HttpClient);
      const ctrl = TestBed.inject(HttpTestingController);
      http.get('/api/qualquer').subscribe({ error: () => undefined });
      ctrl.expectOne('/api/qualquer').flush({ message: 'Sessão encerrada' }, { status: 401, statusText: 'Unauthorized' });
      expect(localStorage.getItem('portaria_token')).toBeNull();
    });
  });

  describe('M10 — "Esqueci a senha" no login', () => {
    it.each([
      ['funcionario', '/api/funcionarios/recovery-password'],
      ['sindico', '/api/sindico/recovery-password'],
    ] as const)('papel %s chama %s e mostra a resposta neutra', (papel, rota) => {
      const { component, http } = build();
      component.abrirRecuperacao();
      component.emailRecuperacao = ' p@x.com ';
      component.papelRecuperacao.set(papel);
      component.enviarRecuperacao();
      const req = http.expectOne(rota);
      expect(req.request.body).toEqual({ email: 'p@x.com' });
      req.flush({ success: true, message: 'Se o e-mail estiver cadastrado, enviamos as instruções para redefinição.' });
      expect(component.msgRecuperacao()).toBe('Se o e-mail estiver cadastrado, enviamos as instruções para redefinição.');
    });

    it('erro do pedido aparece na tela', () => {
      const { component, http } = build();
      component.abrirRecuperacao();
      component.emailRecuperacao = 'p@x.com';
      component.enviarRecuperacao();
      http.expectOne('/api/funcionarios/recovery-password').flush({ message: 'Muitas solicitações.' }, { status: 429, statusText: 'Too Many' });
      expect(component.erro()).toBe('Muitas solicitações.');
    });
  });

  describe('B5 — sessão pelo QR Code', () => {
    function confirmarQr(resposta: Record<string, unknown>) {
      jest.useFakeTimers();
      const ctx = build();
      ctx.component.toggleQrMode(true);
      ctx.http.expectOne('/api/auth/qr/session').flush({ qrToken: 'q1', expiresAt: '' });
      jest.advanceTimersByTime(1500);
      ctx.http.expectOne('/api/auth/qr/status/q1').flush({ status: 'confirmed', access_token: 'tok', id: 42, nome: 'S', ...resposta });
      return ctx;
    }

    it('síndico com dois condomínios guarda a lista e vai escolher o condomínio', () => {
      const { router } = confirmarQr({
        turno: 'Síndico',
        id_condominio: 7,
        condominio_nome: 'C7',
        condominios: [{ id: 7, nome: 'C7' }, { id: 8, nome: 'C8' }],
      });
      expect(JSON.parse(localStorage.getItem('portaria_info')!).condominios).toHaveLength(2);
      expect(router.navigate).toHaveBeenCalledWith(['/selecionar-condominio']);
    });

    it('resposta sem condomínio ou sem turno não vira sessão "Turno QR" no condomínio 1', () => {
      const { component } = confirmarQr({ nome: 'S' });
      expect(localStorage.getItem('portaria_token')).toBeNull();
      expect(component.erro()).toBeTruthy();
    });
  });

  describe('M10 — Configurações para o porteiro', () => {
    it('o porteiro vê só "Segurança e Perfil"', () => {
      localStorage.setItem('portaria_token', 'tok');
      localStorage.setItem('portaria_info', JSON.stringify({ nome: 'P', turno: 'Diurno', id_condominio: 7 }));
      TestBed.configureTestingModule({
        imports: [ConfiguracoesPageComponent],
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      const fixture = TestBed.createComponent(ConfiguracoesPageComponent);
      fixture.componentInstance.currentTab.set('terminais');
      fixture.detectChanges();
      const abas = Array.from(fixture.nativeElement.querySelectorAll('.ps-seg button')).map((b: any) => b.textContent.trim());
      expect(abas).toEqual(['Segurança e Perfil']);
      expect(fixture.componentInstance.abaAtual()).toBe('conta');
    });

    it('o síndico continua vendo as quatro abas', () => {
      localStorage.setItem('portaria_token', 'tok');
      localStorage.setItem('portaria_info', JSON.stringify({ nome: 'S', turno: 'Síndico', id_condominio: 7 }));
      TestBed.configureTestingModule({
        imports: [ConfiguracoesPageComponent],
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      const fixture = TestBed.createComponent(ConfiguracoesPageComponent);
      fixture.componentInstance.currentTab.set('regras');
      expect(fixture.componentInstance.abaAtual()).toBe('regras');
      // Só conta as abas (sem renderizar o conteúdo das outras, que chama a API).
      fixture.componentInstance.currentTab.set('conta');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.ps-seg button')).toHaveLength(4);
    });
  });
});
