import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TagDto {
  codigo: string;
  tipo?: string;
  descricao?: string | null;
}

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista as tags do condomínio. Com `livres=true`, retorna só as que não estão
   * vinculadas a nenhum veículo ativo (para o seletor de vínculo).
   */
  async findAll(idCondominio: number, livres = false) {
    return this.prisma.tags.findMany({
      where: {
        id_condominio: idCondominio,
        ativo: 1,
        ...(livres ? { veiculos: { none: { ativo: 1 } } } : {}),
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Cria/atualiza uma tag pelo par (condomínio, código). Usado quando a portaria
   * captura uma tag nova pelo leitor.
   */
  async upsert(idCondominio: number, dto: TagDto) {
    const codigo = (dto.codigo || '').trim();
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
        ativo: 1,
      },
    });
  }
}
