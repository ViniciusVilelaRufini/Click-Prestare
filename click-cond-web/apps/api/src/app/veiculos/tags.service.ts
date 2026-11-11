import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { validarCodigoTag } from '../common/tag-codigo.util';
import { assertTagNaoEmUso } from '../common/tag-em-uso.util';

export interface TagDto {
  codigo: string;
  tipo?: string;
  descricao?: string | null;
}

/** Tamanho da coluna Tags.codigo. */
const TAG_CODIGO_COLUNA = 100;

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista as tags do condomínio. Com `livres=true`, retorna só as que não estão
   * vinculadas a nenhum veículo ativo (para o seletor de vínculo).
   *
   * Por padrão só as ativas; `incluirInativas=true` traz também as bloqueadas,
   * para a tela poder reativá-las.
   */
  async findAll(idCondominio: number, livres = false, incluirInativas = false) {
    return this.prisma.tags.findMany({
      where: {
        id_condominio: idCondominio,
        ...(incluirInativas ? {} : { ativo: 1 }),
        ...(livres ? { veiculos: { none: { ativo: 1 } } } : {}),
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Cria/atualiza uma tag pelo par (condomínio, código). Usado quando a portaria
   * captura uma tag nova pelo leitor.
   *
   * O código é gravado NORMALIZADO (ver tag-codigo.util): é com essa forma que
   * a leitura do leitor é comparada. Código vazio ou inválido é recusado —
   * antes entrava até tag de código "".
   */
  async upsert(idCondominio: number, dto: TagDto) {
    const validado = validarCodigoTag(dto?.codigo, TAG_CODIGO_COLUNA);
    if (validado.erro !== undefined) throw new BadRequestException(validado.erro);
    const codigo = validado.codigo;
    // Tag bloqueada (perdida/roubada) não volta a abrir só porque alguém digitou
    // o código de novo num cadastro: a reativação é explícita, pelo PATCH.
    const bloqueada = await this.prisma.tags.findFirst({
      where: { id_condominio: idCondominio, codigo, ativo: 0 },
    });
    if (bloqueada) {
      throw new BadRequestException(
        'Esta tag está bloqueada. Reative-a na lista de tags antes de usá-la.',
      );
    }
    // A mesma tag física em outro formato ("12345678" x "BC614E"), ou já usada
    // como tag pessoal/de visitante, não vira uma segunda Tag. A própria linha
    // (mesmo código) é o upsert de sempre: captura/seleção pela portaria.
    const propria = await this.prisma.tags.findFirst({
      where: { id_condominio: idCondominio, codigo },
      select: { id: true },
    });
    await assertTagNaoEmUso(this.prisma, idCondominio, codigo, {
      ignorar: { idTag: propria?.id ?? null },
    });
    return this.prisma.tags.upsert({
      where: { id_condominio_codigo: { id_condominio: idCondominio, codigo } },
      create: {
        id_condominio: idCondominio,
        codigo,
        tipo: dto.tipo || 'rfid',
        descricao: dto.descricao?.trim() || null,
      },
      update: {
        tipo: dto.tipo || 'rfid',
        descricao: dto.descricao?.trim() || null,
      },
    });
  }

  private async tagDoCondominio(idCondominio: number, id: number) {
    const tag = await this.prisma.tags.findFirst({
      where: { id: Number(id), id_condominio: idCondominio },
    });
    if (!tag) throw new NotFoundException(`Tag ${id} não encontrada`);
    return tag;
  }

  /**
   * Bloqueia (`ativo=false`) ou reativa a tag. Bloqueada, ela deixa de abrir
   * no leitor mas continua vinculada ao veículo — é o caso de tag perdida.
   */
  async definirAtivo(idCondominio: number, id: number, ativo: boolean | number) {
    if (ativo !== true && ativo !== false && ativo !== 0 && ativo !== 1) {
      throw new BadRequestException('Informe "ativo" como verdadeiro (reativar) ou falso (bloquear).');
    }
    const tag = await this.tagDoCondominio(idCondominio, id);
    return this.prisma.tags.update({
      where: { id: tag.id },
      data: { ativo: ativo === true || ativo === 1 ? 1 : 0 },
    });
  }

  /** Exclui a tag, desvinculando-a antes dos veículos que a usam. */
  async remove(idCondominio: number, id: number) {
    const tag = await this.tagDoCondominio(idCondominio, id);
    await this.prisma.$transaction([
      this.prisma.veiculos.updateMany({
        where: { id_tag: tag.id, id_condominio: idCondominio },
        data: { id_tag: null },
      }),
      this.prisma.tags.delete({ where: { id: tag.id } }),
    ]);
    return { ok: true };
  }
}
