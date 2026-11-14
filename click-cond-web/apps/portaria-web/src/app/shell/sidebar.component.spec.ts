import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { SidebarComponent } from './sidebar.component';
import { AuthService } from '../auth/auth.service';
import { ThemeService } from '../shared/theme.service';

describe('SidebarComponent — itens do menu por papel', () => {
  let info: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { porteiroInfo: () => info } },
        { provide: ThemeService, useValue: { isLight: signal(false), toggleTheme: jest.fn() } },
      ],
    });
  });

  const visiveis = () => {
    const s = TestBed.runInInjectionContext(() => new SidebarComponent());
    return s.menu.flatMap((g) => g.items).filter((i) => s.mostraNoMenu(i.path)).map((i) => i.path);
  };

  it('porteiro vê Configurações (troca da própria senha), mas não Financeiro nem Relatórios', () => {
    info = { id_condominio: 1, nome: 'Porteiro', turno: 'Noturno' };
    const paths = visiveis();
    expect(paths).toContain('/configuracoes');
    expect(paths).not.toContain('/financeiro');
    expect(paths).not.toContain('/relatorios');
  });

  it('síndico vê todos os itens', () => {
    info = { id_condominio: 1, nome: 'Síndico', turno: 'Síndico' };
    expect(visiveis()).toEqual(expect.arrayContaining(['/configuracoes', '/financeiro', '/relatorios']));
  });
});
