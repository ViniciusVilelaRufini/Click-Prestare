import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { CentralAuthService } from './central-auth.service';
import { tokenDeTeste } from './central.testing';

describe('CentralAuthService', () => {
  let auth: CentralAuthService;
  let http: HttpTestingController;

  function montar() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(CentralAuthService);
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('login manda e-mail e senha e devolve o desafio (sem gravar sessão)', async () => {
    montar();
    const p = firstValueFrom(auth.login(' olga@central.example ', 'senha-de-teste-1'));
    const req = http.expectOne('/api/central/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'olga@central.example', senha: 'senha-de-teste-1' });
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ desafio: 'd-1', email_mascarado: 'o***@central.example' });
    expect(await p).toEqual({ desafio: 'd-1', email_mascarado: 'o***@central.example' });
    expect(localStorage.getItem('central_token')).toBeNull();
  });

  it('verificar grava central_token (não mexe no token do porteiro) e preenche o operador', async () => {
    montar();
    localStorage.setItem('portaria_token', 'tok-porteiro');
    const token = tokenDeTeste();
    const p = firstValueFrom(auth.verificar('d-1', '123456'));
    const req = http.expectOne('/api/central/auth/verificar');
    expect(req.request.body).toEqual({ desafio: 'd-1', codigo: '123456' });
    req.flush({ access_token: token, nome: 'Olga Operadora', trocar_senha: false });
    await p;
    expect(localStorage.getItem('central_token')).toBe(token);
    expect(localStorage.getItem('portaria_token')).toBe('tok-porteiro');
    expect(auth.operador()).toEqual({ nome: 'Olga Operadora', trocar_senha: false });
    expect(auth.logado()).toBe(true);
  });

  it('token com trocar_senha: operador marcado para trocar', async () => {
    montar();
    const p = firstValueFrom(auth.verificar('d-1', '123456'));
    http.expectOne('/api/central/auth/verificar').flush({ access_token: tokenDeTeste({ trocar_senha: true }), nome: 'Olga Operadora', trocar_senha: true });
    await p;
    expect(auth.operador()?.trocar_senha).toBe(true);
  });

  it('trocarSenha grava o token novo, tira a marca e avisa quem mantém o socket', async () => {
    montar();
    localStorage.setItem('central_token', tokenDeTeste({ trocar_senha: true }));
    auth.recarregar();
    const avisos: string[] = [];
    auth.tokenRenovado$.subscribe((t) => avisos.push(t));
    const novo = tokenDeTeste({ cred: 'novo' });
    const p = firstValueFrom(auth.trocarSenha('temporaria-123', 'senha-nova-123'));
    const req = http.expectOne('/api/central/auth/senha');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${localStorage.getItem('central_token')}`);
    expect(req.request.body).toEqual({ senha_atual: 'temporaria-123', senha_nova: 'senha-nova-123' });
    req.flush({ access_token: novo, nome: 'Olga Operadora', trocar_senha: false });
    await p;
    expect(localStorage.getItem('central_token')).toBe(novo);
    expect(auth.operador()?.trocar_senha).toBe(false);
    expect(avisos).toEqual([novo]);
  });

  it('trocarSenha recusa senha nova com menos de 10 caracteres sem chamar a API', async () => {
    montar();
    localStorage.setItem('central_token', tokenDeTeste({ trocar_senha: true }));
    await expect(firstValueFrom(auth.trocarSenha('a', 'curta'))).rejects.toBeTruthy();
    http.expectNone('/api/central/auth/senha');
  });

  it('marcarTrocarSenha (403 da API) liga a marca no operador', () => {
    localStorage.setItem('central_token', tokenDeTeste());
    montar();
    auth.marcarTrocarSenha();
    expect(auth.operador()?.trocar_senha).toBe(true);
  });

  it('logout apaga só a sessão da central', () => {
    localStorage.setItem('central_token', tokenDeTeste());
    localStorage.setItem('portaria_token', 'tok-porteiro');
    montar();
    expect(auth.logado()).toBe(true);
    auth.logout();
    expect(localStorage.getItem('central_token')).toBeNull();
    expect(localStorage.getItem('portaria_token')).toBe('tok-porteiro');
    expect(auth.operador()).toBeNull();
    expect(auth.logado()).toBe(false);
  });

  it('mensagem de erro do login em pt-BR (401 genérico, 429 bloqueado)', () => {
    montar();
    expect(CentralAuthService.mensagemDeErro(new HttpErrorResponse({ status: 401 }))).toBe('E-mail ou senha incorretos.');
    expect(CentralAuthService.mensagemDeErro(new HttpErrorResponse({ status: 429 }))).toBe(
      'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    );
  });

  it('etapa do código mostra o texto da API quando vem (tentativas restantes)', () => {
    montar();
    const e = new HttpErrorResponse({ status: 401, error: { message: 'Código incorreto. Restam 2 tentativa(s).' } });
    expect(CentralAuthService.mensagemDeErro(e, 'codigo')).toBe('Código incorreto. Restam 2 tentativa(s).');
    expect(CentralAuthService.mensagemDeErro(new HttpErrorResponse({ status: 401 }), 'codigo')).toBe(
      'Código inválido ou vencido. Confira o e-mail ou entre de novo.',
    );
    // No login, o 401 continua genérico (não diz se o e-mail existe).
    expect(CentralAuthService.mensagemDeErro(new HttpErrorResponse({ status: 401, error: { message: 'Qualquer' } }), 'login')).toBe(
      'E-mail ou senha incorretos.',
    );
  });
});
