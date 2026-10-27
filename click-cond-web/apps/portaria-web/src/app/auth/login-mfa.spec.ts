import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { LoginPageComponent } from './login-page.component';
import { ThemeService } from '../shared/theme.service';

describe('Login da portaria — 2ª etapa do síndico', () => {
  function build() {
    TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ThemeService, useValue: { isLight: signal(false), toggleTheme: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(LoginPageComponent);
    return {
      component: fixture.componentInstance,
      http: TestBed.inject(HttpTestingController),
      auth: TestBed.inject(AuthService),
    };
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => TestBed.resetTestingModule());

  it('desafio MFA não grava token e abre a etapa do código', () => {
    const { component, http } = build();
    component.loginValue = 'sindico@demo.com';
    component.senhaValue = 'x';
    component.onSubmit();

    http.expectOne('/api/auth/login-portaria').flush({
      mfa_required: true,
      mfa_token: 'm1',
      email_masked: 'si****@demo.com',
      expires_in_seconds: 600,
    });

    expect(localStorage.getItem('portaria_token')).toBeNull();
    expect(component.mfaToken()).toBe('m1');
    expect(component.mfaEmail()).toBe('si****@demo.com');
  });

  it('código confirmado grava a sessão e o token do dispositivo', () => {
    const { component, http } = build();
    component.mfaToken.set('m1');
    component.codigoMfa = '123456';
    component.lembrarDispositivo = true;
    component.onSubmitMfa();

    const req = http.expectOne('/api/auth/login-portaria/mfa');
    expect(req.request.body).toEqual({ mfa_token: 'm1', code: '123456', remember_device: true });
    req.flush({
      access_token: 'tok',
      id: 1,
      nome: 'S',
      turno: 'Síndico',
      id_condominio: 10,
      condominio_nome: 'C',
      condominios: [{ id: 10, nome: 'C' }],
      device_token: 'dev1',
    });

    expect(localStorage.getItem('portaria_token')).toBe('tok');
    expect(localStorage.getItem('portaria_device_token')).toBe('dev1');
  });

  it('login seguinte envia o token do dispositivo confiável', () => {
    localStorage.setItem('portaria_device_token', 'dev1');
    const { auth, http } = build();
    auth.login('s@d', 'x').subscribe();

    expect(http.expectOne('/api/auth/login-portaria').request.body).toEqual({ login: 's@d', senha: 'x', device_token: 'dev1' });
  });

  it('PC compartilhado da portaria: "lembrar dispositivo" começa desmarcado', () => {
    const { component } = build();
    expect(component.lembrarDispositivo).toBe(false);
  });

  it('logout apaga o token do dispositivo confiável', () => {
    localStorage.setItem('portaria_device_token', 'dev1');
    localStorage.setItem('portaria_token', 'tok');
    const { auth } = build();
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    auth.logout();

    expect(localStorage.getItem('portaria_device_token')).toBeNull();
    expect(localStorage.getItem('portaria_token')).toBeNull();
  });

  it('erro que não é 401 mostra a mensagem da API (ex.: falha ao enviar o código)', () => {
    const { component, http } = build();
    component.loginValue = 'sindico@demo.com';
    component.senhaValue = 'x';
    component.onSubmit();

    http.expectOne('/api/auth/login-portaria').flush(
      { message: 'Não foi possível enviar o código de verificação.' },
      { status: 503, statusText: 'Service Unavailable' },
    );

    expect(component.erro()).toBe('Não foi possível enviar o código de verificação.');
  });

  it('erro sem mensagem da API continua com o aviso de conexão', () => {
    const { component, http } = build();
    component.loginValue = 'sindico@demo.com';
    component.senhaValue = 'x';
    component.onSubmit();

    http.expectOne('/api/auth/login-portaria').flush(null, { status: 502, statusText: 'Bad Gateway' });

    expect(component.erro()).toBe('Falha na conexão com o servidor');
  });
});
