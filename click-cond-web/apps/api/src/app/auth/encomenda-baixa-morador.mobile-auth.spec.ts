import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

/**
 * B8 (auditoria de ciclos 13/11): a baixa do morador gravava 'Retirada' sem
 * condição de status — duas baixas simultâneas passavam as duas. A baixa de
 * pré-registro ('Esperando', ex.: comida que o morador pegou direto) continua
 * valendo.
 */
describe('MobileAuthService.retirarEncomendaMorador — condição de status', () => {
  function build(status: string, opts: { concorrente?: boolean } = {}) {
    const registro: any = { id: 3, id_condominio: 1, destinatario_apto: '1', destinatario_bloco: 'A', status, retirado_foto: null };
    const prisma: any = {
      isConnected: true,
      encomendas: {
        findUnique: jest.fn(async () => ({ ...registro })),
        update: jest.fn(async ({ data }: any) => ({ ...registro, ...data })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (opts.concorrente || !where.status.in.includes(registro.status)) return { count: 0 };
          Object.assign(registro, data);
          return { count: 1 };
        }),
      },
      moradores: { findMany: jest.fn(async () => [{ id_condominio: 1, apartamento: '1', bloco: 'A', nome: 'M' }]) },
    };
    const storage: any = { exigirArquivoDoRegistro: jest.fn(async () => undefined), isDataUrl: jest.fn(() => false) };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    const service = new MobileAuthService(prisma, { sign: jest.fn() } as any, {} as any, storage, {} as any, tenant, {} as any, {} as any, {} as any, {} as any);
    return { service, prisma, registro };
  }

  it('encomenda aguardando: dá baixa só se ainda estiver aguardando', async () => {
    const { service, prisma, registro } = build('Aguardando');
    const r: any = await service.retirarEncomendaMorador(7, 3);
    expect(prisma.encomendas.updateMany.mock.calls[0][0].where).toEqual({ id: 3, status: { in: ['Aguardando', 'Esperando'] } });
    expect(registro.status).toBe('Retirada');
    expect(r).toMatchObject({ id: 3, status: 'Retirada', retirado_por: 'M' });
  });

  it('pré-registro (Esperando) continua podendo receber baixa do morador', async () => {
    const { service, registro } = build('Esperando');
    await service.retirarEncomendaMorador(7, 3);
    expect(registro.status).toBe('Retirada');
  });

  it('já retirada: recusa sem gravar', async () => {
    const { service, prisma } = build('Retirada');
    await expect(service.retirarEncomendaMorador(7, 3)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.encomendas.updateMany).not.toHaveBeenCalled();
  });

  it('outra baixa no meio: recusa em vez de gravar de novo', async () => {
    const { service } = build('Aguardando', { concorrente: true });
    await expect(service.retirarEncomendaMorador(7, 3)).rejects.toThrow('Esta encomenda já foi retirada.');
  });
});
