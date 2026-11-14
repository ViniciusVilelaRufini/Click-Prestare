import { RelatoriosService } from './relatorios.service';

/**
 * Rodada 3 (raia c) — métricas e recortes dos relatórios PDF/XLSX:
 *  - B2: "Entregues" do PDF de encomendas procurava 'Entregue'; a retirada
 *    grava 'Retirada' — o número era sempre 0;
 *  - B3: "Pendentes" do PDF de ocorrências ignorava 'Ciente' e "Resolvidas"
 *    ignorava 'solucionado'/'Resolvida' — não fechava com o total nem com o
 *    cartão do dashboard (aberta = não solucionada);
 *  - B4: o relatório de visitantes trazia também as visitas de prestadores;
 *  - M5 (parte de defeito): o período do financeiro casava por
 *    `created_at OU data OU vencimento` — o lançamento pago num mês e vencido
 *    no outro entrava nos dois relatórios; e o limite inicial em -03:00
 *    deixava de fora o primeiro dia (data e vencimento são @db.Date).
 */
describe('RelatoriosService.generate — rodada 3', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function build(dados: { encomendas?: any[]; ocorrencias?: any[]; financeiro?: any[] } = {}) {
    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Condo' })) },
      visitantes: { findMany: jest.fn(async () => []) },
      visitas: { findMany: jest.fn(async () => []) },
      encomendas: { findMany: jest.fn(async () => dados.encomendas ?? []) },
      ocorrencias: { findMany: jest.fn(async () => dados.ocorrencias ?? []) },
      financeiro: { findMany: jest.fn(async () => dados.financeiro ?? []) },
    };
    const svc = new RelatoriosService(prisma);
    jest.spyOn(svc as any, 'generateExcel').mockReturnValue(Buffer.from('x'));
    const pdf = jest.spyOn(svc as any, 'generatePdf').mockResolvedValue(Buffer.from('x'));
    const metrica = (label: string) =>
      (pdf.mock.calls[pdf.mock.calls.length - 1][0] as any).metrics.find((m: any) => m.label === label)?.value;
    return { svc, prisma, pdf, metrica };
  }

  it('B2: encomendas — "Retiradas" conta o status gravado na retirada', async () => {
    const enc = (status: string) => ({
      descricao: 'Caixa', destinatario_apto: '1', destinatario_bloco: null, recebido_de: null, status,
      recebido_em: new Date('2026-11-01T12:00:00Z'), retirado_em: null, recebidoPor: null,
    });
    const { svc, metrica } = build({ encomendas: [enc('Retirada'), enc('Retirada'), enc('Aguardando'), enc('Esperando')] });
    await svc.generate(1, 'encomendas', 'pdf');
    expect(metrica('Retiradas')).toBe('2');
    expect(metrica('Aguardando Retirada')).toBe('1');
    expect(metrica('Entregues')).toBeUndefined();
  });

  it('B3: ocorrências — abertas = não solucionadas (inclui Ciente), resolvidas em qualquer grafia', async () => {
    const oc = (status: string) => ({
      status, descricao: 'x', created_at: new Date('2026-11-01T12:00:00Z'), resposta: null, resposta_at: null,
      criadoPor: null, categoria: null, funcionarioPortaria: null, origem: null,
    });
    const { svc, metrica } = build({
      ocorrencias: [oc('Pendente'), oc('Ciente'), oc('Solucionado'), oc('solucionado'), oc('Resolvida')],
    });
    await svc.generate(1, 'ocorrencias', 'pdf');
    expect(metrica('Total Registrado')).toBe('5');
    expect(metrica('Abertas')).toBe('2');
    expect(metrica('Resolvidas')).toBe('3');
  });

  describe('B4: visitantes sem prestadores', () => {
    it('caminho migrado: filtra pelo tipo atual da pessoa', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const { svc, prisma } = build();
      await svc.generate(1, 'visitantes', 'pdf', '2026-11-01', '2026-11-30');
      const where = prisma.visitas.findMany.mock.calls[0][0].where;
      expect(where.pessoa).toEqual({ tipo_pessoa: 'visitante' });
      expect(where.id_condominio).toBe(1);
      expect(where.OR).toBeDefined();
    });

    it('caminho legado: is_prestador diferente de 1', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const { svc, prisma } = build();
      await svc.generate(1, 'visitantes', 'xlsx');
      const where = prisma.visitantes.findMany.mock.calls[0][0].where;
      expect(where.is_prestador).toEqual({ not: 1 });
      expect(where.pessoa).toBeUndefined();
    });
  });

  describe('M5: período do financeiro por competência', () => {
    it('data no período, ou vencimento no período quando não há data — sem created_at', async () => {
      const { svc, prisma } = build();
      await svc.generate(1, 'financeiro', 'pdf', '2026-11-01', '2026-11-30');
      const where = prisma.financeiro.findMany.mock.calls[0][0].where;
      const ini = new Date('2026-11-01T00:00:00.000Z');
      const fim = new Date('2026-11-30T00:00:00.000Z');
      expect(where.OR).toEqual([
        { data: { gte: ini, lte: fim } },
        { data: null, data_vencimento: { gte: ini, lte: fim } },
      ]);
      expect(JSON.stringify(where)).not.toContain('created_at');
      // A conta pessoal do morador continua fora.
      expect(where.NOT).toEqual({ AND: [{ tipo: 'D' }, { id_usuario: { not: null } }] });
    });

    it('só início ou só fim: limite aberto do outro lado', async () => {
      const { svc, prisma } = build();
      await svc.generate(1, 'financeiro', 'xlsx', '2026-11-01');
      const where = prisma.financeiro.findMany.mock.calls[0][0].where;
      expect(where.OR[0]).toEqual({ data: { gte: new Date('2026-11-01T00:00:00.000Z') } });
    });

    it('sem período: sem recorte de data', async () => {
      const { svc, prisma } = build();
      await svc.generate(1, 'financeiro', 'xlsx');
      expect(prisma.financeiro.findMany.mock.calls[0][0].where.OR).toBeUndefined();
    });
  });
});
