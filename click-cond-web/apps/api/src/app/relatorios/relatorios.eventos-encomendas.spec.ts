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
