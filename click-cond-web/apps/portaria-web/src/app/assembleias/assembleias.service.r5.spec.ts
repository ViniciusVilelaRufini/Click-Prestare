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
  // Formato real da API: datas do mapa em texto de Brasília "dd/MM/aaaa HH:mm:ss".
  const MAPA = {
    votacao: { id: 11, titulo: 'Obra', somente_proprietarios: 1, encerrada_em: '05/11/2026 15:00:00' },
    participacao: { unidades_votaram: 2, unidades_total: 12 },
    opcoes: [{ id: 3, nome: 'Aprovar', votos: 1 }, { id: 4, nome: 'Rejeitar', votos: 1 }],
    votos: [
      { unidade: 'Bloco A - 101', votante: 'Ana "Aninha" Lima', tipo_vinculo: 'inquilino', opcao: 'Rejeitar',
        registrado_em: '02/11/2026 10:00:00', vigente: false, substituido_em: '03/11/2026 11:30:00' },
      { unidade: 'Bloco A - 101', votante: 'Bruno; Souza', tipo_vinculo: 'proprietario', opcao: 'Aprovar',
        registrado_em: '03/11/2026 11:30:00', vigente: true, substituido_em: null },
      { unidade: '102', votante: '=HYPERLINK("x")', tipo_vinculo: null, opcao: 'Rejeitar',
        registrado_em: '04/11/2026 09:00:00', vigente: true, substituido_em: null },
      // Voto antigo sem vínculo / duplicata: não vigente e SEM substituição.
      { unidade: '103', votante: 'Dora', tipo_vinculo: null, opcao: 'Aprovar',
        registrado_em: '01/11/2026 08:00:00', vigente: false, substituido_em: null },
      // `situacao` da API vale sobre a dedução.
      { unidade: '104', votante: 'Eva', tipo_vinculo: 'membro', opcao: 'Aprovar',
        registrado_em: '01/11/2026 08:05:00', vigente: true, substituido_em: null, situacao: 'nao_conta' },
    ],
  };

  it('BOM UTF-8, ";", aspas escapadas; três situações; datas de Brasília com segundos', async () => {
    const { csvMapaVotacao } = await import('./mapa-votacao');
    const csv = csvMapaVotacao(MAPA as any);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const linhas = csv.slice(1).split('\r\n');
    const cab = linhas.indexOf('"Unidade";"Votante";"Vínculo";"Opção";"Registrado em";"Situação";"Substituído em"');
    expect(cab).toBeGreaterThanOrEqual(0);
    const dados = linhas.slice(cab + 1);
    expect(dados).toEqual([
      '"Bloco A - 101";"Ana ""Aninha"" Lima";"Inquilino";"Rejeitar";"02/11/2026 10:00:00";"Substituído";"03/11/2026 11:30:00"',
      '"Bloco A - 101";"Bruno; Souza";"Proprietário";"Aprovar";"03/11/2026 11:30:00";"Vigente";""',
      // Texto que o Excel leria como fórmula vai neutralizado.
      '"102";"\'=HYPERLINK(""x"")";"";"Rejeitar";"04/11/2026 09:00:00";"Vigente";""',
      '"103";"Dora";"";"Aprovar";"01/11/2026 08:00:00";"Não conta";""',
      '"104";"Eva";"Membro";"Aprovar";"01/11/2026 08:05:00";"Não conta";""',
    ]);
  });
});

describe('CSV: contexto, nome do arquivo e opção pelo nome', () => {
  const MAPA = {
    votacao: { id: 11, titulo: 'Obra "da" fachada; já', somente_proprietarios: 0, encerrada_em: '05/11/2026 15:00:00' },
    participacao: { unidades_votaram: 1, unidades_total: 12 },
    // Opções de nome numérico: o nome de uma é o id da outra.
    opcoes: [{ id: 1, nome: '2', votos: 1 }, { id: 2, nome: '1', votos: 0 }],
    votos: [
      { unidade: '101', votante: 'Ana', tipo_vinculo: 'proprietario', opcao: '2',
        registrado_em: '02/11/2026 10:00:00', vigente: true, substituido_em: null },
    ],
  };

  it('primeira linha: título e encerramento; depois o cabeçalho', async () => {
    const { csvMapaVotacao } = await import('./mapa-votacao');
    const linhas = csvMapaVotacao(MAPA as any).slice(1).split('\r\n');
    expect(linhas[0]).toBe('"Mapa de votação #11: Obra ""da"" fachada; já";"Encerrada em 05/11/2026 15:00:00"');
    expect(linhas[1]).toBe('"Unidade";"Votante";"Vínculo";"Opção";"Registrado em";"Situação";"Substituído em"');
  });

  it('sem encerrada_em: a linha de contexto leva só o título', async () => {
    const { csvMapaVotacao } = await import('./mapa-votacao');
    const linhas = csvMapaVotacao({ ...MAPA, votacao: { ...MAPA.votacao, encerrada_em: null } } as any).slice(1).split('\r\n');
    expect(linhas[0]).toBe('"Mapa de votação #11: Obra ""da"" fachada; já"');
  });

  it('opção: vale o nome exato que a API manda, mesmo numérico (não troca pelo id)', async () => {
    const { nomeOpcaoDoVoto, csvMapaVotacao } = await import('./mapa-votacao');
    expect(nomeOpcaoDoVoto(MAPA as any, MAPA.votos[0] as any)).toBe('2');
    expect(csvMapaVotacao(MAPA as any)).toContain('"101";"Ana";"Proprietário";"2";');
    // Só quando nenhum nome bate é que tenta o id.
    expect(nomeOpcaoDoVoto({ ...MAPA, opcoes: [{ id: 7, nome: 'Aprovar', votos: 0 }] } as any, { opcao: 7 } as any)).toBe('Aprovar');
  });

  it('nome do arquivo: id + título saneado (sem acento, sem aspas, sem ponto e vírgula)', async () => {
    const { nomeArquivoMapa } = await import('./mapa-votacao');
    expect(nomeArquivoMapa(MAPA as any)).toBe('mapa-votacao-11-obra-da-fachada-ja.csv');
    expect(nomeArquivoMapa({ ...MAPA, votacao: { id: 5, titulo: '' } } as any)).toBe('mapa-votacao-5.csv');
  });
});

describe('situacaoDoVoto', () => {
  it('usa `situacao` quando vem; senão deduz; nunca "Substituído" sem data', async () => {
    const { situacaoDoVoto } = await import('./mapa-votacao');
    const base = { unidade: '1', votante: 'X', tipo_vinculo: null, opcao: 'A', registrado_em: '01/11/2026 08:00:00' };
    expect(situacaoDoVoto({ ...base, vigente: true, substituido_em: null } as any).tipo).toBe('vigente');
    expect(situacaoDoVoto({ ...base, vigente: false, substituido_em: '02/11/2026 09:10:00' } as any)).toEqual(
      expect.objectContaining({ tipo: 'substituido', texto: 'Substituído em 02/11/2026 09:10' }),
    );
    expect(situacaoDoVoto({ ...base, vigente: false, substituido_em: null } as any)).toEqual(
      expect.objectContaining({ tipo: 'nao_conta', texto: 'Não conta' }),
    );
    expect(situacaoDoVoto({ ...base, vigente: false, substituido_em: null, situacao: 'vigente' } as any).tipo).toBe('vigente');
    expect(situacaoDoVoto({ ...base, vigente: false, substituido_em: null, situacao: 'substituido' } as any).tipo).toBe('nao_conta');
    expect(situacaoDoVoto({ ...base, vigente: true, substituido_em: null, situacao: 'nao_conta' } as any).tipo).toBe('nao_conta');
  });

  it('datas: texto de Brasília perde os segundos na tela; ISO vira Brasília', async () => {
    const { dataHoraBrasilia } = await import('./mapa-votacao');
    expect(dataHoraBrasilia('14/11/2026 17:00:00')).toBe('14/11/2026 17:00');
    expect(dataHoraBrasilia('14/11/2026 17:00:00', true)).toBe('14/11/2026 17:00:00');
    expect(dataHoraBrasilia('2026-11-14T20:00:00.000Z')).toBe('14/11/2026 17:00');
    expect(dataHoraBrasilia('2026-11-14T20:00:05.000Z', true)).toBe('14/11/2026 17:00:05');
    expect(dataHoraBrasilia(null)).toBe('');
  });
});
