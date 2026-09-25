import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RedefinirSenhaPageComponent } from './redefinir-senha-page.component';
import { appRoutes } from '../app.routes';
import { ThemeService } from '../shared/theme.service';

describe('RedefinirSenhaPageComponent — Web Reset (F2)', () => {
  function build(params: Record<string, string>, query: Record<string, string>) {
    TestBed.configureTestingModule({
      imports: [RedefinirSenhaPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(params),
              queryParamMap: convertToParamMap(query),
            },
          },
        },
        { provide: ThemeService, useValue: { isLight: signal(false) } },
      ],
    });
    const fixture = TestBed.createComponent(RedefinirSenhaPageComponent);
    return {
      component: fixture.componentInstance,
      fixture,
      http: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('identifica quando o token está ausente na URL', () => {
    const { component } = build({}, {});
    component.ngOnInit();
    expect(component.token()).toBe('');
    expect(component.semToken()).toBe(true);
  });

  it('lê o token dos parâmetros da query (formato ?token=)', () => {
    const { component } = build({}, { token: 'token-valido-123' });
    component.ngOnInit();
    expect(component.token()).toBe('token-valido-123');
    expect(component.semToken()).toBe(false);
  });

  it('lê o token dos parâmetros da query (formato raiz ?redefinir-senha=)', () => {
    const { component } = build({}, { 'redefinir-senha': 'token-raiz-456' });
    component.ngOnInit();
    expect(component.token()).toBe('token-raiz-456');
    expect(component.semToken()).toBe(false);
  });

  it('valida tamanho mínimo de senha e igualdade na confirmação', () => {
    const { component } = build({}, { token: 'token-123' });
    component.ngOnInit();

    component.novaSenha.set('12345');
    component.confirmarSenha.set('12345');
    component.salvar();
    expect(component.erro()).toContain('mínimo 6 caracteres');

    component.novaSenha.set('SenhaForte123');
    component.confirmarSenha.set('SenhaDiferente');
    component.salvar();
    expect(component.erro()).toContain('não conferem');
  });

  it('envia requisição com sucesso e exibe confirmação', () => {
    const { component, http } = build({}, { token: 'token-123' });
    component.ngOnInit();

    component.novaSenha.set('NovaSenhaForte@2026');
    component.confirmarSenha.set('NovaSenhaForte@2026');
    component.salvar();

    const req = http.expectOne((r) => r.url.endsWith('/auth/redefinir-senha'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      token: 'token-123',
      nova_senha: 'NovaSenhaForte@2026',
    });

    req.flush({ success: true, message: 'Senha alterada com sucesso!' });

    expect(component.sucesso()).toBe(true);
    expect(component.mensagemSucesso()).toBe('Senha alterada com sucesso!');
  });

  it('abre a tela de redefinição ao navegar para a raiz com ?redefinir-senha=', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(appRoutes),
        { provide: ThemeService, useValue: { isLight: signal(false) } },
      ],
    });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/?redefinir-senha=token-url-raiz', RedefinirSenhaPageComponent);

    expect(component).toBeInstanceOf(RedefinirSenhaPageComponent);
    expect(component.token()).toBe('token-url-raiz');
    expect(component.semToken()).toBe(false);
  });
});
