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
const PORTEIRO = jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' });

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
  function render(over: Record<string, any> = {}, token = SINDICO) {
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
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno: 'Diurno', id_condominio: 1 }), token } },
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
    expect(c.textContent).not.toContain('votos');
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
    expect(c.textContent).toContain('4 votos (80%)');
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
    expect(c.textContent).toContain('2 votos (100%)');
    expect(c.textContent).toContain('Total apurado: 2 votos');
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

  it('participação com total 0 ou ausente: sem "de 0"; só "X unidades votaram"', () => {
    const { comp } = render();
    expect(comp.textoParticipacao({ participacao: { unidades_votaram: 3, unidades_total: 0 } } as any)).toBe('3 unidades votaram');
    expect(comp.textoParticipacao({ participacao: { unidades_votaram: 1, unidades_total: 0 } } as any)).toBe('1 unidade votou');
    expect(comp.textoParticipacao({ participacao: { unidades_votaram: 2, unidades_total: null } } as any)).toBe('2 unidades votaram');
    expect(comp.textoParticipacao({ participacao: { unidades_votaram: 2, unidades_total: 9 } } as any)).toBe('2 de 9 unidades votaram');
    expect(comp.textoParticipacao({} as any)).toBe('');
    expect(comp.textoParticipacao({ participacao: {} } as any)).toBe('');
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

    it('finalizou: a mensagem de sucesso é a que a API mandou', () => {
      const alerta = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
      const msg = 'Assembleia finalizada. ATA e apuração publicadas em Documentos.';
      const { comp } = render({ finishAssembleia: jest.fn(() => of({ success: true, message: msg })) });
      comp.abrirFinalizar(ASSEMBLEIA as any);
      comp.ataBase64.set('data:application/pdf;base64,JVBERi0=');
      comp.confirmarFinalizacao();
      expect(alerta).toHaveBeenCalledWith(msg);
      alerta.mockRestore();
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

  describe('Mapa de votação', () => {
    const MAPA = {
      // Formato real da API (datas do mapa em texto de Brasília, com segundos).
      votacao: { id: 11, titulo: 'Obra', somente_proprietarios: 1, encerrada_em: '05/11/2026 15:00:00' },
      participacao: { unidades_votaram: 2, unidades_total: 12 },
      opcoes: [{ id: 3, nome: 'Aprovar', votos: 1 }, { id: 4, nome: 'Rejeitar', votos: 1 }],
      votos: [
        { unidade: 'Bloco A - 101', votante: 'Ana Lima', tipo_vinculo: 'inquilino', opcao: 'Rejeitar',
          registrado_em: '02/11/2026 10:00:00', vigente: false, substituido_em: '03/11/2026 11:30:00' },
        { unidade: 'Bloco A - 101', votante: 'Bruno Souza', tipo_vinculo: 'proprietario', opcao: 'Aprovar',
          registrado_em: '03/11/2026 11:30:00', vigente: true, substituido_em: null },
        { unidade: '102', votante: 'Carla', tipo_vinculo: 'inquilino', opcao: 'Rejeitar',
          registrado_em: '04/11/2026 09:00:00', vigente: true, substituido_em: null },
        { unidade: '103', votante: 'Dora', tipo_vinculo: null, opcao: 'Aprovar',
          registrado_em: '01/11/2026 08:00:00', vigente: false, substituido_em: null },
      ],
    };
    const DET = { assembleia: ASSEMBLEIA, votacoes: [PAUTA_OCULTA, PAUTA_ENCERRADA], meusVotos: [] };
    const botoesMapa = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Mapa de votação');

    it('síndico: botão só na pauta encerrada', () => {
      const { fixture, el, comp } = render({ getAssembleia: jest.fn(() => of(DET)) });
      comp.verAssembleia(2);
      fixture.detectChanges();
      expect(botoesMapa(cartao(el, 'Obra'))).toHaveLength(1);
      expect(botoesMapa(cartao(el, 'Contas'))).toHaveLength(0);
    });

    it('porteiro do console: não vê o botão (nem em pauta nem em enquete encerrada)', () => {
      const { fixture, el, comp } = render(
        { getAssembleia: jest.fn(() => of(DET)), listEnquetes: jest.fn(() => of([{ ...PAUTA_ENCERRADA, id: 31, titulo: 'Pet' }])) },
        PORTEIRO,
      );
      comp.verAssembleia(2);
      fixture.detectChanges();
      expect(cartao(el, 'Obra')).toBeTruthy();
      expect(botoesMapa(el)).toHaveLength(0);
      comp.voltarLista();
      comp.tab.set('enquetes');
      fixture.detectChanges();
      expect(cartao(el, 'Pet')).toBeTruthy();
      expect(botoesMapa(el)).toHaveLength(0);
    });

    it('enquete encerrada: síndico também tem o mapa', () => {
      const { fixture, el, comp } = render({ listEnquetes: jest.fn(() => of([{ ...PAUTA_ENCERRADA, id: 31, titulo: 'Pet' }])) });
      comp.tab.set('enquetes');
      fixture.detectChanges();
      expect(botoesMapa(cartao(el, 'Pet'))).toHaveLength(1);
    });

    it('abre o drawer com a tabela nominal: vigente, substituído (com data) e não conta', () => {
      const mapaVotacao = jest.fn(() => of(MAPA));
      const { fixture, el, comp } = render({ getAssembleia: jest.fn(() => of(DET)), mapaVotacao });
      comp.verAssembleia(2);
      fixture.detectChanges();
      botoesMapa(cartao(el, 'Obra'))[0].click();
      fixture.detectChanges();
      expect(mapaVotacao).toHaveBeenCalledWith(11);
      const drawer = el.querySelector('.ps-drawer') as HTMLElement;
      expect(drawer.textContent).toContain('Mapa de votação');
      expect(drawer.textContent).toContain('2 de 12 unidades votaram');
      const cab = Array.from(drawer.querySelectorAll('th')).map((t) => t.textContent?.trim());
      expect(cab).toEqual(['Unidade', 'Votante', 'Vínculo', 'Opção', 'Data/hora', 'Situação']);
      const linhas = Array.from(drawer.querySelectorAll('tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.replace(/\s+/g, ' ').trim()),
      );
      expect(linhas).toEqual([
        ['Bloco A - 101', 'Ana Lima', 'Inquilino', 'Rejeitar', '02/11/2026 10:00', 'Substituído em 03/11/2026 11:30'],
        ['Bloco A - 101', 'Bruno Souza', 'Proprietário', 'Aprovar', '03/11/2026 11:30', 'Vigente'],
        ['102', 'Carla', 'Inquilino', 'Rejeitar', '04/11/2026 09:00', 'Vigente'],
        ['103', 'Dora', '—', 'Aprovar', '01/11/2026 08:00', 'Não conta'],
      ]);
      expect(drawer.textContent).toContain('Encerrada em 05/11/2026 15:00');
      expect(drawer.textContent).not.toContain(':00:00');
      const naoConta = Array.from(drawer.querySelectorAll('tbody tr'))[3].querySelector('[title]') as HTMLElement;
      expect(naoConta.getAttribute('title')).toBe('Sem vínculo com a unidade ou registro duplicado');
    });

    it('404 (console publicado antes da API): mensagem amigável no lugar do texto técnico', () => {
      const { fixture, el, comp } = render({
        mapaVotacao: jest.fn(() =>
          throwError(() => ({ status: 404, error: { message: 'Cannot GET /api/assembleias/votacoes/mapa?id=11' } })),
        ),
      });
      comp.abrirMapa(PAUTA_ENCERRADA as any);
      fixture.detectChanges();
      const texto = el.querySelector('.ps-drawer')?.textContent ?? '';
      expect(texto).toContain('O mapa de votação ainda não está disponível. Tente de novo em alguns minutos.');
      expect(texto).not.toContain('Cannot GET');
    });

    it('erro da API: aparece no drawer como veio', () => {
      const msg = 'O mapa de votação fica disponível quando a votação é encerrada.';
      const { fixture, el, comp } = render({
        getAssembleia: jest.fn(() => of(DET)),
        mapaVotacao: jest.fn(() => throwError(() => ({ status: 400, error: { message: msg } }))),
      });
      comp.verAssembleia(2);
      fixture.detectChanges();
      comp.abrirMapa(PAUTA_ENCERRADA as any);
      fixture.detectChanges();
      expect(el.querySelector('.ps-drawer')?.textContent).toContain(msg);
      expect(comp.carregandoMapa()).toBe(false);
    });

    it('Exportar CSV: gera o arquivo no navegador (Blob + link) com BOM', async () => {
      const urlApi = URL as any;
      const originais = { create: urlApi.createObjectURL, revoke: urlApi.revokeObjectURL };
      let blob: Blob | null = null;
      urlApi.createObjectURL = jest.fn((b: Blob) => { blob = b; return 'blob:mapa'; });
      urlApi.revokeObjectURL = jest.fn();
      const vistos: { href: string; download: string }[] = [];
      const clique = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        vistos.push({ href: this.href, download: this.download });
      });
      try {
        const { fixture, el, comp } = render({ getAssembleia: jest.fn(() => of(DET)), mapaVotacao: jest.fn(() => of(MAPA)) });
        comp.verAssembleia(2);
        fixture.detectChanges();
        comp.abrirMapa(PAUTA_ENCERRADA as any);
        fixture.detectChanges();
        const exportar = Array.from(el.querySelectorAll('.ps-drawer button')).find((b) =>
          b.textContent?.includes('Exportar CSV'),
        ) as HTMLButtonElement;
        exportar.click();
        expect(vistos).toHaveLength(1);
        expect(vistos[0].href).toBe('blob:mapa');
        expect(vistos[0].download).toMatch(/^mapa-votacao-11.*\.csv$/);
        expect(blob!.type).toContain('text/csv');
        const bytes = await new Promise<Uint8Array>((ok, falha) => {
          const r = new FileReader();
          r.onload = () => ok(new Uint8Array(r.result as ArrayBuffer));
          r.onerror = () => falha(r.error);
          r.readAsArrayBuffer(blob!);
        });
        expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
        expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:mapa');
      } finally {
        urlApi.createObjectURL = originais.create;
        urlApi.revokeObjectURL = originais.revoke;
        clique.mockRestore();
      }
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
      const texto = el.querySelector('.ps-drawer')?.textContent ?? '';
      expect(texto).toContain('Só proprietários votam nesta enquete; inquilinos e dependentes não.');
      expect(texto).not.toContain('despesas extraordinárias');
      comp.novaVotacao.titulo = 'Horário da piscina';
      comp.salvarVotacao();
      expect(insertVotacao).toHaveBeenCalledWith(
        expect.objectContaining({ is_enquete: true, somente_proprietarios: false }),
      );
    });
  });
});
