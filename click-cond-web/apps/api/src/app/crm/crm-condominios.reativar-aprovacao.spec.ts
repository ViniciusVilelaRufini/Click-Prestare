import { CrmCondominiosService } from './crm-condominios.service';

/** reativar é também a aprovação do autocadastro: grava aprovado_em quando ainda nulo e nunca sobrescreve. */
function build(cond: any) {
  const prisma: any = {
    condominios: { findUnique: jest.fn(async () => cond), update: jest.fn((a: any) => a) },
    facial_Devices: { updateMany: jest.fn((a: any) => a) },
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  const auditoria: any = { registrar: jest.fn(async () => undefined) };
  return { svc: new CrmCondominiosService(prisma, auditoria, {} as any), prisma };
}

describe('CrmCondominiosService.reativar — aprovado_em', () => {
  it('autocadastro pendente: grava aprovado_em', async () => {
    const { svc, prisma } = build({ id: 5, nome: 'N', ativo: 0, aprovado_em: null });
    await svc.reativar(5, 'op');
    const data = prisma.condominios.update.mock.calls[0][0].data;
    expect(data.ativo).toBe(1);
    expect(data.aprovado_em).toBeInstanceOf(Date);
  });

  it('já aprovado antes: não sobrescreve aprovado_em', async () => {
    const { svc, prisma } = build({ id: 5, nome: 'N', ativo: 0, aprovado_em: new Date('2026-01-01') });
    await svc.reativar(5, 'op');
    const data = prisma.condominios.update.mock.calls[0][0].data;
    expect(data.ativo).toBe(1);
    expect(data).not.toHaveProperty('aprovado_em');
  });
});
