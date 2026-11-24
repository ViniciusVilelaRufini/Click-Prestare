import { BadRequestException } from '@nestjs/common';
import { DocumentosService } from './documentos.service';

/**
 * V1 — a ATA e a apuração de uma assembleia finalizada eram Documentos
 * comuns: qualquer síndico ou funcionário apagava a ATA com código de
 * integridade (`documentos/remove` só olhava assertStaff e tenant) e publicava
 * uma "ATA" falsa por `documentos/insert` com `is_ata: 1`, com push "ATA
 * publicada" para todos. A ATA agora nasce só no finish() da assembleia, e o
 * que ele publicou não sai mais.
 */
describe('DocumentosService — ATA de assembleia finalizada', () => {
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };
  const NOME_ATA = 'ATA AGO 2026 - 20/11/2026';

  function build(docs: any[], assembleias: any[] = []) {
    const prisma: any = {
      isConnected: true,
      documentos: {
        create: jest.fn(async ({ data }: any) => ({ id: 99, ...data })),
        findUnique: jest.fn(async ({ where }: any) => docs.find((d) => d.id === where.id) ?? null),
        findMany: jest.fn(async ({ where }: any) =>
          docs.filter((d) => where.id.in.includes(d.id) && d.id_condominio === where.id_condominio),
        ),
        delete: jest.fn(async () => ({})),
      },
      assembleias: {
        findFirst: jest.fn(async ({ where }: any) => assembleias.find((a) => a.id_documento_ata === where.id_documento_ata) ?? null),
        findMany: jest.fn(async ({ where }: any) =>
          assembleias.filter((a) => a.id_condominio === where.id_condominio && a.id_documento_ata != null),
        ),
      },
    };
    const storage: any = {
      isDataUrl: (v: unknown) => typeof v === 'string' && v.startsWith('data:'),
      uploadDataUrl: jest.fn(async () => 'https://bucket/documentos/x.pdf'),
      exigirArquivoDoRegistro: jest.fn(async () => undefined),
    };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    const chatIa: any = {
      indexarDocumentoPorId: jest.fn(async () => ({ indexed: 1 })),
      removerIndiceDocumento: jest.fn(async () => undefined),
    };
    return { svc: new DocumentosService(prisma, storage, tenant, chatIa), prisma, storage, chatIa };
  }

  const ata = { id: 62, id_condominio: 1, is_ata: 1, nome: NOME_ATA };
  const apuracao = { id: 63, id_condominio: 1, is_ata: 1, nome: `Apuração das pautas - ${NOME_ATA}` };
  const finalizada = { id: 2, id_condominio: 1, id_documento_ata: 62 };

  describe('insert', () => {
    it.each([1, true, '1'])('is_ata = %j é recusado, sem subir arquivo, gravar ou indexar', async (isAta) => {
      const { svc, prisma, storage, chatIa } = build([]);
      await expect(
        svc.insert(1, { nome: 'ATA falsa', doc: 'data:application/pdf;base64,JVBERi0=', is_ata: isAta }, sindico),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadDataUrl).not.toHaveBeenCalled();
      expect(prisma.documentos.create).not.toHaveBeenCalled();
      expect(chatIa.indexarDocumentoPorId).not.toHaveBeenCalled();
    });

    it('documento comum continua sendo publicado (is_ata 0)', async () => {
      const { svc, prisma } = build([]);
      await expect(svc.insert(1, { nome: 'Regimento', link_doc: '', is_ata: 0 }, sindico)).resolves.toEqual({ success: true });
      expect(prisma.documentos.create.mock.calls[0][0].data.is_ata).toBe(0);
    });
  });

  describe('remove', () => {
    it('recusa apagar a ATA referenciada por Assembleias.id_documento_ata', async () => {
      const { svc, prisma, chatIa } = build([ata, apuracao], [finalizada]);
      await expect(svc.remove(62, sindico)).rejects.toThrow(
        new BadRequestException('A ATA e a apuração de uma assembleia finalizada não podem ser excluídas.'),
      );
      expect(prisma.documentos.delete).not.toHaveBeenCalled();
      expect(chatIa.removerIndiceDocumento).not.toHaveBeenCalled();
    });

    it('recusa apagar a apuração publicada junto da ATA', async () => {
      const { svc, prisma } = build([ata, apuracao], [finalizada]);
      await expect(svc.remove(63, sindico)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.documentos.delete).not.toHaveBeenCalled();
    });

    it('apuração com nome truncado em 255 (como o finish grava) também fica', async () => {
      const longo = { ...ata, nome: `ATA ${'x'.repeat(260)}`.slice(0, 255) };
      const apuracaoLonga = { ...apuracao, nome: `Apuração das pautas - ${longo.nome}`.slice(0, 255) };
      const { svc, prisma } = build([longo, apuracaoLonga], [finalizada]);
      await expect(svc.remove(63, sindico)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.documentos.delete).not.toHaveBeenCalled();
    });

    it('"apuração" de uma ATA de outro condomínio não é protegida por ela', async () => {
      const ataOutro = { ...ata, id_condominio: 2 };
      const { svc, prisma } = build([ataOutro, apuracao], [{ ...finalizada, id_condominio: 2 }]);
      await expect(svc.remove(63, sindico)).resolves.toEqual({ success: true });
      expect(prisma.documentos.delete).toHaveBeenCalledWith({ where: { id: 63 } });
    });

    it('ATA antiga sem assembleia (publicada à mão antes) e documento comum continuam removíveis', async () => {
      const antiga = { id: 10, id_condominio: 1, is_ata: 1, nome: 'ATA 2024' };
      const comum = { id: 11, id_condominio: 1, is_ata: 0, nome: `Apuração das pautas - ${NOME_ATA}` };
      const { svc, prisma } = build([antiga, comum, ata], [finalizada]);
      await expect(svc.remove(10, sindico)).resolves.toEqual({ success: true });
      await expect(svc.remove(11, sindico)).resolves.toEqual({ success: true });
      expect(prisma.documentos.delete).toHaveBeenCalledTimes(2);
    });
  });
});
