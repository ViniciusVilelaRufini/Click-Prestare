import { PREFIXOS_FOTO_CONVITE, PREFIXOS_FOTO_VISITANTE, StorageService } from './storage.service';
import { VisitantesService } from '../../visitantes/visitantes.service';

/**
 * O valor de foto_pessoa/foto_documento é escolhido pelo cliente (resolveFoto
 * guarda URL não-data verbatim). O expurgo LGPD apagava qualquer objeto do
 * bucket compartilhado que a URL apontasse — ata, comprovante, foto de outro
 * condomínio. Agora o expurgo de cada dono só apaga dentro do próprio prefixo.
 */
describe('StorageService.deleteUrl — só dentro do prefixo do dono', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });

  function criar() {
    process.env.R2_ACCESS_KEY_ID = 'k';
    process.env.R2_SECRET_ACCESS_KEY = 's';
    process.env.R2_BUCKET = 'bkt';
    process.env.R2_PUBLIC_URL = 'https://pub.example.com';
    const svc: any = new StorageService();
    svc.client = { send: jest.fn().mockResolvedValue({}) };
    return svc;
  }

  it('objeto do nosso storage fora do prefixo esperado não é apagado', async () => {
    const svc = criar();
    expect(await svc.deleteUrl('https://pub.example.com/documentos/ata.pdf', PREFIXOS_FOTO_VISITANTE)).toBe(false);
    expect(await svc.deleteUrl('documentos/ata.pdf', PREFIXOS_FOTO_VISITANTE)).toBe(false);
    expect(await svc.deleteUrl('https://pub.example.com/visitantesX/a.jpg', PREFIXOS_FOTO_VISITANTE)).toBe(false);
    expect(await svc.deleteUrl('https://pub.example.com/visitantes/a.jpg', PREFIXOS_FOTO_CONVITE)).toBe(false);
    expect(svc.client.send).not.toHaveBeenCalled();
  });

  it('sem prefixos permitidos não apaga nada', async () => {
    const svc = criar();
    expect(await svc.deleteUrl('https://pub.example.com/visitantes/a.jpg', [])).toBe(false);
    expect(await svc.deleteUrl('https://pub.example.com/visitantes/a.jpg', undefined)).toBe(false);
    expect(svc.client.send).not.toHaveBeenCalled();
  });

  it('foto de visitante (ou herdada do convite) continua sendo apagada', async () => {
    const svc = criar();
    expect(await svc.deleteUrl('https://pub.example.com/visitantes/1-a.jpg', PREFIXOS_FOTO_VISITANTE)).toBe(true);
    expect(await svc.deleteUrl('https://pub.example.com/convites/2-b.jpg', PREFIXOS_FOTO_VISITANTE)).toBe(true);
    expect(svc.client.send.mock.calls.map((c: any) => c[0].input.Key)).toEqual([
      'visitantes/1-a.jpg',
      'convites/2-b.jpg',
    ]);
  });
});

describe('VisitantesService.tickRetencaoDadosVisitantes — passa o prefixo de foto de visitante', () => {
  it('expurgo de Visitantes chama deleteUrl com PREFIXOS_FOTO_VISITANTE', async () => {
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, foto_pessoa: 'https://pub.example.com/documentos/ata.pdf', foto_documento: null },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pessoas: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    };
    const storage: any = { deleteUrl: jest.fn().mockResolvedValue(false) };
    const auditoria: any = { registrar: jest.fn().mockResolvedValue(undefined) };
    const svc = new VisitantesService(
      prisma, {} as any, storage, {} as any, auditoria, {} as any, {} as any, {} as any,
    );
    await svc.tickRetencaoDadosVisitantes(90);
    expect(storage.deleteUrl).toHaveBeenCalledWith(
      'https://pub.example.com/documentos/ata.pdf',
      PREFIXOS_FOTO_VISITANTE,
    );
  });
});
