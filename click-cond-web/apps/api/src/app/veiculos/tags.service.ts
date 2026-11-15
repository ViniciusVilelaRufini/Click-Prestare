import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { validarCodigoTag } from '../common/tag-codigo.util';
import { assertTagNaoEmUso } from '../common/tag-em-uso.util';
import { GuaritaOperacoesService } from '../guarita/guarita-operacoes.service';

export interface TagDto {
  codigo: string;
  tipo?: string;
  descricao?: string | null;
}

/** Estados de tag de Guarita que o Prestare não controla no aparelho: bloquear não tem efeito no portão. */
const TAG_FORA_DO_CONTROLE = ['a_vincular', 'conflito', 'ausente', 'aguardando_aprovacao', 'recusada'];

/** Tamanho da coluna Tags.codigo. */
const TAG_CODIGO_COLUNA = 100;

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    // Módulo Guarita: bloquear/excluir uma tag que o Prestare gravou num Guarita
    // enfileira a remoção nele. Opcional (specs antigos instanciam só com o Prisma).
    @Optional() private readonly guarita?: GuaritaOperacoesService,
  ) {}

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
  async definirAtivo(idCondominio: number, id: number, ativo: boolean | number, autor = 'Portaria') {
    if (ativo !== true && ativo !== false && ativo !== 0 && ativo !== 1) {
      throw new BadRequestException('Informe "ativo" como verdadeiro (reativar) ou falso (bloquear).');
    }
    const tag = await this.tagDoCondominio(idCondominio, id);
    const reativar = ativo === true || ativo === 1;
    // Tag do Guarita (tag sem id_device segue exatamente como antes).
    if (this.guarita && tag.id_device != null) {
      if (reativar && tag.guarita_estado === 'removendo') {
        throw new BadRequestException(
          'Esta tag está sendo removida do Guarita. Para usá-la de novo, cadastre-a pela captura.',
        );
      }
      if (!reativar) {
        // Bloquear algo que o Prestare não gravou no Guarita diria "bloqueada"
        // com o portão ainda abrindo: recusa (I8).
        if (TAG_FORA_DO_CONTROLE.includes(tag.guarita_estado ?? '')) {
          throw new BadRequestException('Esta tag ainda não está sob controle do Prestare no Guarita.');
        }
        // Bloquear um dispositivo gravado no Guarita = tirá-lo de lá (o portão é ele quem abre).
        const removida = await this.guarita.enfileirarRemocao(tag.id, autor);
        await this.prisma.tags.updateMany({ where: { id: tag.id }, data: { ativo: 0 } });
        const atualizada = await this.prisma.tags.findFirst({ where: { id: tag.id } });
        return { ...(atualizada ?? { ...tag, ativo: 0 }), guarita_remocoes: removida ? 1 : 0 };
      }
    }
    return this.prisma.tags.update({
      where: { id: tag.id },
      data: { ativo: reativar ? 1 : 0 },
    });
  }

  /** Exclui a tag, desvinculando-a antes dos veículos que a usam. */
  async remove(idCondominio: number, id: number, autor = 'Portaria') {
    const tag = await this.tagDoCondominio(idCondominio, id);
    if (this.guarita && tag.id_device != null) {
      // Gravada pelo Prestare: a linha só some quando o Guarita confirmar a
      // remoção (GuaritaOperacoesService.aplicarResultado). A vincular (o
      // Prestare não a gravou) ou aguardando aprovação: sai só do Prestare.
      const removida = await this.guarita.enfileirarRemocao(tag.id, autor);
      if (removida) {
        await this.prisma.veiculos.updateMany({
          where: { id_tag: tag.id, id_condominio: idCondominio },
          data: { id_tag: null },
        });
        return { ok: true, guarita_remocoes: 1 };
      }
      await this.prisma.$transaction([
        this.prisma.veiculos.updateMany({
          where: { id_tag: tag.id, id_condominio: idCondominio },
          data: { id_tag: null },
        }),
        this.prisma.tags.delete({ where: { id: tag.id } }),
      ]);
      return { ok: true, guarita_remocoes: 0 };
    }
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
