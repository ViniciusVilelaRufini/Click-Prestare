import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';

@Injectable()
export class DocumentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async insert(idCondominio: number, documento: any) {
    if (!this.prisma.isConnected) return { success: true };

    let linkDoc = documento.link_doc ?? '';

    // Upload real para R2 se vier base64
    if (this.storage.isDataUrl(documento.doc)) {
      const prefix = documento.is_ata ? 'atas' : 'documentos';
      const uploaded = await this.storage.uploadDataUrl(documento.doc, prefix);
      if (uploaded) linkDoc = uploaded;
    }

    const isAta = (documento.is_ata === true || documento.is_ata === '1' || documento.is_ata === 1) ? 1 : 0;

    await this.prisma.documentos.create({
      data: {
        id_condominio: Number(idCondominio),
        is_ata: isAta,
        nome: documento.nome,
        link_doc: linkDoc,
      },
    });

    return { success: true };
  }

  async getAll(idCondominio: number, isAtaParam?: string | number | boolean) {
    if (!this.prisma.isConnected) {
      const isAta = (isAtaParam === '1' || isAtaParam === 1 || isAtaParam === true);
      if (isAta) {
        return [
          { id: 101, nome: 'ATA da Assembleia Geral Ordinária - 2026', link_doc: 'https://example.com/ata_2026.pdf' },
        ];
      } else {
        return [
          { id: 201, nome: 'Regimento Interno e Normas', link_doc: 'https://example.com/regimento.pdf' },
          { id: 202, nome: 'Convenção do Condomínio', link_doc: 'https://example.com/convencao.pdf' },
        ];
      }
    }

    const isAta = (isAtaParam === '1' || isAtaParam === 1 || isAtaParam === true) ? 1 : 0;

    const list = await this.prisma.documentos.findMany({
      where: {
        id_condominio: Number(idCondominio),
        is_ata: isAta,
      },
      select: {
        id: true,
        nome: true,
        link_doc: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });

    return list;
  }

  async remove(id: number) {
    if (!this.prisma.isConnected) return { success: true };
    await this.prisma.documentos.delete({ where: { id: Number(id) } });
    return { success: true };
  }
}
