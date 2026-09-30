import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MarketingLeadsService } from './marketing-leads.service';

function montar(existente: any = null) {
  const prisma: any = {
    crm_Leads: {
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => existente),
      findUnique: jest.fn(async () => existente),
      update: jest.fn(async ({ data }: any) => ({ ...existente, ...data })),
      delete: jest.fn(async () => undefined),
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

  it('grava os identificadores da campanha e do anúncio no lead', async () => {
    const { prisma, svc } = montar();
    await svc.criar({ ...base, oppref: 'openai-ref', campaign_id: 'cmpn_1', ad_group_id: 'adg_1', ad_id: 'ad_1' });
    expect(prisma.crm_Leads.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        origem: 'openai', campaign_id: 'cmpn_1', ad_group_id: 'adg_1', ad_id: 'ad_1',
      }),
    });
  });

  it('honeypot preenchido: ignora silenciosamente sem gravar', async () => {
    const { prisma, svc } = montar();
    await expect(svc.criar({ ...base, site: 'http://spam.com' })).resolves.toBeUndefined();
    expect(prisma.crm_Leads.create).not.toHaveBeenCalled();
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

  it('atualizar observacao null grava null (não a string "null")', async () => {
    const lead = { id: 5, ...base, origem: 'google', status: 'novo', observacao: 'algo', criado_em: new Date(), status_em: null };
    const { prisma, svc } = montar(lead);
    await svc.atualizar(5, { observacao: null as any });
    expect(prisma.crm_Leads.update.mock.calls[0][0].data).toEqual({ observacao: null });
  });

  it('atualizar observacao string vazia grava null', async () => {
    const lead = { id: 5, ...base, origem: 'google', status: 'novo', observacao: 'algo', criado_em: new Date(), status_em: null };
    const { prisma, svc } = montar(lead);
    await svc.atualizar(5, { observacao: '' });
    expect(prisma.crm_Leads.update.mock.calls[0][0].data).toEqual({ observacao: null });
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

  it('removes an organic lead without WhatsApp conversation', async () => {
    const lead = { id: 7, ...base, whatsapp: '', origem: 'organico', conversas_whatsapp: [] };
    const { prisma, svc } = montar(lead);

    await expect((svc as any).removerOrganico(7)).resolves.toBeUndefined();
    expect(prisma.crm_Leads.findFirst).toHaveBeenCalledWith({
      where: { id: 7, origem: 'organico', whatsapp: '', conversas_whatsapp: { none: {} } },
    });
    expect(prisma.crm_Leads.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it('rejects paid leads and leads linked to a WhatsApp conversation', async () => {
    const lead = { id: 8, ...base, origem: 'google', conversas_whatsapp: [] };
    const { prisma, svc } = montar(lead);
    prisma.crm_Leads.findFirst.mockResolvedValue(null);

    await expect((svc as any).removerOrganico(8)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.crm_Leads.findFirst).toHaveBeenCalledWith({
      where: { id: 8, origem: 'organico', whatsapp: '', conversas_whatsapp: { none: {} } },
    });
    expect(prisma.crm_Leads.delete).not.toHaveBeenCalled();
  });
});
