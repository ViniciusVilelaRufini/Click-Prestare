import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AssembleiasApi } from './assembleias.service';
import { AuthService } from '../auth/auth.service';

/**
 * Rodada 5: finalizar não apaga mais. O console pede a lista com as
 * finalizadas (a API antiga ignora o parâmetro) e o mapa de votação nominal.
 */
describe('AssembleiasApi — rodada 5', () => {
  function montar() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 5 }) } },
      ],
    });
    return { svc: TestBed.inject(AssembleiasApi), http: TestBed.inject(HttpTestingController) };
  }
  afterEach(() => TestBed.resetTestingModule());

  it('lista de assembleias pede as finalizadas também', () => {
    const { svc, http } = montar();
    svc.listAssembleias().subscribe();
    const req = http.expectOne((r) => r.url.includes('/assembleias/get-all'));
    expect(req.request.url).toContain('id_condominio=5');
    expect(req.request.url).toContain('incluir_finalizadas=1');
    req.flush([]);
    http.verify();
  });

  it('mapa de votação: GET votacoes/mapa?id=', () => {
    const { svc, http } = montar();
    svc.mapaVotacao(11).subscribe();
    const req = http.expectOne((r) => r.url.includes('/assembleias/votacoes/mapa'));
    expect(req.request.method).toBe('GET');
    expect(req.request.url).toMatch(/\/assembleias\/votacoes\/mapa\?id=11$/);
    req.flush({});
    http.verify();
  });
});

describe('csvMapaVotacao', () => {
  const MAPA = {
    votacao: { id: 11, titulo: 'Obra', somente_proprietarios: 1, encerrada_em: '2026-11-05T18:00:00.000Z' },
    participacao: { unidades_votaram: 2, unidades_total: 12 },
    opcoes: [{ id: 3, nome: 'Aprovar', votos: 1 }, { id: 4, nome: 'Rejeitar', votos: 1 }],
    votos: [
      { unidade: 'Bloco A - 101', votante: 'Ana "Aninha" Lima', tipo_vinculo: 'inquilino', opcao: 'Rejeitar',
        registrado_em: '2026-11-02T13:00:00.000Z', vigente: false, substituido_em: '2026-11-03T14:30:00.000Z' },
      { unidade: 'Bloco A - 101', votante: 'Bruno; Souza', tipo_vinculo: 'proprietario', opcao: 3,
        registrado_em: '05/11/2026 10:00', vigente: true, substituido_em: null },
      { unidade: '102', votante: '=HYPERLINK("x")', tipo_vinculo: null, opcao: 'Rejeitar',
        registrado_em: '2026-11-04T12:00:00.000Z', vigente: true, substituido_em: null },
    ],
  };

  it('BOM UTF-8, separador ";", aspas escapadas, opção pelo nome e horário de Brasília', async () => {
    const { csvMapaVotacao } = await import('./mapa-votacao');
    const csv = csvMapaVotacao(MAPA as any);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const linhas = csv.slice(1).split('\r\n');
    expect(linhas[0]).toBe('"Unidade";"Votante";"Vínculo";"Opção";"Registrado em";"Situação";"Substituído em"');
    expect(linhas[1]).toBe(
      '"Bloco A - 101";"Ana ""Aninha"" Lima";"Inquilino";"Rejeitar";"02/11/2026 10:00";"Substituído";"03/11/2026 11:30"',
    );
    expect(linhas[2]).toBe('"Bloco A - 101";"Bruno; Souza";"Proprietário";"Aprovar";"05/11/2026 10:00";"Vigente";""');
    // Texto que o Excel leria como fórmula vai neutralizado.
    expect(linhas[3]).toBe('"102";"\'=HYPERLINK(""x"")";"";"Rejeitar";"04/11/2026 09:00";"Vigente";""');
    expect(linhas).toHaveLength(4);
  });
});
