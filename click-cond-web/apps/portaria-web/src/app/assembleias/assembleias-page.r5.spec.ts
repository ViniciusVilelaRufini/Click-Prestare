import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AssembleiasPageComponent } from './assembleias-page.component';
import { AssembleiasApi } from './assembleias.service';
import { AuthService } from '../auth/auth.service';
import { ConfirmService } from '../shared/confirm.service';
import { ServerClockService } from '../core/server-clock.service';

/**
 * Rodada 5 — assembleia robusta. A API passa a esconder a contagem enquanto a
 * votação está aberta (`resultado_oculto`, votos = 0) e manda a participação
 * (quórum). O console não pode mostrar "0 voto(s) (0%)" como se fosse
 * resultado; com a API antiga (sem o campo) segue como antes.
 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}
const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });

const ASSEMBLEIA = { id: 2, titulo: 'AGE próxima', data: '20/11/2026', hora: '19:30' };
const PAUTA_OCULTA = {
  id: 10, titulo: 'Contas', data_inicio: '01/11/2026', data_termino: '25/11/2026', status: 1,
  opcoes: ['1;Aprovar;0', '2;Rejeitar;0'],
  resultado_oculto: true, somente_proprietarios: 0, participacao: { unidades_votaram: 3, unidades_total: 12 }, encerrada_em: null,
};
const PAUTA_ENCERRADA = {
  id: 11, titulo: 'Obra', data_inicio: '01/11/2026', data_termino: '05/11/2026', status: 2,
  opcoes: ['3;Aprovar;4', '4;Rejeitar;1'],
  resultado_oculto: false, somente_proprietarios: 1, participacao: { unidades_votaram: 5, unidades_total: 12 },
  encerrada_em: '2026-11-05T18:00:00.000Z',
};
/** API antiga: sem os campos novos. */
const PAUTA_ANTIGA = { id: 12, titulo: 'Fachada', data_inicio: '01/11/2026', data_termino: '25/11/2026', status: 1, opcoes: ['5;Aprovar;2'] };

describe('AssembleiasPageComponent — rodada 5 (resultado oculto e participação)', () => {
  function render(over: Record<string, any> = {}) {
    const api: any = {
      listAssembleias: jest.fn(() => of([ASSEMBLEIA])),
      listEnquetes: jest.fn(() => of([])),
      getAssembleia: jest.fn(() => of({ assembleia: ASSEMBLEIA, votacoes: [PAUTA_OCULTA], meusVotos: [] })),
      ...over,
    };
    TestBed.configureTestingModule({
      imports: [AssembleiasPageComponent],
      providers: [
        { provide: AssembleiasApi, useValue: api },
        { provide: ConfirmService, useValue: { ask: jest.fn(async () => true) } },
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno: 'Diurno', id_condominio: 1 }), token: SINDICO } },
        { provide: ServerClockService, useValue: { agora: () => new Date('2026-11-13T15:00:00Z') } },
      ],
    });
    const fixture = TestBed.createComponent(AssembleiasPageComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, api, comp: fixture.componentInstance };
  }
  const cartao = (el: HTMLElement, titulo: string) =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-votacao]')).find((c) => c.textContent?.includes(titulo))!;

  afterEach(() => TestBed.resetTestingModule());

  it('pauta aberta com resultado oculto: sem barras e sem contagem; mostra aviso e participação', () => {
    const { fixture, el, comp } = render();
    comp.verAssembleia(2);
    fixture.detectChanges();
    const c = cartao(el, 'Contas');
    expect(c.textContent).toContain('Resultado disponível quando a votação for encerrada');
    expect(c.textContent).toContain('3 de 12 unidades votaram');
    expect(c.textContent).not.toContain('voto(s)');
    expect(c.textContent).not.toContain('Total apurado');
    expect(c.querySelector('.bg-accent')).toBeNull();
  });

  it('pauta encerrada: contagem real e participação', () => {
    const { fixture, el, comp } = render({
      getAssembleia: jest.fn(() => of({ assembleia: ASSEMBLEIA, votacoes: [PAUTA_ENCERRADA], meusVotos: [] })),
    });
    comp.verAssembleia(2);
    fixture.detectChanges();
    const c = cartao(el, 'Obra');
    expect(c.textContent).toContain('4 voto(s) (80%)');
    expect(c.textContent).toContain('5 de 12 unidades votaram');
    expect(c.textContent).not.toContain('Resultado disponível');
    expect(c.querySelectorAll('.bg-accent').length).toBe(2);
  });

  it('API antiga (sem resultado_oculto nem participação): mostra a contagem como antes', () => {
    const { fixture, el, comp } = render({
      getAssembleia: jest.fn(() => of({ assembleia: ASSEMBLEIA, votacoes: [PAUTA_ANTIGA], meusVotos: [] })),
    });
    comp.verAssembleia(2);
    fixture.detectChanges();
    const c = cartao(el, 'Fachada');
    expect(c.textContent).toContain('2 voto(s) (100%)');
    expect(c.textContent).toContain('Total apurado: 2 voto(s)');
    expect(c.textContent).not.toContain('Resultado disponível');
    expect(c.textContent).not.toContain('unidades votaram');
  });

  it('enquete aberta com resultado oculto: mesma regra na aba de enquetes', () => {
    const enquete = { ...PAUTA_OCULTA, id: 20, titulo: 'Academia 24h', participacao: { unidades_votaram: 0, unidades_total: 40 } };
    const { fixture, el, comp } = render({ listEnquetes: jest.fn(() => of([enquete])) });
    comp.tab.set('enquetes');
    fixture.detectChanges();
    const c = cartao(el, 'Academia 24h');
    expect(c.textContent).toContain('Resultado disponível quando a votação for encerrada');
    expect(c.textContent).toContain('0 de 40 unidades votaram');
    expect(c.textContent).not.toContain('Total apurado');
    expect(c.querySelector('.bg-accent')).toBeNull();
  });

  it('enquete da API antiga: barras e total como antes', () => {
    const { fixture, el, comp } = render({ listEnquetes: jest.fn(() => of([{ ...PAUTA_ANTIGA, id: 21, titulo: 'Pet' }])) });
    comp.tab.set('enquetes');
    fixture.detectChanges();
    const c = cartao(el, 'Pet');
    expect(c.textContent).toContain('Total apurado: 2');
    expect(c.querySelector('.bg-accent')).toBeTruthy();
  });

  describe('Finalizadas (histórico somente leitura)', () => {
    const FINALIZADA = {
      id: 8, titulo: 'AGO de março', data: '10/03/2026', hora: '19:30',
      finalizada: true, finalizada_em: '2026-03-10T23:40:00.000Z',
    };
    const DETALHE_FINALIZADA = {
      assembleia: { ...FINALIZADA, link_ata: 'https://arquivos.exemplo/ata-8.pdf?assinatura=x' },
      votacoes: [PAUTA_ENCERRADA],
      meusVotos: [],
    };
    const PASSADA = { id: 4, titulo: 'AGE de junho', data: '15/06/2026', hora: '19:30', finalizada: false };

    it('lista: finalizada sai de Próximas/Já realizadas e vai para "Finalizadas", sem excluir', () => {
      const { el, comp } = render({ listAssembleias: jest.fn(() => of([FINALIZADA, PASSADA, ASSEMBLEIA])) });
      expect(comp.assembleiasProximas().map((a) => a.id)).toEqual([2]);
      expect(comp.assembleiasRealizadas().map((a) => a.id)).toEqual([4]);
      expect(comp.assembleiasFinalizadas().map((a) => a.id)).toEqual([8]);
      const texto = el.textContent ?? '';
      expect(texto).toContain('Finalizadas');
      expect(texto.indexOf('Já realizadas')).toBeLessThan(texto.indexOf('AGO de março'));
      const card = el.querySelector('[data-assembleia="8"]') as HTMLElement;
      expect(card.textContent).toContain('Finalizada');
      expect(card.textContent).toContain('10/03/2026 20:40');
      expect(card.querySelector('button[title="Excluir"]')).toBeNull();
      // As outras continuam com Excluir para o síndico.
      expect(el.querySelector('[data-assembleia="4"] button[title="Excluir"]')).toBeTruthy();
      // A contagem da aba é das que estão em andamento.
      expect(comp.assembleiasAtivas()).toHaveLength(2);
    });

    it('só finalizadas: não mostra "Nenhuma assembleia agendada" como lista vazia', () => {
      const { el } = render({ listAssembleias: jest.fn(() => of([FINALIZADA])) });
      expect(el.textContent).toContain('AGO de março');
      expect(el.textContent).toContain('Finalizadas');
    });

    it('detalhe da finalizada: sem pauta nova, sem finalizar, sem excluir, sem encerrar; com link da ATA', () => {
      const { fixture, el, comp } = render({
        listAssembleias: jest.fn(() => of([FINALIZADA])),
        getAssembleia: jest.fn(() => of({ ...DETALHE_FINALIZADA, votacoes: [PAUTA_ENCERRADA, PAUTA_OCULTA] })),
      });
      comp.verAssembleia(8);
      fixture.detectChanges();
      const texto = el.textContent ?? '';
      expect(texto).toContain('Finalizada em 10/03/2026 20:40');
      const rotulos = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
      expect(rotulos.some((t) => t.includes('Adicionar Pauta'))).toBe(false);
      expect(rotulos.some((t) => t.includes('Finalizar e Gerar ATA'))).toBe(false);
      expect(rotulos.some((t) => t === 'Excluir')).toBe(false);
      expect(rotulos.some((t) => t.includes('Encerrar votação'))).toBe(false);
      const ata = Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('Abrir ATA')) as HTMLAnchorElement;
      expect(ata.getAttribute('href')).toBe('https://arquivos.exemplo/ata-8.pdf?assinatura=x');
      expect(ata.getAttribute('target')).toBe('_blank');
    });

    it('excluir pauta com voto: a recusa da API aparece como veio', async () => {
      const msg = 'Esta pauta já tem votos e não pode ser excluída. Encerre a votação.';
      const { fixture, el, comp } = render({
        removeVotacao: jest.fn(() => throwError(() => ({ status: 400, error: { message: msg } }))),
      });
      comp.verAssembleia(2);
      await comp.removerVotacao(10, 2);
      fixture.detectChanges();
      expect(el.textContent).toContain(msg);
    });

    it('drawer de finalizar: diz que nada é apagado', () => {
      const { fixture, el, comp } = render();
      comp.verAssembleia(2);
      comp.abrirFinalizar(ASSEMBLEIA as any);
      fixture.detectChanges();
      expect(el.querySelector('.ps-drawer')?.textContent).toContain(
        'A assembleia fica guardada no histórico com as votações; nada é apagado.',
      );
      expect(el.querySelector('.ps-drawer')?.textContent).not.toContain('sai da lista');
    });
  });

  describe('Somente proprietários', () => {
    it('selo na pauta marcada; sem selo na desmarcada e na da API antiga', () => {
      const { fixture, el, comp } = render({
        getAssembleia: jest.fn(() =>
          of({ assembleia: ASSEMBLEIA, votacoes: [PAUTA_OCULTA, PAUTA_ENCERRADA, PAUTA_ANTIGA], meusVotos: [] }),
        ),
      });
      comp.verAssembleia(2);
      fixture.detectChanges();
      expect(cartao(el, 'Obra').textContent).toContain('Somente proprietários');
      expect(cartao(el, 'Contas').textContent).not.toContain('Somente proprietários');
      expect(cartao(el, 'Fachada').textContent).not.toContain('Somente proprietários');
    });

    it('selo também na enquete marcada (true ou 1)', () => {
      const { fixture, el, comp } = render({
        listEnquetes: jest.fn(() => of([{ ...PAUTA_ANTIGA, id: 30, titulo: 'Reforma', somente_proprietarios: true }])),
      });
      comp.tab.set('enquetes');
      fixture.detectChanges();
      expect(cartao(el, 'Reforma').textContent).toContain('Somente proprietários');
    });

    function caixa(el: HTMLElement) {
      return el.querySelector('.ps-drawer input[type="checkbox"][name="somente_proprietarios"]') as HTMLInputElement;
    }

    it('nova pauta: caixa desmarcada com a explicação; marcada vai no payload', async () => {
      const insertVotacao = jest.fn(() => of({}));
      const { fixture, el, comp } = render({ insertVotacao });
      comp.verAssembleia(2);
      comp.abrirModalPauta(2);
      fixture.detectChanges();
      await fixture.whenStable();
      const cb = caixa(el);
      expect(cb).toBeTruthy();
      expect(cb.checked).toBe(false);
      expect(el.querySelector('.ps-drawer')?.textContent).toContain(
        'Inquilinos não votam nesta pauta. Use em despesas extraordinárias, obras e alteração de convenção.',
      );
      cb.click();
      fixture.detectChanges();
      comp.novaVotacao.titulo = 'Obra da fachada';
      comp.salvarVotacao();
      expect(insertVotacao).toHaveBeenCalledWith(
        expect.objectContaining({ id_assembleia: 2, somente_proprietarios: true }),
      );
    });

    it('nova enquete: caixa presente; desmarcada vai como false', async () => {
      const insertVotacao = jest.fn(() => of({}));
      const { fixture, el, comp } = render({ insertVotacao });
      comp.abrirModalEnquete();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(caixa(el)).toBeTruthy();
      comp.novaVotacao.titulo = 'Horário da piscina';
      comp.salvarVotacao();
      expect(insertVotacao).toHaveBeenCalledWith(
        expect.objectContaining({ is_enquete: true, somente_proprietarios: false }),
      );
    });
  });
});
