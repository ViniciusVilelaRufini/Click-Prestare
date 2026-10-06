import * as xlsx from 'xlsx';
import { RelatoriosService } from './relatorios.service';

/**
 * `getEventos()` expõe `recebido_em` como `detalhes.dataEntrada` das
 * encomendas. Encomenda `Esperando` (o morador só avisou) ainda não chegou na
 * portaria: o relatório não pode mostrar um "recebimento" que não aconteceu.
 */
describe('RelatoriosService — getEventos() dataEntrada das encomendas', () => {
  const recebido_em = new Date('2026-10-03T14:00:00Z');

  async function eventoEncomenda(status: string) {
    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Condomínio Teste' })) },
      visitantes: { findMany: jest.fn(async () => []) },
      visitas: { findMany: jest.fn(async () => []) },
      pessoas: { findMany: jest.fn(async () => []) },
      encomendas: {
        findMany: jest.fn(async () => [
          {
            id: 7,
            descricao: 'Caixa dos Correios',
            destinatario_apto: '101',
            destinatario_bloco: 'A',
            recebido_de: null,
            recebido_em,
            status,
            recebidoPor: null,
            entreguePor: null,
          },
        ]),
      },
      ocorrencias: { findMany: jest.fn(async () => []) },
      acessos_Facial: { findMany: jest.fn(async () => []) },
      auditLog: { findMany: jest.fn(async () => []) },
      facial_Devices: { findMany: jest.fn(async () => []) },
    };
    const r: any = await new RelatoriosService(prisma).getEventos(1);
    const ev = r.items.find((i: any) => i.id === 'encomenda-7');
    expect(ev).toBeDefined();
    return ev;
  }

  it('Esperando: dataEntrada fica nula (ainda não chegou)', async () => {
    const ev = await eventoEncomenda('Esperando');
    expect(ev.detalhes.dataEntrada).toBeNull();
  });

  it('Aguardando: dataEntrada continua sendo recebido_em', async () => {
    const ev = await eventoEncomenda('Aguardando');
    expect(ev.detalhes.dataEntrada).toBe(recebido_em.toISOString());
  });

  it('Retirada: dataEntrada continua sendo recebido_em', async () => {
    const ev = await eventoEncomenda('Retirada');
    expect(ev.detalhes.dataEntrada).toBe(recebido_em.toISOString());
  });
});

/**
 * `generate('encomendas')`: as colunas "Recebido" (xlsx) e "Recebido Em" (pdf)
 * também não podem mostrar data para encomenda `Esperando`.
 */
describe('RelatoriosService — generate("encomendas") coluna de recebimento', () => {
  const recebido_em = new Date('2026-10-03T14:00:00Z');

  function build(status: string) {
    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Condomínio Teste' })) },
      encomendas: {
        findMany: jest.fn(async () => [
          {
            id: 7,
            descricao: 'Caixa dos Correios',
            destinatario_apto: '101',
            destinatario_bloco: 'A',
            recebido_de: null,
            recebido_em,
            retirado_em: null,
            status,
            recebidoPor: null,
            entreguePor: null,
          },
        ]),
      },
    };
    return new RelatoriosService(prisma);
  }

  async function linhaXlsx(status: string) {
    const { buffer } = await build(status).generate(1, 'encomendas', 'xlsx');
    const wb = xlsx.read(buffer, { type: 'buffer' });
    return xlsx.utils.sheet_to_json<any>(wb.Sheets['Encomendas'])[0];
  }

  async function linhaPdf(status: string) {
    const svc = build(status);
    const spy = jest.spyOn(svc as any, 'generatePdf') as jest.SpyInstance;
    spy.mockResolvedValue(Buffer.from('pdf'));
    await svc.generate(1, 'encomendas', 'pdf');
    const body: any[] = (spy.mock.calls[0][0] as any).table.body;
    return body[1] as any[];
  }

  it('xlsx Esperando (case-insensitive): "Recebido" vira "-"', async () => {
    expect((await linhaXlsx('Esperando')).Recebido).toBe('-');
    expect((await linhaXlsx('esperando')).Recebido).toBe('-');
  });

  it('xlsx Aguardando: "Recebido" mantém a data', async () => {
    const r = (await linhaXlsx('Aguardando')).Recebido;
    expect(r).not.toBe('-');
    expect(r).toMatch(/2026|03\/10/);
  });

  it('pdf Esperando: "Recebido Em" vira "-"', async () => {
    expect((await linhaPdf('Esperando'))[2]).toBe('-');
    expect((await linhaPdf('esperando'))[2]).toBe('-');
  });

  it('pdf Aguardando: "Recebido Em" mantém a data', async () => {
    const c = (await linhaPdf('Aguardando'))[2];
    expect(c).not.toBe('-');
  });
});
