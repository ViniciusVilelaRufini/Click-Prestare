import { CrmCondominiosService } from './crm-condominios.service';
import { CrmService } from './crm.service';
import { buildAtualizarCliente } from './crm-atualizar-cliente.spec';

/** O CRM só cuida da assinatura da Prestare: nada de gravar na cobrança dos moradores. */
const COBRANCA_MORADORES = [
  'valor_condominio',
  'categoria_padrao',
  'dia_vencimento',
  'recorrencia_ativa',
  'cobranca_auto_whats',
];

function buildCriar() {
  const tx: any = {
    condominios: { create: jest.fn(async () => ({ id: 9, nome: 'Cond' })), update: jest.fn() },
    apartamentos: { createMany: jest.fn() },
    users: { create: jest.fn(async () => ({ id: 50 })) },
    sindicos: { create: jest.fn() },
    sindicos_Condominios: { create: jest.fn() },
    assinaturas_Condominios: { create: jest.fn() },
  };
  const prisma: any = {
    users: { findFirst: jest.fn(async () => null) },
    funcionarios_Portaria: { count: jest.fn(async () => 0) },
    $transaction: jest.fn(async (arg: any) => arg(tx)),
  };
  const auditoria: any = { registrar: jest.fn(async () => undefined) };
  return { svc: new CrmCondominiosService(prisma, auditoria, {} as any), tx };
}

describe('CrmCondominiosService.criar: assinatura da Prestare', () => {
  it('plano e mensalidade vão para a assinatura, não para a cobrança dos moradores', async () => {
    const { svc, tx } = buildCriar();
    const antes = new Date();
    await svc.criar(
      { nome: 'Cond', plano: 'Profissional', valorMensal: 595, diaVencimento: 10, sindico: { nome: 'S', email: ' S@X.com ' } } as any,
      'op',
    );
    const dataCond = tx.condominios.create.mock.calls[0][0].data;
    for (const campo of COBRANCA_MORADORES) expect(dataCond).not.toHaveProperty(campo);

    const ass = tx.assinaturas_Condominios.create.mock.calls[0][0].data;
    expect(ass).toMatchObject({
      id_condominio: 9,
      plano: 'Profissional',
      valor: 595,
      plataforma: 'CRM',
      codigo: 'CRM-MANUAL',
      email_user: 's@x.com',
    });
    expect(ass.data_ini.getTime()).toBeGreaterThanOrEqual(antes.getTime() - 1000);
    expect(ass.data_fim.getDate()).toBe(10);
    expect(ass.data_fim.getTime()).toBeGreaterThan(antes.getTime());
    expect(tx.condominios.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { vencimento: ass.data_fim } });
  });

  it('sem plano escolhido: não cria assinatura', async () => {
    const { svc, tx } = buildCriar();
    await svc.criar({ nome: 'Cond' } as any, 'op');
    expect(tx.assinaturas_Condominios.create).not.toHaveBeenCalled();
    expect(tx.condominios.update).not.toHaveBeenCalled();
    for (const campo of COBRANCA_MORADORES) {
      expect(tx.condominios.create.mock.calls[0][0].data).not.toHaveProperty(campo);
    }
  });
});

describe('CrmService.atualizarCliente: sem cobrança dos moradores', () => {
  it('condominios.update não recebe os campos de cobrança; assinatura segue', async () => {
    const { svc, prisma } = buildAtualizarCliente();
    await svc.atualizarCliente(
      9,
      { mrr: 700, plano: 'Elite', recorrenciaAtiva: true, cobrancaAutoWhats: true, vencimento: '2026-12-10' } as any,
    );
    const data = prisma.condominios.update.mock.calls[0][0].data;
    for (const campo of COBRANCA_MORADORES) expect(data).not.toHaveProperty(campo);
    expect(data.vencimento).toEqual(new Date('2026-12-10'));
    expect(prisma.assinaturas_Condominios.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ plano: 'Elite', valor: 700, plataforma: 'CRM', codigo: 'CRM-MANUAL' }),
    });
  });

  it('e-mail de síndico malformado: 400 sem gravar', async () => {
    const { svc, prisma } = buildAtualizarCliente();
    await expect(svc.atualizarCliente(9, { sindicoEmail: 'sem-arroba' } as any)).rejects.toThrow(/e-mail/i);
    expect(prisma.condominios.update).not.toHaveBeenCalled();
  });

  it('nova assinatura usa o e-mail do síndico em minúsculas', async () => {
    const { svc, prisma } = buildAtualizarCliente();
    await svc.atualizarCliente(9, { plano: 'Elite', sindicoEmail: ' Novo@X.com ' } as any);
    expect(prisma.assinaturas_Condominios.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email_user: 'novo@x.com' }),
    });
  });
});

describe('CrmService.montarCliente: plano', () => {
  it('valor_condominio dos moradores sem assinatura não vira plano', async () => {
    const modelo: any = new Proxy({}, { get: () => jest.fn(async () => null) });
    const prisma: any = new Proxy(
      { isConnected: true },
      { get: (t: any, k: string) => (k in t ? t[k] : modelo) },
    );
    const svc = new CrmService(prisma, {} as any, { isDeviceOnline: () => undefined } as any);
    const cli = await (svc as any).montarCliente({
      id: 1, nome: 'C', ativo: 1, valor_condominio: 500, categoria_padrao: 'Essencial', created_at: new Date(),
    });
    expect(cli.plano).toBeNull();
  });
});
