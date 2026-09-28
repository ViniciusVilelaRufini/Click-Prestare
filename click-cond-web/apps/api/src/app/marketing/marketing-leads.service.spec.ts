import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MarketingLeadsService } from './marketing-leads.service';

function montar(existente: any = null) {
  const prisma: any = {
    crm_Leads: {
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => existente),
      update: jest.fn(async ({ data }: any) => ({ ...existente, ...data })),
    },
  };
  return { prisma, svc: new MarketingLeadsService(prisma) };
}

const base = { nome: 'Ana', condominio: 'Ed. Sol', unidades: '40', whatsapp: '17999990000' };

describe('MarketingLeadsService', () => {
  it('grava lead com origem derivada do gclid', async () => {
    const { prisma, svc } = montar();
    await svc.criar({ ...base, gclid: 'abc' });
    expect(prisma.crm_Leads.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ origem: 'google', gclid: 'abc', whatsapp: '17999990000' }),
    });
  });

  it('rejeita lead inválido sem gravar', async () => {
    const { prisma, svc } = montar();
    await expect(svc.criar({ ...base, whatsapp: '1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.crm_Leads.create).not.toHaveBeenCalled();
  });

  it('atualizar muda status e carimba status_em', async () => {
    const lead = { id: 5, ...base, origem: 'google', status: 'novo', observacao: null, criado_em: new Date(), status_em: null };
    const { prisma, svc } = montar(lead);
    await svc.atualizar(5, { status: 'proposta' });
    const data = prisma.crm_Leads.update.mock.calls[0][0].data;
    expect(data.status).toBe('proposta');
    expect(data.status_em).toBeInstanceOf(Date);
  });

  it('atualizar só observação não mexe em status_em', async () => {
    const lead = { id: 5, ...base, origem: 'google', status: 'novo', observacao: null, criado_em: new Date(), status_em: null };
    const { prisma, svc } = montar(lead);
    await svc.atualizar(5, { observacao: 'ligar segunda' });
    expect(prisma.crm_Leads.update.mock.calls[0][0].data).toEqual({ observacao: 'ligar segunda' });
  });

  it('status inválido é rejeitado', async () => {
    const lead = { id: 5, ...base, origem: 'google', status: 'novo', observacao: null, criado_em: new Date(), status_em: null };
    const { svc } = montar(lead);
    await expect(svc.atualizar(5, { status: 'ganho' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lead inexistente dá 404', async () => {
    const { svc } = montar(null);
    await expect(svc.atualizar(9, { status: 'novo' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
