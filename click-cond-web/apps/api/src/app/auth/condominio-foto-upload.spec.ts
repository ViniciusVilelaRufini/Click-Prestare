import { ServiceUnavailableException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

/**
 * `Condominios.photo` é `text` — teto de 65535. `StorageService.uploadDataUrl`
 * NUNCA lança: quando o S3 falha (ou o storage está desativado por env
 * incompleta), ela devolve o próprio data URL de volta.
 *
 * Sem guarda, `updateInfosCondominio` gravava esse retorno direto na coluna:
 * o MySQL truncava o base64 no meio, em silêncio, e o app recebia "sucesso".
 * O efeito observado em produção foi exatamente esse — 65535 caracteres de
 * base64 cortado, imagem que nunca renderiza, e 64KB de lixo viajando em toda
 * resposta que carrega o condomínio (daí a lentidão).
 */
describe('updateInfosCondominio — nunca grava data URL na coluna photo', () => {
  const sindico: any = { sub: 7, nome: 'Síndico', typeAccess: 'Sindico' };
  const DATA_URL = 'data:image/png;base64,' + 'A'.repeat(100000);

  function build(uploadRetorna: string | null) {
    const prisma: any = {
      isConnected: true,
      condominios: { update: jest.fn(async () => ({ id: 1 })) },
    };
    const storage: any = {
      isDataUrl: (v: unknown) =>
        typeof v === 'string' && v.startsWith('data:') && v.includes('base64,'),
      uploadDataUrl: jest.fn(async () => uploadRetorna),
    };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };

    const service = new MobileAuthService(
      prisma,
      {} as any, // jwt
      {} as any, // mail
      storage,
      {} as any, // facial
      tenant,
      {} as any, // financeiro
    );
    return { service, prisma, storage };
  }

  const body = (photo: string) => ({
    condominio: { id: 1, nome: 'Boa vista', photo },
  });

  it('upload falhou (devolveu o data URL): recusa e NÃO escreve no banco', async () => {
    // É o cenário real: uploadDataUrl engole o erro do S3 e devolve a entrada.
    const { service, prisma } = build(DATA_URL);

    await expect(service.updateInfosCondominio(body(DATA_URL), sindico)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.condominios.update).not.toHaveBeenCalled();
  });

  it('upload devolveu null: recusa e NÃO escreve no banco', async () => {
    const { service, prisma } = build(null);

    await expect(service.updateInfosCondominio(body(DATA_URL), sindico)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.condominios.update).not.toHaveBeenCalled();
  });

  it('upload deu certo: grava a URL curta, nunca o base64', async () => {
    const url = 'https://storage-click-dev.s3.amazonaws.com/condominios/1/123-abc.profile';
    const { service, prisma } = build(url);

    await service.updateInfosCondominio(body(DATA_URL), sindico);

    expect(prisma.condominios.update).toHaveBeenCalledTimes(1);
    const gravado = prisma.condominios.update.mock.calls[0][0].data.photo;
    expect(gravado).toBe(url);
    expect(gravado.startsWith('data:')).toBe(false);
  });

  it('photo que já é URL passa direto, sem chamar o storage', async () => {
    const url = 'https://storage-click-dev.s3.amazonaws.com/condominios/1/ja-existente.png';
    const { service, prisma, storage } = build(null);

    await service.updateInfosCondominio(body(url), sindico);

    expect(storage.uploadDataUrl).not.toHaveBeenCalled();
    expect(prisma.condominios.update.mock.calls[0][0].data.photo).toBe(url);
  });
});
