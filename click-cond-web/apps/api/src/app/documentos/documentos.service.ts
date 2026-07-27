import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { ChatIaService } from '../chat-ia/chat-ia.service';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Injectable()
export class DocumentosService {
  private readonly logger = new Logger(DocumentosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tenant: TenantAccessService,
    private readonly chatIa: ChatIaService,
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

    const criado = await this.prisma.documentos.create({
      data: {
        id_condominio: Number(idCondominio),
        is_ata: isAta,
        nome: documento.nome,
        link_doc: linkDoc,
      },
    });

    // Indexa para o assistente conseguir resumir o conteúdo ao morador.
    // Em segundo plano de propósito: baixar o PDF e gerar os embeddings leva
    // segundos, e o síndico não deve ficar esperando o upload "terminar".
    void this.chatIa
      .indexarDocumentoPorId(Number(idCondominio), criado.id)
      .then((r: any) => {
        if (r?.skipped) {
          this.logger.warn(
            `Documento ${criado.id} não indexado (${r.motivo}) — o assistente não vai saber responder sobre ele.`,
          );
        } else {
          this.logger.log(
            `Documento ${criado.id} indexado: ${r?.indexed ?? 0} trecho(s).`,
          );
        }
      })
      .catch((e) =>
        this.logger.error(
          `Falha ao indexar documento ${criado.id}: ${e?.message ?? e}`,
        ),
      );

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
    // Sem isso o assistente continuaria respondendo com base num documento
    // que já não existe.
    await this.chatIa
      .removerIndiceDocumento(atual.id_condominio, Number(id))
      .catch((e) =>
        this.logger.warn(
          `Não removeu o índice do documento ${id}: ${e?.message ?? e}`,
        ),
      );
    return { success: true };
  }
}
