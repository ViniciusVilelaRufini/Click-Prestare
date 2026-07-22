import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Injectable()
export class DocumentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tenant: TenantAccessService,
  ) {}

  async insert(idCondominio: number, documento: any, user?: JwtPayload) {
    assertStaff(user, 'publicar documento');
    await this.tenant.assertCondominio(idCondominio, user);
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

  async getAll(idCondominio: number, isAtaParam?: string | number | boolean, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
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

  async remove(id: number, user?: JwtPayload) {
    assertStaff(user, 'remover documento');
    if (!this.prisma.isConnected) return { success: true };
    const atual = await this.prisma.documentos.findUnique({ where: { id: Number(id) }, select: { id_condominio: true } });
    if (!atual) throw new NotFoundException('Documento não encontrado.');
    await this.tenant.assertEntidade(atual.id_condominio, user, `documento #${id}`);
    await this.prisma.documentos.delete({ where: { id: Number(id) } });
    return { success: true };
  }
}
