import { RelatoriosService } from './relatorios.service';
import { RelatoriosController } from './relatorios.controller';
import { FinanceiroService } from '../financeiro/financeiro.service';

/**
 * Rodada 4 — o relatório financeiro (PDF/XLSX) segue o Livro Caixa:
 *  a) "Receitas pagas", "Despesas pagas" e "Balanço Geral" somam só o que
 *     está pago (`pago = 1`); o que não foi pago aparece à parte em
 *     "A receber" e "A pagar";
 *  b) taxas condominiais apto a apto ficam fora por padrão, com o mesmo
 *     critério que o Livro Caixa usa para escondê-las, e voltam com
 *     `incluirTaxasCondominiais`;
 *  c) a dívida renegociada (`status = '3'`) sai das linhas e dos totais; as
 *     parcelas do acordo entram.
 * Com as três, o Balanço do relatório bate com o Saldo do Livro Caixa do mesmo
 * mês e nas mesmas opções — o último bloco monta os mesmos lançamentos para os
 * dois services e compara.
 */

// ---------------------------------------------------------------------------
// Banco em memória: aplica o `where` do Prisma que os dois services montam.
// ---------------------------------------------------------------------------
function casaCampo(valor: any, filtro: any): boolean {
  if (filtro === null) return valor === null || valor === undefined;
  if (filtro instanceof Date) return valor instanceof Date && valor.getTime() === filtro.getTime();
  if (filtro && typeof filtro === 'object') {
    if ('not' in filtro) {
      if (filtro.not === null) return valor !== null && valor !== undefined;
      return valor !== filtro.not;
    }
    if (!(valor instanceof Date)) return false;
    if (filtro.gte && valor < filtro.gte) return false;
    if (filtro.lte && valor > filtro.lte) return false;
    return true;
  }
  return valor === filtro;
}
function casa(item: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([campo, f]) => {
    if (campo === 'OR') return (f as any[]).some((c) => casa(item, c));
    if (campo === 'AND') return (f as any[]).every((c) => casa(item, c));
    if (campo === 'NOT') return !casa(item, f);
    return casaCampo(item[campo], f);
  });
}

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
let seq = 0;
const lanc = (extra: Record<string, unknown>) => ({
  id: ++seq, id_condominio: 1, id_usuario: null, nome: 'Lançamento', descricao: null, tipo: 'D', valor: 0,
  pago: 0, status: '0', categoria: 'Geral', forma_pagamento: null, origem: null,
  data: null, data_vencimento: dia('2026-11-10'), created_at: dia('2026-11-01'),
  ...extra,
});

/** Novembro/2026 de um prédio com um apartamento 101 do Bloco A. */
function lancamentosDeNovembro() {
  seq = 0;
  return [
    // Despesas do condomínio
    lanc({ nome: 'Manutenção elevador', tipo: 'D', valor: 1200, pago: 1, status: '1', data: dia('2026-11-05') }),
    lanc({ nome: 'Conta de água', tipo: 'D', valor: 300, pago: 0, data_vencimento: dia('2026-11-20') }),
    // Receita do condomínio que não é taxa (fica sempre)
    lanc({ nome: 'Aluguel salão', tipo: 'C', valor: 200, pago: 1, status: '1', data: dia('2026-11-08') }),
    lanc({ nome: 'Multa portão', tipo: 'C', valor: 50, pago: 0, data_vencimento: dia('2026-11-25') }),
    // Taxas condominiais (escondidas por padrão)
    lanc({ nome: 'Apto 101 Bloco A - Ref. 11/2026', tipo: 'C', valor: 650, pago: 1, status: '1', data: dia('2026-11-10') }),
    lanc({ nome: 'Apto 101 Bloco A - Ref. 12/2026', tipo: 'C', valor: 650, pago: 0, data_vencimento: dia('2026-11-28') }),
    // Dívida renegociada e a parcela do acordo que a substituiu
    lanc({ nome: 'Apto 101 Bloco A - Ref. 09/2026', tipo: 'C', valor: 650, pago: 0, status: '3', data_vencimento: dia('2026-11-02') }),
    lanc({ nome: 'Apto 101 Bloco A - Acordo Parc. 1/2', tipo: 'C', valor: 325, pago: 1, status: '1', data: dia('2026-11-12'), categoria: 'Acordo' }),
    // Fora do período (pago em outubro) e conta pessoal do morador
    lanc({ nome: 'Jardinagem', tipo: 'D', valor: 90, pago: 1, status: '1', data: dia('2026-10-30'), data_vencimento: dia('2026-11-03') }),
    lanc({ nome: 'Minha conta de luz', tipo: 'D', valor: 120, pago: 1, status: '1', id_usuario: 9, data: dia('2026-11-04') }),
  ];
}

function prismaEmMemoria(itens: any[]) {
  return {
    isConnected: true,
    condominios: { findUnique: jest.fn(async () => ({ nome: 'Condo', chave_pix: '', categoria_padrao: 'Taxa' })) },
    apartamentos: { findMany: jest.fn(async () => [{ apto: '101', bloco: 'A' }]) },
    financeiro: {
      findMany: jest.fn(async ({ where }: any = {}) => itens.filter((i) => casa(i, where))),
    },
  } as any;
}

function relatorio(itens: any[]) {
  const prisma = prismaEmMemoria(itens);
  const svc = new RelatoriosService(prisma);
  const excel = jest.spyOn(svc as any, 'generateExcel').mockReturnValue(Buffer.from('x'));
  const pdf = jest.spyOn(svc as any, 'generatePdf').mockResolvedValue(Buffer.from('x'));
  const ultimoPdf = () => pdf.mock.calls[pdf.mock.calls.length - 1][0] as any;
  const metrica = (label: string) => ultimoPdf().metrics.find((m: any) => m.label === label)?.value;
  const linhasPdf = () => ultimoPdf().table.body.slice(1).map((l: any[]) => l[0]);
  return { svc, prisma, pdf, excel, metrica, linhasPdf };
}

function livroCaixa(itens: any[]) {
  const prisma = prismaEmMemoria(itens);
  const svc = Object.create(FinanceiroService.prototype) as FinanceiroService;
  Object.assign(svc, { prisma, tenant: { assertCondominio: jest.fn(async () => undefined) } });
  // getAllMeses só serve para escolher o mês quando ele não vem.
  (svc as any).getAllMeses = jest.fn(async () => [{ mes: '11', ano: '2026' }]);
  return svc;
}

/** "R$ 1234.56" (relatório) e "R$ 1.234,56" / "-R$ 1.234,56" (Livro Caixa) → número. */
function reais(txt: string): number {
  const t = txt.replace(/\s/g, '');
  const negativo = t.includes('-');
  const num = t.replace(/[^0-9.,]/g, '');
  const valor = /,\d{2}$/.test(num) ? Number(num.replace(/\./g, '').replace(',', '.')) : Number(num);
  return negativo ? -valor : valor;
}

const sindico: any = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico' };

describe('relatório financeiro = Livro Caixa', () => {
  describe('a) totais só do que está pago; "A receber" e "A pagar" à parte', () => {
    it('padrão (sem taxas): receitas e despesas pagas, não pagos separados', async () => {
      const { svc, metrica } = relatorio(lancamentosDeNovembro());
      await svc.generate(1, 'financeiro', 'pdf', '2026-11-01', '2026-11-30');
      expect(reais(metrica('Receitas pagas'))).toBe(200);
      expect(reais(metrica('Despesas pagas'))).toBe(1200);
      expect(reais(metrica('Balanço Geral'))).toBe(-1000);
      expect(reais(metrica('A receber'))).toBe(50);
      expect(reais(metrica('A pagar'))).toBe(300);
    });
  });

  describe('b) taxas condominiais por unidade', () => {
    it('ficam fora por padrão, pelo mesmo critério do Livro Caixa', async () => {
      const { svc, linhasPdf, excel } = relatorio(lancamentosDeNovembro());
      await svc.generate(1, 'financeiro', 'pdf', '2026-11-01', '2026-11-30');
      expect(linhasPdf().some((n: string) => n.startsWith('Apto 101'))).toBe(false);
      expect(linhasPdf()).toEqual(expect.arrayContaining(['Aluguel salão', 'Multa portão']));

      await svc.generate(1, 'financeiro', 'xlsx', '2026-11-01', '2026-11-30');
      const nomes = (excel.mock.calls[0][0] as any[]).map((l) => l.Nome);
      expect(nomes.some((n: string) => n.startsWith('Apto 101'))).toBe(false);
    });

    it('com o interruptor ligado: taxas e parcelas do acordo entram', async () => {
      const { svc, metrica, linhasPdf } = relatorio(lancamentosDeNovembro());
      await svc.generate(1, 'financeiro', 'pdf', '2026-11-01', '2026-11-30', undefined, undefined, {
        incluirTaxasCondominiais: true,
      });
      expect(linhasPdf()).toEqual(expect.arrayContaining([
        'Apto 101 Bloco A - Ref. 11/2026', 'Apto 101 Bloco A - Ref. 12/2026', 'Apto 101 Bloco A - Acordo Parc. 1/2',
      ]));
      expect(reais(metrica('Receitas pagas'))).toBe(200 + 650 + 325);
      expect(reais(metrica('A receber'))).toBe(50 + 650);
    });

    it('filtro de unidade: o relatório do apartamento traz as taxas dele', async () => {
      const { svc, linhasPdf } = relatorio(lancamentosDeNovembro());
      await svc.generate(1, 'financeiro', 'pdf', '2026-11-01', '2026-11-30', 'A', '101');
      expect(linhasPdf()).toContain('Apto 101 Bloco A - Ref. 11/2026');
    });
  });

  describe('c) dívida renegociada', () => {
    it('sai das linhas e dos totais, como na Inadimplência; a parcela do acordo fica', async () => {
      const { svc, metrica, linhasPdf, excel } = relatorio(lancamentosDeNovembro());
      const opcoes = { incluirTaxasCondominiais: true };
      await svc.generate(1, 'financeiro', 'pdf', '2026-11-01', '2026-11-30', undefined, undefined, opcoes);
      expect(linhasPdf()).not.toContain('Apto 101 Bloco A - Ref. 09/2026');
      expect(linhasPdf()).toContain('Apto 101 Bloco A - Acordo Parc. 1/2');
      expect(reais(metrica('A receber'))).toBe(700); // sem os 650 renegociados

      await svc.generate(1, 'financeiro', 'xlsx', '2026-11-01', '2026-11-30', undefined, undefined, opcoes);
      const nomes = (excel.mock.calls[0][0] as any[]).map((l) => l.Nome);
      expect(nomes).not.toContain('Apto 101 Bloco A - Ref. 09/2026');
    });

    it('status nulo continua no relatório (o Livro Caixa também o mostra)', async () => {
      const { svc, linhasPdf } = relatorio([lanc({ nome: 'Sem status', status: null, pago: 1, data: dia('2026-11-03') })]);
      await svc.generate(1, 'financeiro', 'pdf', '2026-11-01', '2026-11-30');
      expect(linhasPdf()).toEqual(['Sem status']);
    });
  });

  describe('XLSX traz o mesmo resumo do PDF', () => {
    it('aba "Resumo" com os cinco números', async () => {
      const { svc, excel } = relatorio(lancamentosDeNovembro());
      await svc.generate(1, 'financeiro', 'xlsx', '2026-11-01', '2026-11-30');
      const extras = excel.mock.calls[0][2] as any[];
      const resumo = extras.find((a) => a.nome === 'Resumo').dados;
      const valor = (m: string) => resumo.find((l: any) => String(l.Indicador).startsWith(m))?.Valor;
      expect(valor('Receitas pagas')).toBe(200);
      expect(valor('Despesas pagas')).toBe(1200);
      expect(valor('Balanço Geral')).toBe(-1000);
      expect(valor('A receber')).toBe(50);
      expect(valor('A pagar')).toBe(300);
    });
  });

  describe('Balanço do relatório = Saldo do Livro Caixa (mesmo mês, mesmas opções)', () => {
    it.each([false, true])('incluirTaxasCondominiais = %s', async (incluir) => {
      const itens = [
        ...lancamentosDeNovembro(),
        // Rodada 1: tipo fora do padrão — os dois lados classificam igual
        // (só 'D' é despesa, como o saldo sempre fez).
        lanc({ nome: 'Tipo nulo', tipo: null, valor: 40, pago: 1, status: '1', data: dia('2026-11-15') }),
        lanc({ nome: 'tipo c minúsculo', tipo: 'c', valor: 30, pago: 1, status: '1', data: dia('2026-11-16') }),
        lanc({ nome: 'tipo d minúsculo', tipo: 'd', valor: 20, pago: 1, status: '1', data: dia('2026-11-17') }),
        // Bordas do mês: dia 1 e último dia entram; 31/10 e 01/12 não.
        lanc({ nome: 'Dia 1', tipo: 'D', valor: 11, pago: 1, status: '1', data: dia('2026-11-01') }),
        lanc({ nome: 'Último dia', tipo: 'C', valor: 13, pago: 1, status: '1', data: dia('2026-11-30') }),
        lanc({ nome: 'Véspera', tipo: 'C', valor: 500, pago: 1, status: '1', data: dia('2026-10-31') }),
        lanc({ nome: 'Mês seguinte', tipo: 'D', valor: 700, pago: 1, status: '1', data: dia('2026-12-01') }),
        lanc({ nome: 'Vence no último dia', tipo: 'D', valor: 17, pago: 0, data_vencimento: dia('2026-11-30') }),
      ];
      const rel = relatorio(itens);
      await rel.svc.generate(1, 'financeiro', 'pdf', '2026-11-01', '2026-11-30', undefined, undefined, {
        incluirTaxasCondominiais: incluir,
      });
      const livro = await livroCaixa(itens).getAll(1, '11', '2026', true, sindico, incluir);

      expect(reais(rel.metrica('Balanço Geral'))).toBeCloseTo(reais(livro.saldo), 2);
      expect(reais(rel.metrica('Receitas pagas'))).toBeCloseTo(reais(livro.totalReceita), 2);
      expect(reais(rel.metrica('Despesas pagas'))).toBeCloseTo(Math.abs(reais(livro.totalDespesa)), 2);
      // Bordas e tipos fora do padrão nos dois lados.
      const linhasLivro = Object.values(livro.lancamentos).flat().map((l: any) => l.nome);
      for (const nome of ['Dia 1', 'Último dia', 'Vence no último dia', 'Tipo nulo']) {
        expect(linhasLivro).toContain(nome);
        expect(rel.linhasPdf()).toContain(nome);
      }
      for (const nome of ['Véspera', 'Mês seguinte']) {
        expect(linhasLivro).not.toContain(nome);
        expect(rel.linhasPdf()).not.toContain(nome);
      }
      // Receitas = 200 (+650+325 com taxas) + 40 + 30 + 20 + 13; despesas = 1200 + 11.
      expect(reais(rel.metrica('Despesas pagas'))).toBe(1211);
      expect(reais(rel.metrica('Receitas pagas'))).toBe((incluir ? 200 + 650 + 325 : 200) + 40 + 30 + 20 + 13);
    });
  });

  describe('controller', () => {
    const res: any = { setHeader: jest.fn(), end: jest.fn() };
    const service: any = { generate: jest.fn(async () => ({ buffer: Buffer.from(''), mime: 'x', filename: 'x' })) };
    const ctrl = new RelatoriosController(service);

    beforeEach(() => service.generate.mockClear());

    it('repassa o interruptor', async () => {
      await (ctrl as any).download(1, res, sindico, 'financeiro', 'pdf', '2026-11-01', '2026-11-30', undefined, undefined, 'true');
      expect(service.generate.mock.calls[0][7]).toEqual({ incluirTaxasCondominiais: true });
    });

    it('sem o parâmetro (app publicado): desligado', async () => {
      await ctrl.download(1, res, sindico, 'financeiro', 'pdf', '2026-11-01', '2026-11-30');
      expect(service.generate.mock.calls[0][7]).toEqual({ incluirTaxasCondominiais: false });
    });
  });
  describe('rodada 1: o documento explica o que conta', () => {
    const NOTA_PAGOS = 'Totais consideram apenas lançamentos pagos, como no Livro Caixa.';
    const NOTA_TAXAS =
      "Não inclui as taxas condominiais por unidade. Para incluí-las, gere o relatório pelo console com a opção 'Incluir taxas condominiais por unidade'.";

    it('PDF: cartões "Receitas pagas"/"Despesas pagas", legenda dos em aberto e as duas notas', async () => {
      const { svc, pdf } = relatorio(lancamentosDeNovembro());
      await svc.generate(1, 'financeiro', 'pdf', '2026-11-01', '2026-11-30');
      const p = pdf.mock.calls[0][0] as any;
      expect(p.metrics.map((m: any) => m.label)).toEqual(['Receitas pagas', 'Despesas pagas', 'Balanço Geral', 'A receber', 'A pagar']);
      const legenda = (l: string) => p.metrics.find((m: any) => m.label === l).legenda;
      expect(legenda('A receber')).toBe('em aberto com vencimento no período');
      expect(legenda('A pagar')).toBe('em aberto com vencimento no período');
      expect(p.notas).toEqual([NOTA_PAGOS, NOTA_TAXAS]);
    });

    it('com as taxas: só a nota dos pagos', async () => {
      const { svc, pdf } = relatorio(lancamentosDeNovembro());
      await svc.generate(1, 'financeiro', 'pdf', '2026-11-01', '2026-11-30', undefined, undefined, { incluirTaxasCondominiais: true });
      expect((pdf.mock.calls[0][0] as any).notas).toEqual([NOTA_PAGOS]);
    });

    it('XLSX: a aba Resumo traz as legendas e as notas', async () => {
      const { svc, excel } = relatorio(lancamentosDeNovembro());
      await svc.generate(1, 'financeiro', 'xlsx', '2026-11-01', '2026-11-30');
      const resumo = (excel.mock.calls[0][2] as any[]).find((a) => a.nome === 'Resumo').dados.map((l: any) => l.Indicador);
      expect(resumo).toEqual([
        'Receitas pagas', 'Despesas pagas', 'Balanço Geral (receitas pagas - despesas pagas)',
        'A receber (em aberto com vencimento no período)', 'A pagar (em aberto com vencimento no período)',
        NOTA_PAGOS, NOTA_TAXAS,
      ]);
    });

    it('o PDF de verdade é gerado com as notas e as legendas (sem mock do pdfmake)', async () => {
      const prisma = prismaEmMemoria(lancamentosDeNovembro());
      const r = await new RelatoriosService(prisma).generate(1, 'financeiro', 'pdf', '2026-11-01', '2026-11-30');
      expect(r.buffer.subarray(0, 4).toString()).toBe('%PDF');
    });
  });

  describe('rodada 1: filtro só por bloco', () => {
    function comBlocos() {
      const prisma = prismaEmMemoria([
        lanc({ nome: 'Apto 101 Bloco A - Ref. 11/2026', tipo: 'C', valor: 650, pago: 1, status: '1', data: dia('2026-11-10') }),
        lanc({ nome: 'Apto 201 Bloco B - Ref. 11/2026', tipo: 'C', valor: 600, pago: 1, status: '1', data: dia('2026-11-10') }),
        lanc({ nome: 'Apto 102 Bloco A - Acordo Parc. 1/2', tipo: 'C', valor: 100, pago: 0, data_vencimento: dia('2026-11-20') }),
        lanc({ nome: 'Manutenção elevador', tipo: 'D', valor: 1200, pago: 1, status: '1', data: dia('2026-11-05') }),
      ]);
      prisma.apartamentos.findMany = jest.fn(async () => [
        { apto: '101', bloco: 'A' }, { apto: '102', bloco: 'A' }, { apto: '201', bloco: 'B' },
      ]);
      const svc = new RelatoriosService(prisma);
      const pdf = jest.spyOn(svc as any, 'generatePdf').mockResolvedValue(Buffer.from('x'));
      return { svc, prisma, pdf };
    }

    it('traz as cobranças das unidades do bloco (com as taxas), sem os lançamentos gerais nem outro bloco', async () => {
      const { svc, prisma, pdf } = comBlocos();
      // O app manda o bloco como está no cadastro; "Bloco A" e "A" são o mesmo bloco.
      await svc.generate(1, 'financeiro', 'pdf', '2026-11-01', '2026-11-30', 'Bloco A');
      const p = pdf.mock.calls[0][0] as any;
      expect(p.table.body.slice(1).map((l: any[]) => l[0])).toEqual([
        'Apto 101 Bloco A - Ref. 11/2026', 'Apto 102 Bloco A - Acordo Parc. 1/2',
      ]);
      expect(p.metrics.find((m: any) => m.label === 'Receitas pagas').value).toBe('R$ 650.00');
      expect(p.notas).toContain('Filtro por bloco: só os lançamentos das unidades do bloco; lançamentos gerais do condomínio não entram.');
      expect(p.notas.some((n: string) => n.startsWith('Não inclui as taxas'))).toBe(false);
      // Unidades só deste condomínio.
      expect(prisma.apartamentos.findMany).toHaveBeenCalledWith({ where: { id_condominio: 1 }, select: { apto: true, bloco: true } });
    });
  });
});
