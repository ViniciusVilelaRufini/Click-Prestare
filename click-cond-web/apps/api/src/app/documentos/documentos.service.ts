import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { ChatIaService } from '../chat-ia/chat-ia.service';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';

const MSG_ATA_SO_PELA_ASSEMBLEIA =
  'A ATA é publicada ao finalizar a assembleia (menu Assembleias). Para outro arquivo, publique como documento.';
const MSG_ATA_IMUTAVEL = 'A ATA e a apuração de uma assembleia finalizada não podem ser excluídas.';
/** Nome que o finish() da assembleia dá ao arquivo de apuração (ver AssembleiasService.finish). */
const PREFIXO_APURACAO = 'Apuração das pautas - ';

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
    // A ATA nasce só ao finalizar a assembleia (com a apuração e o código de
    // integridade). Por aqui qualquer síndico ou funcionário publicava uma
    // "ATA" avulsa, com push "ATA publicada" para todos os moradores.
    if (documento?.is_ata === true || documento?.is_ata === '1' || documento?.is_ata === 1) {
      throw new BadRequestException(MSG_ATA_SO_PELA_ASSEMBLEIA);
    }
    if (!this.prisma.isConnected) return { success: true };

    let linkDoc = documento.link_doc ?? '';
    const prefix = 'documentos';

    // Documento novo: nenhuma URL do bucket é "a dele". Sem isto, publicar a
    // URL de um arquivo de outro registro fazia a API assiná-la em toda
    // listagem e o indexador do chat baixá-la para o índice deste condomínio.
    await this.storage.exigirArquivoDoRegistro(linkDoc, []);
    if (this.storage.isDataUrl(linkDoc)) {
      linkDoc = (await this.storage.uploadDataUrl(linkDoc, prefix)) ?? '';
    }

    // Upload real para R2 se vier base64
    if (this.storage.isDataUrl(documento.doc)) {
      const uploaded = await this.storage.uploadDataUrl(documento.doc, prefix);
      if (uploaded) linkDoc = uploaded;
    }

    const criado = await this.prisma.documentos.create({
      data: {
        id_condominio: Number(idCondominio),
        is_ata: 0,
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
    const atual = await this.prisma.documentos.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true, is_ata: true, nome: true },
    });
    if (!atual) throw new NotFoundException('Documento não encontrado.');
    await this.tenant.assertEntidade(atual.id_condominio, user, `documento #${id}`);
    if (atual.is_ata === 1 && (await this.ehDocumentoDeAssembleiaFinalizada(Number(id), atual))) {
      throw new BadRequestException(MSG_ATA_IMUTAVEL);
    }
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

  /**
   * A ATA (Assembleias.id_documento_ata) e a apuração publicada junto dela
   * fazem parte do registro imutável da assembleia finalizada. A apuração não
   * tem coluna própria: o finish() a grava no mesmo condomínio, como ATA, com
   * o nome "Apuração das pautas - <nome da ATA>".
   */
  private async ehDocumentoDeAssembleiaFinalizada(
    id: number,
    doc: { id_condominio: number; nome: string | null },
  ): Promise<boolean> {
    const daAta = await this.prisma.assembleias.findFirst({ where: { id_documento_ata: id }, select: { id: true } });
    if (daAta) return true;

    const nome = doc.nome ?? '';
    if (!nome.startsWith(PREFIXO_APURACAO)) return false;
    const finalizadas = await this.prisma.assembleias.findMany({
      where: { id_condominio: doc.id_condominio, id_documento_ata: { not: null } },
      select: { id_documento_ata: true },
    });
    const idsAtas = finalizadas.map((a) => a.id_documento_ata as number);
    if (idsAtas.length === 0) return false;
    const atas = await this.prisma.documentos.findMany({
      where: { id: { in: idsAtas }, id_condominio: doc.id_condominio },
      select: { nome: true },
    });
    // Mesmo corte de 255 do finish().
    return atas.some((a) => `${PREFIXO_APURACAO}${a.nome ?? ''}`.slice(0, 255) === nome);
  }
}
