import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { centralGuard } from './central.guard';
import { tokenDeTeste } from './central.testing';

describe('centralGuard', () => {
  function executar() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    return TestBed.runInInjectionContext(() => centralGuard({} as any, { url: '/central' } as any));
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => TestBed.resetTestingModule());

  it('sem token manda para /central/login', () => {
    const r = executar();
    expect(r).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(r as UrlTree)).toBe('/central/login');
  });

  it('token vencido manda para /central/login (e é apagado)', () => {
    localStorage.setItem('central_token', tokenDeTeste({ exp: Math.floor(Date.now() / 1000) - 60 }));
    const r = executar();
    expect(TestBed.inject(Router).serializeUrl(r as UrlTree)).toBe('/central/login');
    expect(localStorage.getItem('central_token')).toBeNull();
  });

  it('token que não é de operador da central manda para /central/login', () => {
    localStorage.setItem('central_token', tokenDeTeste({ papel: undefined, id_condominio: 1 }));
    const r = executar();
    expect(TestBed.inject(Router).serializeUrl(r as UrlTree)).toBe('/central/login');
  });

  it('o token do porteiro não abre a central', () => {
    localStorage.setItem('portaria_token', tokenDeTeste({}));
    expect(executar()).toBeInstanceOf(UrlTree);
  });

  it('token válido de operador entra', () => {
    localStorage.setItem('central_token', tokenDeTeste({}));
    expect(executar()).toBe(true);
  });

  it('token com trocar_senha entra (a página mostra a troca de senha)', () => {
    localStorage.setItem('central_token', tokenDeTeste({ trocar_senha: true }));
    expect(executar()).toBe(true);
  });
});
