import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { appRoutes } from '../app.routes';
import { SidebarComponent } from '../shell/sidebar.component';
import { AuthService } from '../auth/auth.service';
import { ThemeService } from '../shared/theme.service';
import { DeliveryApi } from './delivery.service';
import { DeliveryApiStub } from './delivery.testing';
import { DeliveryPageComponent } from './delivery-page.component';
import { DeliveryStore } from './delivery.store';

describe('DeliveryPageComponent', () => {
  let fixture: ComponentFixture<DeliveryPageComponent>;
  let authInfo: any;
  let api: DeliveryApiStub;

  beforeEach(async () => {
    jest.useFakeTimers();
    authInfo = { id_condominio: 1, nome: 'Síndico', turno: 'Síndico' };
    await TestBed.configureTestingModule({
      imports: [DeliveryPageComponent],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: AuthService, useValue: { porteiroInfo: () => authInfo } },
        { provide: ThemeService, useValue: { isLight: signal(false), toggleTheme: jest.fn() } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DeliveryPageComponent);
    api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    fixture.detectChanges();
  });

  afterEach(() => jest.useRealTimers());

  const store = () => fixture.debugElement.injector.get(DeliveryStore);
  const aba = (texto: string) => (Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]')) as HTMLButtonElement[])
    .find((b) => b.textContent?.includes(texto))!;

  it('inclui Delivery no menu e rota protegida no shell', () => {
    const rota = appRoutes
      .find((r) => r.children?.some((c) => c.path === 'delivery'))
      ?.children?.find((r) => r.path === 'delivery');
    const sidebar = TestBed.runInInjectionContext(() => new SidebarComponent());
    expect(rota?.loadComponent).toBeDefined();
    expect(sidebar.menu.flatMap((g) => g.items)).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Delivery', path: '/delivery' })]),
    );
  });

  it('marca a aba ativa e troca o conteúdo', () => {
    expect(aba('Fila').getAttribute('aria-selected')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('Pizzaria Central');
    aba('Entregadores').click();
    fixture.detectChanges();
    expect(aba('Fila').getAttribute('aria-selected')).toBe('false');
    expect(aba('Entregadores').getAttribute('aria-selected')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('Novo entregador');
  });

  it('esconde histórico do porteiro', () => {
    authInfo = { id_condominio: 1, nome: 'Porteiro', turno: 'Noturno' };
    fixture.detectChanges();
    expect(aba('Histórico')).toBeUndefined();
  });

  it('atualiza a fila a cada 20 s só na aba Fila', () => {
    const chamadas = api.listAtivos.mock.calls.length;
    jest.advanceTimersByTime(20_000);
    expect(api.listAtivos.mock.calls.length).toBe(chamadas + 1);
    store().trocarAba('entregadores');
    jest.advanceTimersByTime(20_000);
    expect(api.listAtivos.mock.calls.length).toBe(chamadas + 1);
  });

  it('mostra erro com botão de fechar', () => {
    store().erro.set('Falhou');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Falhou');
    (fixture.nativeElement.querySelector('[aria-label="Fechar aviso"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Falhou');
  });
});
