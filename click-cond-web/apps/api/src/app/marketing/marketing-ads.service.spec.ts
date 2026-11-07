import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { MarketingAdsService } from './marketing-ads.service';

function montar(env: Record<string, string | undefined> = { ADS_INGEST_TOKEN: 'segredo' }) {
  const prisma: any = { crm_Anuncios_Diario: { upsert: jest.fn(async () => ({})) } };
  const openai: any = { estaConfigurado: jest.fn(async () => true), buscarDiario: jest.fn(async () => []) };
  const segredos: any = { obter: jest.fn(async (n: string) => process.env[n] || undefined) };
  const svc = new MarketingAdsService(prisma, openai, segredos);
  const antigo = { ...process.env };
  Object.assign(process.env, env);
  return { prisma, openai, svc, restaurar: () => { process.env = antigo; } };
}

const linha = { campanha_id: '24298071745', campanha_nome: 'Prestare', dia: '2026-09-27', impressoes: 10, cliques: 2, gasto: 7.5, conversoes: 1 };

describe('MarketingAdsService', () => {
  it('upsert usa a chave única e converte o dia para Date UTC', async () => {
    const { prisma, svc, restaurar } = montar();
    await svc.upsert('google', [linha]);
    const arg = prisma.crm_Anuncios_Diario.upsert.mock.calls[0][0];
    expect(arg.where.plataforma_campanha_id_dia).toEqual({
      plataforma: 'google', campanha_id: '24298071745', dia: new Date('2026-09-27T00:00:00.000Z'),
    });
    expect(arg.update).toEqual(expect.objectContaining({ impressoes: 10, cliques: 2, gasto: 7.5, conversoes: 1 }));
    restaurar();
  });

  it('ingestGoogle rejeita token errado', async () => {
    const { svc, restaurar } = montar();
    await expect(svc.ingestGoogle('errado', { rows: [linha] })).rejects.toBeInstanceOf(UnauthorizedException);
    restaurar();
  });

  it('ingestGoogle rejeita quando o servidor não tem token configurado', async () => {
    const { svc, restaurar } = montar({ ADS_INGEST_TOKEN: '' });
    await expect(svc.ingestGoogle('', { rows: [linha] })).rejects.toBeInstanceOf(UnauthorizedException);
    restaurar();
  });

  it('ingestGoogle clampa valores negativos para 0', async () => {
    const { prisma, svc, restaurar } = montar();
    await svc.ingestGoogle('segredo', { rows: [{ ...linha, impressoes: -5, cliques: -1, gasto: -10, conversoes: -2 }] });
    const arg = prisma.crm_Anuncios_Diario.upsert.mock.calls[0][0];
    expect(arg.update).toEqual(expect.objectContaining({ impressoes: 0, cliques: 0, gasto: 0, conversoes: 0 }));
    restaurar();
  });

  it('ingestGoogle rejeita linha com dia inválido', async () => {
    const { svc, restaurar } = montar();
    await expect(svc.ingestGoogle('segredo', { rows: [{ ...linha, dia: '27/09' }] })).rejects.toBeInstanceOf(BadRequestException);
    restaurar();
  });

  it('ingestGoogle grava e conta', async () => {
    const { svc, restaurar } = montar();
    await expect(svc.ingestGoogle('segredo', { rows: [linha, { ...linha, dia: '2026-09-26' }] })).resolves.toEqual({ gravadas: 2 });
    restaurar();
  });

  it('sincronizarOpenAi não chama a API sem chave', async () => {
    const { openai, svc, restaurar } = montar();
    openai.estaConfigurado.mockResolvedValue(false);
    await expect(svc.sincronizarOpenAi()).resolves.toBe(0);
    expect(openai.buscarDiario).not.toHaveBeenCalled();
    restaurar();
  });
});

describe('MarketingAdsService.conversoesGoogle', () => {
  const agora = new Date('2026-11-07T15:00:00.000Z');
  const leads = [
    { id: 1, origem: 'google', gclid: 'G1', criado_em: new Date('2026-11-07T12:30:00.000Z') },
    { id: 2, origem: 'google', gclid: null, criado_em: new Date('2026-11-06T12:00:00.000Z') },
    { id: 3, origem: 'openai', gclid: null, criado_em: new Date('2026-11-06T12:00:00.000Z') },
    { id: 4, origem: 'google', gclid: 'G4', criado_em: new Date('2026-11-05T12:00:00.000Z') },
    { id: 5, origem: 'google', gclid: 'G5', criado_em: new Date('2026-09-01T12:00:00.000Z') },
    { id: 6, origem: 'google', gclid: '   ', criado_em: new Date('2026-11-06T12:00:00.000Z') },
  ];
  // Lead 4 não confirmou no WhatsApp; os demais confirmaram.
  const confirmados = [1, 2, 3, 5, 6];

  function montarConversoes() {
    const prisma: any = {
      crm_Leads: { findMany: jest.fn(async () => leads) },
      crm_WhatsApp_Conversas: { findMany: jest.fn(async () => confirmados.map((id) => ({ conversao_lead_id: id }))) },
    };
    const segredos: any = { obter: jest.fn(async (n: string) => (n === 'ADS_INGEST_TOKEN' ? 'segredo' : undefined)) };
    return new MarketingAdsService(prisma, {} as any, segredos);
  }

  it('rejeita token errado com 401', async () => {
    await expect(montarConversoes().conversoesGoogle('x', agora)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita quando não há token', async () => {
    await expect(montarConversoes().conversoesGoogle(undefined, agora)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('devolve só leads google confirmados com gclid, dos últimos 30 dias, com hora BRT', async () => {
    await expect(montarConversoes().conversoesGoogle('segredo', agora)).resolves.toEqual([
      { gclid: 'G1', conversao_em: '2026-11-07 09:30:00-03:00' },
    ]);
  });

  it('hora da conversão é estável entre execuções', async () => {
    const svc = montarConversoes();
    const a = await svc.conversoesGoogle('segredo', agora);
    const b = await svc.conversoesGoogle('segredo', new Date('2026-11-20T08:00:00.000Z'));
    expect(b).toEqual(a);
  });
});
