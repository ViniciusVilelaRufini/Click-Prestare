import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { MarketingAdsService } from './marketing-ads.service';

function montar(env: Record<string, string | undefined> = { ADS_INGEST_TOKEN: 'segredo' }) {
  const prisma: any = { crm_Anuncios_Diario: { upsert: jest.fn(async () => ({})) } };
  const openai: any = { estaConfigurado: jest.fn(() => true), buscarDiario: jest.fn(async () => []) };
  const svc = new MarketingAdsService(prisma, openai);
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
    openai.estaConfigurado.mockReturnValue(false);
    await expect(svc.sincronizarOpenAi()).resolves.toBe(0);
    expect(openai.buscarDiario).not.toHaveBeenCalled();
    restaurar();
  });
});
