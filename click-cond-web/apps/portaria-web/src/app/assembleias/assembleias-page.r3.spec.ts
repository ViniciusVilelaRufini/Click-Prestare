import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AssembleiasPageComponent } from './assembleias-page.component';
import { AssembleiasApi } from './assembleias.service';
import { AuthService } from '../auth/auth.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Rodada 3:
 *  - B5: a data da assembleia era texto livre — agora é campo de data;
 *  - B6: a pauta não mostrava status nem período e não tinha "Encerrar";
 *    a lista misturava assembleias de meses atrás com as próximas.
 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}
const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });
const PORTEIRO = jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' });

const PASSADA = { id: 1, titulo: 'AGO antiga', data: '10/03/2026', hora: '19:30' };
const PASSADA2 = { id: 4, titulo: 'AGE de junho', data: '15/06/2026', hora: '19:30' };
const PROXIMA = { id: 2, titulo: 'AGE próxima', data: '20/11/2026', hora: '19:30' };
const DETALHE = {
  assembleia: PROXIMA,
  votacoes: [
    { id: 10, titulo: 'Contas', data_inicio: '01/11/2026', data_termino: '25/11/2026', status: 1, opcoes: ['1;Aprovar;1'] },
    { id: 11, titulo: 'Obra', data_inicio: '01/11/2026', data_termino: '05/11/2026', status: 2, opcoes: ['3;Aprovar;0'] },
  ],
  meusVotos: [],
};

describe('AssembleiasPageComponent — rodada 3', () => {
  function render(token: string) {
    const api: any = {
      listAssembleias: jest.fn(() => of([PASSADA, PASSADA2, PROXIMA])),
      listEnquetes: jest.fn(() => of([])),
      getAssembleia: jest.fn(() => of(DETALHE)),
      finishVotacao: jest.fn(() => of({})),
      insertAssembleia: jest.fn(() => of({})),
    };
    TestBed.configureTestingModule({
      imports: [AssembleiasPageComponent],
      providers: [
        { provide: AssembleiasApi, useValue: api },
        { provide: ConfirmService, useValue: { ask: jest.fn(async () => true) } },
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno: 'Diurno', id_condominio: 1 }), token } },
      ],
    });
    const fixture = TestBed.createComponent(AssembleiasPageComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, api, comp: fixture.componentInstance };
  }
  const botoes = (el: HTMLElement, texto: string) =>
    Array.from(el.querySelectorAll('button')).filter((b) => b.textContent?.trim().includes(texto));

  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-13T15:00:00Z'), doNotFake: ['queueMicrotask'] }));
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  describe('B6 — lista separa as passadas', () => {
    it('próximas primeiro; realizadas depois, da mais recente para a mais antiga', () => {
      const { comp } = render(SINDICO);
      expect(comp.assembleiasProximas().map((a) => a.id)).toEqual([2]);
      expect(comp.assembleiasRealizadas().map((a) => a.id)).toEqual([4, 1]);
    });

    it('mostra a seção "Já realizadas" e marca o cartão', () => {
      const { el } = render(SINDICO);
      const texto = el.textContent ?? '';
      expect(texto).toContain('Próximas');
      expect(texto).toContain('Já realizadas');
      expect(texto.indexOf('AGE próxima')).toBeLessThan(texto.indexOf('Já realizadas'));
      expect(texto.indexOf('Já realizadas')).toBeLessThan(texto.indexOf('AGE de junho'));
    });

    it('hoje conta como próxima', () => {
      const { comp } = render(SINDICO);
      expect(comp.ehPassada({ ...PROXIMA, data: '13/11/2026' } as any)).toBe(false);
      expect(comp.ehPassada({ ...PROXIMA, data: '12/11/2026' } as any)).toBe(true);
      expect(comp.ehPassada({ ...PROXIMA, data: '' } as any)).toBe(false);
    });
  });

  describe('B6 — pauta com status, período e Encerrar', () => {
    it('síndico: selo, período e "Encerrar votação" só na pauta em andamento', () => {
      const { fixture, el, comp } = render(SINDICO);
      comp.verAssembleia(2);
      fixture.detectChanges();
      const texto = el.textContent ?? '';
      expect(texto).toContain('Em votação');
      expect(texto).toContain('Encerrada');
      expect(texto).toContain('01/11/2026 a 25/11/2026');
      expect(botoes(el, 'Encerrar votação')).toHaveLength(1);
    });

    it('encerrar a pauta recarrega o painel da assembleia', () => {
      const { fixture, el, comp, api } = render(SINDICO);
      comp.verAssembleia(2);
      fixture.detectChanges();
      botoes(el, 'Encerrar votação')[0].click();
      expect(api.finishVotacao).toHaveBeenCalledWith(10);
      expect(api.getAssembleia).toHaveBeenCalledTimes(2);
      expect(comp.selectedAssembleia()).not.toBeNull();
    });

    it('porteiro: vê o selo, mas não o botão', () => {
      const { fixture, el, comp } = render(PORTEIRO);
      comp.verAssembleia(2);
      fixture.detectChanges();
      expect(el.textContent).toContain('Em votação');
      expect(botoes(el, 'Encerrar votação')).toHaveLength(0);
    });
  });

  describe('B5 — data como campo de data', () => {
    it('drawer abre com input date preenchido com hoje (AAAA-MM-DD)', () => {
      const { fixture, el, comp } = render(SINDICO);
      comp.abrirModalAssembleia();
      fixture.detectChanges();
      const input = el.querySelector('.ps-drawer input[type="date"]') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(comp.novaAssembleia.data).toBe('2026-11-13');
    });
  });
});
