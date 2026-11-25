import { ForbiddenException } from '@nestjs/common';
import { AssembleiasService } from './assembleias.service';

/**
 * Push de assembleia aberto com o app fechado: o app chama
 * GET assembleias/get?id_condominio=<Singleton>&id=<id>, e o Singleton ainda é
 * "null". Number('null') = NaN e o assertCondominio recusava. Sem condomínio
 * válido na query, o condomínio vem do próprio registro (e o vínculo de quem
 * pede continua conferido contra ele).
 */
describe('AssembleiasService.get — condomínio derivado do registro', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      assembleias: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 40 ? { id_condominio: 3 } : null)),
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === 40 && where.id_condominio === 3
            ? { id: 40, titulo: 'AGO', descricao: '', data: null, hora: null, link: '', local: '', anexos: '', finalizada_em: null, id_documento_ata: null }
            : null,
        ),
      },
    };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const svc = new AssembleiasService(prisma, {} as any, tenant, {} as any);
    const s = svc as any;
    jest.spyOn(s, 'linkDaAta').mockResolvedValue(null);
    jest.spyOn(s, 'consultarVotacoes').mockResolvedValue({ formatadas: [], apuracao: [], dados: [] });
    jest.spyOn(s, 'getMyVotosAssembleia').mockResolvedValue([]);
    jest.spyOn(s, 'unidadesDoUsuario').mockResolvedValue([]);
    jest.spyOn(s, 'votosPorUnidade').mockReturnValue([]);
    return { svc, tenant, prisma };
  }
  const morador: any = { sub: 9, typeAccess: 'Morador', user: { id: 9 } };

  it('id_condominio "null" (NaN) na query: usa o do registro e confere o vínculo nele', async () => {
    const { svc, tenant } = build();
    const r: any = await svc.get(NaN, 40, 9, morador);
    expect(tenant.assertCondominio).toHaveBeenCalledWith(3, morador);
    expect(r.assembleia.id).toBe(40);
  });

  it('assembleia inexistente sem condomínio na query: 404', async () => {
    const { svc } = build();
    await expect(svc.get(NaN, 999, 9, morador)).rejects.toThrow('Assembleia não encontrada');
  });

  it('com condomínio na query segue como antes (o vínculo recusa quem não é de lá)', async () => {
    const { svc, tenant } = build();
    tenant.assertCondominio.mockRejectedValueOnce(new ForbiddenException('x'));
    await expect(svc.get(5, 40, 9, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tenant.assertCondominio).toHaveBeenCalledWith(5, morador);
  });
});
