import { RelatoriosService } from './relatorios.service';

/**
 * Relatórios PDF/Excel de visitantes e encomendas: o rótulo da unidade vinha
 * colado ("106Bloco A", "Apto 106Bloco A"). Agora usa formatarApto.
 */
describe('RelatoriosService.generate — rótulo da unidade', () => {
  function build(apartamento: any, destino: { apto: string; bloco: string | null }) {
    const prisma: any = {
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Condo' })) },
      visitantes: {
        findMany: jest.fn(async () => [
          {
            id: 1, nome: 'Maria', doc_identificacao: '1', data_entrada: null, data_saida: null,
            created_at: new Date('2026-09-01T09:00:00Z'), apartamento, criadoPor: { name: 'M' },
          },
        ]),
      },
      visitas: { findMany: jest.fn(async () => []) },
      encomendas: {
        findMany: jest.fn(async () => [
          {
            descricao: 'Caixa', destinatario_apto: destino.apto, destinatario_bloco: destino.bloco,
            recebido_de: null, status: 'Aguardando', recebido_em: new Date('2026-09-01T09:00:00Z'),
            retirado_em: null, recebidoPor: { name: 'P' },
          },
        ]),
      },
    };
    const svc = new RelatoriosService(prisma);
    const excel = jest.spyOn(svc as any, 'generateExcel').mockReturnValue(Buffer.from('x'));
    const pdf = jest.spyOn(svc as any, 'generatePdf').mockResolvedValue(Buffer.from('x'));
    return { svc, excel, pdf };
  }

  beforeEach(() => { process.env['PESSOAS_MIGRATION_ENABLED'] = 'false'; });

  it('visitantes: Excel e PDF separam apto e bloco', async () => {
    const { svc, excel, pdf } = build({ apto: '106', bloco: 'A' }, { apto: '1', bloco: null });
    await svc.generate(1, 'visitantes', 'xlsx');
    expect((excel.mock.calls[0][0] as any)[0].Apartamento).toBe('Apto 106 · Bloco A');
    await svc.generate(1, 'visitantes', 'pdf');
    expect((pdf.mock.calls[0][0] as any).table.body[1][2]).toBe('Apto 106 · Bloco A');
  });

  it('visitantes sem apartamento mantém os textos atuais', async () => {
    const { svc, excel, pdf } = build(null, { apto: '1', bloco: null });
    await svc.generate(1, 'visitantes', 'xlsx');
    expect((excel.mock.calls[0][0] as any)[0].Apartamento).toBe('Não informado');
    await svc.generate(1, 'visitantes', 'pdf');
    expect((pdf.mock.calls[0][0] as any).table.body[1][2]).toBe('-');
  });

  it('encomendas: Excel e PDF separam apto e bloco', async () => {
    const { svc, excel, pdf } = build(null, { apto: '106', bloco: 'A' });
    await svc.generate(1, 'encomendas', 'xlsx');
    expect((excel.mock.calls[0][0] as any)[0].Destinatário).toBe('Apto 106 · Bloco A');
    await svc.generate(1, 'encomendas', 'pdf');
    expect((pdf.mock.calls[0][0] as any).table.body[1][1]).toBe('Apto 106 · Bloco A');
  });

  it('encomendas sem bloco: só "Apto 106"', async () => {
    const { svc, excel } = build(null, { apto: '106', bloco: null });
    await svc.generate(1, 'encomendas', 'xlsx');
    expect((excel.mock.calls[0][0] as any)[0].Destinatário).toBe('Apto 106');
  });
});
