import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { ApartamentosPageComponent } from './apartamentos-page.component';
import { ApartamentosApi } from './apartamentos.service';
import { VagasApi } from './vagas.service';
import { MoradoresApi } from '../moradores/moradores.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';

/**
 * Apartamento sem bloco cai no grupo "Sem bloco": o título do grupo e o do
 * painel de moradores mostram "Sem bloco", não "Bloco Sem bloco".
 */
function build(aptos: any[]) {
  TestBed.configureTestingModule({
    imports: [ApartamentosPageComponent],
    providers: [
      { provide: ApartamentosApi, useValue: { list: jest.fn(() => of(aptos)) } },
      { provide: VagasApi, useValue: {} },
      { provide: MoradoresApi, useValue: {} },
      { provide: HttpClient, useValue: { get: jest.fn(() => of([])) } },
      { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
      { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1 }) } },
    ],
  });
  const f = TestBed.createComponent(ApartamentosPageComponent);
  f.detectChanges();
  return { f, tela: f.componentInstance, el: f.nativeElement as HTMLElement };
}

const titulos = (el: HTMLElement) => Array.from(el.querySelectorAll('h3.ps-h2')).map((h) => h.textContent!.replace(/\s+/g, ' ').trim());

describe('ApartamentosPage — grupo "Sem bloco"', () => {
  it('título do grupo sem bloco é "Sem bloco" e o com bloco segue "Bloco A"', () => {
    const { el } = build([
      { id: 1, apto: '101', bloco: null },
      { id: 2, apto: '102', bloco: '' },
      { id: 3, apto: '201', bloco: 'A' },
    ]);
    const t = titulos(el);
    expect(t).toContain('Sem bloco');
    expect(t).toContain('Bloco A');
    expect(t.some((x) => x.includes('Bloco Sem bloco'))).toBe(false);
  });

  it('painel de moradores do grupo sem bloco: "Sem bloco · Todos os moradores"', async () => {
    const { f, el } = build([{ id: 1, apto: '101', bloco: null }]);
    // Como na tela: o clique no título do grupo abre o painel do bloco.
    (el.querySelector('h3.ps-h2') as HTMLElement).click();
    await f.whenStable();
    f.detectChanges();
    const t = titulos(el);
    expect(t).toContain('Sem bloco · Todos os moradores');
    expect(t.some((x) => x.includes('Bloco Sem bloco'))).toBe(false);
  });

  it('nomeBloco: "Sem bloco" como está; os demais pelo rótulo de bloco', () => {
    const { tela } = build([]);
    expect(tela.nomeBloco('Sem bloco')).toBe('Sem bloco');
    expect(tela.nomeBloco('A')).toBe('Bloco A');
    expect(tela.nomeBloco('Bloco B')).toBe('Bloco B');
  });
});

describe('ApartamentosPage — grafias do mesmo bloco', () => {
  it('"A" e "Bloco A" ficam no mesmo grupo', () => {
    const { el } = build([
      { id: 1, apto: '101', bloco: 'A' },
      { id: 2, apto: '102', bloco: 'Bloco A' },
    ]);
    expect(titulos(el).filter((x) => x === 'Bloco A')).toHaveLength(1);
  });
});

describe('ApartamentosPage — importação em massa mostra as linhas ignoradas', () => {
  it('lista bloco, apto e o motivo', async () => {
    const { f, tela, el } = build([]);
    tela.showBulkModal = true;
    tela.bulkStatus.set('done');
    tela.bulkResult.set({ total: 0, criados: [], ignorados: [{ apto: '101', bloco: 'A', motivo: 'Unidade já cadastrada' }] });
    await f.whenStable();
    f.detectChanges();
    const txt = (el.querySelector('[data-testid="bulk-ignorados"]')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(txt).toContain('1 linha não foi cadastrada');
    expect(txt).toContain('Bloco A 101 — Unidade já cadastrada');
  });
});
