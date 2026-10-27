import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';

describe('AuthService.alterarSenha — sessão segue com o token novo', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('guarda o access_token devolvido pela troca de senha', () => {
    localStorage.setItem('portaria_token', 'antigo');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    const auth = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpTestingController);

    auth.alterarSenha('atual', 'nova123').subscribe();
    http.expectOne('/api/auth/change-password').flush({ success: true, message: 'ok', access_token: 'novo' });

    expect(localStorage.getItem('portaria_token')).toBe('novo');
  });
});
