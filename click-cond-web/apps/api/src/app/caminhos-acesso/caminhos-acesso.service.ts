import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

export interface EtapaDto {
  /** Aparelho que identifica nesta etapa (LPR, facial, tag, QR). */
  id_leitor: number;
  /** Botoeira/catraca acionada. Nulo = etapa só registra a passagem. */
  id_abertura?: number | null;
}

export interface CreateCaminhoDto {
  nome: string;
  descricao?: string | null;
  ativo?: number;
  /** Na ordem em que a pessoa percorre. A posição no array define `ordem`. */
  etapas: EtapaDto[];
}

/** Tipos que IDENTIFICAM alguém — podem ser leitor de uma etapa. */
const TIPOS_LEITOR = ['facial', 'lpr', 'tag_reader', 'qrcode_reader'];
/** Tipos que ABREM passagem — podem ser a abertura de uma etapa. */
const TIPOS_ABERTURA = ['botoeira', 'catraca'];

@Injectable()
export class CaminhosAcessoService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private readonly includeEtapas = {
    etapas: {
      orderBy: { ordem: 'asc' as const },
      include: {
        leitor: { select: { id: true, nome: true, tipo: true, ativo: true } },
        abertura: { select: { id: true, nome: true, tipo: true, ativo: true } },
      },
    },
  };

  async findAll(idCondominio: number) {
    if (!this.prisma.isConnected) return [];
    return this.prisma.caminhos_Acesso.findMany({
      where: { id_condominio: idCondominio },
      include: this.includeEtapas,
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: number, idCondominio: number) {
    if (!this.prisma.isConnected) {
      throw new NotFoundException('Caminho não encontrado');
    }
    const caminho = await this.prisma.caminhos_Acesso.findFirst({
      // id_condominio no where (e não só no id): sem isso, trocar o id na URL
      // leria o caminho de outro condomínio.
      where: { id, id_condominio: idCondominio },
      include: this.includeEtapas,
    });
    if (!caminho) throw new NotFoundException('Caminho não encontrado');
    return caminho;
  }

  /**
   * Valida as etapas antes de gravar.
   *
   * Os ids vêm do cliente, então cada aparelho é reconferido contra o
   * condomínio — sem isso daria para montar um caminho apontando para o portão
   * de outro condomínio e acioná-lo de fora.
   */
  private async validarEtapas(idCondominio: number, etapas: EtapaDto[]) {
    if (!Array.isArray(etapas) || etapas.length === 0) {
      throw new BadRequestException('Informe ao menos uma etapa.');
    }

    const ids = new Set<number>();
    for (const e of etapas) {
      if (!e?.id_leitor) {
        throw new BadRequestException('Toda etapa precisa de um leitor.');
      }
      ids.add(Number(e.id_leitor));
      if (e.id_abertura) ids.add(Number(e.id_abertura));
    }

    const devices = await this.prisma.facial_Devices.findMany({
      where: { id: { in: Array.from(ids) }, id_condominio: idCondominio },
      select: { id: true, nome: true, tipo: true },
    });
    const porId = new Map(devices.map((d) => [d.id, d]));

    const leitoresUsados = new Set<number>();
    for (const [i, e] of etapas.entries()) {
      const leitor = porId.get(Number(e.id_leitor));
      if (!leitor) {
        throw new BadRequestException(
          `Etapa ${i + 1}: dispositivo não encontrado neste condomínio.`,
        );
      }
      if (!TIPOS_LEITOR.includes(leitor.tipo)) {
        throw new BadRequestException(
          `Etapa ${i + 1}: "${leitor.nome}" não identifica ninguém (é ${leitor.tipo}). Use um leitor facial, LPR, de tag ou de QR Code.`,
        );
      }
      // O mesmo leitor em duas etapas tornaria o roteamento ambíguo: ao
      // identificar, não daria para saber qual abertura acionar.
      if (leitoresUsados.has(leitor.id)) {
        throw new BadRequestException(
          `"${leitor.nome}" está em mais de uma etapa. Cada leitor só pode aparecer uma vez no caminho.`,
        );
      }
      leitoresUsados.add(leitor.id);

      if (e.id_abertura) {
        const abertura = porId.get(Number(e.id_abertura));
        if (!abertura) {
          throw new BadRequestException(
            `Etapa ${i + 1}: abertura não encontrada neste condomínio.`,
          );
        }
        if (!TIPOS_ABERTURA.includes(abertura.tipo)) {
          throw new BadRequestException(
            `Etapa ${i + 1}: "${abertura.nome}" não abre passagem (é ${abertura.tipo}). Use uma botoeira ou catraca.`,
          );
        }
      }
    }
  }

  /**
   * Um leitor só pode pertencer a um caminho ativo: em dois, a identificação
   * teria dois destinos possíveis.
   */
  private async assertLeitorLivre(
    idCondominio: number,
    etapas: EtapaDto[],
    ignorarCaminhoId?: number,
  ) {
    const leitores = etapas.map((e) => Number(e.id_leitor));
    const conflito = await this.prisma.caminhos_Etapas.findFirst({
      where: {
        id_leitor: { in: leitores },
        caminho: {
          id_condominio: idCondominio,
          ativo: 1,
          ...(ignorarCaminhoId ? { id: { not: ignorarCaminhoId } } : {}),
        },
      },
      include: {
        caminho: { select: { nome: true } },
        leitor: { select: { nome: true } },
      },
    });
    if (conflito) {
      throw new BadRequestException(
        `"${conflito.leitor?.nome ?? 'Leitor'}" já faz parte do caminho ativo "${conflito.caminho?.nome ?? ''}". Remova-o de lá antes.`,
      );
    }
  }

  async create(
    idCondominio: number,
    dto: CreateCaminhoDto,
    user?: JwtPayload,
  ) {
    if (!this.prisma.isConnected) {
      throw new BadRequestException('Banco de dados indisponível.');
    }
    const nome = (dto?.nome ?? '').trim();
    if (!nome) throw new BadRequestException('Informe o nome do caminho.');

    await this.validarEtapas(idCondominio, dto.etapas);
    const ativo = dto.ativo === 0 ? 0 : 1;
    if (ativo === 1) {
      await this.assertLeitorLivre(idCondominio, dto.etapas);
    }

    const caminho = await this.prisma.caminhos_Acesso.create({
      data: {
        id_condominio: idCondominio,
        nome,
        descricao: dto.descricao?.trim() || null,
        ativo,
        etapas: {
          create: dto.etapas.map((e, i) => ({
            ordem: i + 1,
            id_leitor: Number(e.id_leitor),
            id_abertura: e.id_abertura ? Number(e.id_abertura) : null,
          })),
        },
      },
      include: this.includeEtapas,
    });

    await this.auditoria.registrar({
      id_condominio: idCondominio,
      usuario_nome: user?.nome ?? 'Sistema',
      // CREATE/UPDATE/DELETE sao as acoes do tipo AuditoriaAcao. Este modulo
      // gravava 'CRIACAO'/'EDICAO'/'EXCLUSAO', que nenhum outro usa — os
      // registros ficavam invisiveis a qualquer filtro por acao na auditoria.
      acao: 'CREATE',
      modulo: 'caminhos-acesso',
      entidade_id: caminho.id,
      descricao: `Criou o caminho "${nome}" com ${dto.etapas.length} etapa(s)`,
    });

    return caminho;
  }

  async update(
    id: number,
    idCondominio: number,
    dto: Partial<CreateCaminhoDto>,
    user?: JwtPayload,
  ) {
    const atual = await this.findOne(id, idCondominio);

    const etapas = dto.etapas;
    if (etapas) {
      await this.validarEtapas(idCondominio, etapas);
    }
    const ativo = dto.ativo === undefined ? atual.ativo : dto.ativo === 0 ? 0 : 1;
    if (ativo === 1 && etapas) {
      await this.assertLeitorLivre(idCondominio, etapas, id);
    }

    // Etapas são substituídas em bloco: a ordem vem da posição no array, então
    // atualizar item a item deixaria buracos e violaria o único (caminho, ordem).
    await this.prisma.$transaction(async (tx) => {
      if (etapas) {
        await tx.caminhos_Etapas.deleteMany({ where: { id_caminho: id } });
        await tx.caminhos_Etapas.createMany({
          data: etapas.map((e, i) => ({
            id_caminho: id,
            ordem: i + 1,
            id_leitor: Number(e.id_leitor),
            id_abertura: e.id_abertura ? Number(e.id_abertura) : null,
          })),
        });
      }
      await tx.caminhos_Acesso.update({
        where: { id },
        data: {
          ...(dto.nome !== undefined ? { nome: dto.nome.trim() } : {}),
          ...(dto.descricao !== undefined
            ? { descricao: dto.descricao?.trim() || null }
            : {}),
          ativo,
        },
      });
    });

    await this.auditoria.registrar({
      id_condominio: idCondominio,
      usuario_nome: user?.nome ?? 'Sistema',
      acao: 'UPDATE',
      modulo: 'caminhos-acesso',
      entidade_id: id,
      descricao: `Editou o caminho "${dto.nome ?? atual.nome}"`,
    });

    return this.findOne(id, idCondominio);
  }

  async remove(id: number, idCondominio: number, user?: JwtPayload) {
    const caminho = await this.findOne(id, idCondominio);
    // As etapas somem por cascata da FK.
    await this.prisma.caminhos_Acesso.delete({ where: { id } });

    await this.auditoria.registrar({
      id_condominio: idCondominio,
      usuario_nome: user?.nome ?? 'Sistema',
      acao: 'DELETE',
      modulo: 'caminhos-acesso',
      entidade_id: id,
      descricao: `Removeu o caminho "${caminho.nome}"`,
    });

    return { success: true };
  }
}
