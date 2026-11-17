import { MobileAuthService } from '../auth/mobile-auth.service';
import { CrmCondominiosService } from './crm-condominios.service';

/**
 * Condomínio criado pelo CRM já nasce aprovado: se for desativado depois, é "suspenso"/churn,
 * nunca "em análise" (que é só autocadastro nunca aprovado: ativo 0 e aprovado_em nulo).
 */
describe('CRM: condomínio criado e depois desativado', () => {
  it('criar → desativar → login recusa como suspenso (não em análise)', async () => {
    let cond: any = null;
    const tx: any = {
      condominios: {
        create: jest.fn(async ({ data }: any) => {
          cond = { id: 9, nome: 'Cond', ativo: 1, aprovado_em: null, ...data };
          return cond;
        }),
        update: jest.fn(),
      },
      apartamentos: { createMany: jest.fn() },
      users: { create: jest.fn(async () => ({ id: 50 })) },
      sindicos: { create: jest.fn() },
      sindicos_Condominios: { create: jest.fn() },
      assinaturas_Condominios: { create: jest.fn() },
    };
    const prisma: any = {
      users: { findFirst: jest.fn(async () => null) },
      funcionarios_Portaria: { count: jest.fn(async () => 0) },
      condominios: {
        findUnique: jest.fn(async () => cond),
        update: jest.fn(async ({ data }: any) => {
          cond = { ...cond, ...data };
          return cond;
        }),
      },
      facial_Devices: { updateMany: jest.fn() },
      $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
    };
    const svc = new CrmCondominiosService(prisma, { registrar: jest.fn(async () => undefined) } as any, {} as any);
    jest.spyOn(svc as any, 'contar').mockResolvedValue({});

    await svc.criar({ nome: 'Cond' } as any, 'op');
    expect(cond.aprovado_em).toBeInstanceOf(Date);

    await svc.desativar(9, 'inadimplência prolongada', 'op');
    expect(cond.ativo).toBe(0);
    expect(cond.aprovado_em).toBeInstanceOf(Date);

    const auth: any = Object.create(MobileAuthService.prototype);
    expect(() => auth.recusarSeSoCondominiosInativos([{ condominio: cond }])).toThrow(/suspenso/);
  });

  it('desativar condomínio ativo legado sem aprovado_em grava aprovado_em', async () => {
    const cond: any = { id: 9, nome: 'Cond', ativo: 1, aprovado_em: null };
    const prisma: any = {
      condominios: { findUnique: jest.fn(async () => cond), update: jest.fn((a: any) => a) },
      facial_Devices: { updateMany: jest.fn((a: any) => a) },
      $transaction: jest.fn(async (arg: any) => Promise.all(arg)),
    };
    const svc = new CrmCondominiosService(prisma, { registrar: jest.fn(async () => undefined) } as any, {} as any);
    jest.spyOn(svc as any, 'contar').mockResolvedValue({});
    await svc.desativar(9, 'motivo válido', 'op');
    expect(prisma.condominios.update.mock.calls[0][0].data.aprovado_em).toBeInstanceOf(Date);
  });
});
