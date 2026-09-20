import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CriarPessoaDto } from './dto/criar-pessoa.dto';

@Injectable()
export class PessoasService {
  constructor(private readonly prisma: PrismaService) {}

  static normalizarDoc(doc?: string | null): string | null {
    if (!doc) return null;
    const limpo = doc.replace(/\D/g, '').trim();
    return limpo.length > 0 ? limpo : null;
  }

  async buscarPessoas(idCondominio: number, search?: string) {
    const docLimpo = PessoasService.normalizarDoc(search);
    return this.prisma.pessoas.findMany({
      where: {
        id_condominio: Number(idCondominio),
        ...(search
          ? {
              OR: [
                { nome: { contains: search } },
                ...(docLimpo ? [{ doc_identificacao: { contains: docLimpo } }] : []),
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
      take: 50,
    });
  }

  async obterOuCriar(idCondominio: number, dto: CriarPessoaDto) {
    if (dto.id_pessoa) {
      const existente = await this.prisma.pessoas.findFirst({
        where: { id: Number(dto.id_pessoa), id_condominio: Number(idCondominio) },
      });
      if (existente) return existente;
    }

    const docLimpo = PessoasService.normalizarDoc(dto.doc_identificacao);

    if (docLimpo) {
      const existentePorDoc = await this.prisma.pessoas.findFirst({
        where: {
          id_condominio: Number(idCondominio),
          doc_identificacao: docLimpo,
        },
      });

      if (existentePorDoc) {
        const updateData: any = {};
        if (dto.telefone && !existentePorDoc.telefone) updateData.telefone = dto.telefone;
        if (dto.foto_pessoa && !existentePorDoc.foto_pessoa) updateData.foto_pessoa = dto.foto_pessoa;
        if (dto.face_id && !existentePorDoc.face_id) updateData.face_id = dto.face_id;

        if (Object.keys(updateData).length > 0) {
          return this.prisma.pessoas.update({
            where: { id: existentePorDoc.id },
            data: updateData,
          });
        }
        return existentePorDoc;
      }
    }

    return this.prisma.pessoas.create({
      data: {
        id_condominio: Number(idCondominio),
        nome: dto.nome.trim(),
        doc_identificacao: docLimpo,
        telefone: dto.telefone ?? null,
        foto_pessoa: dto.foto_pessoa ?? null,
        foto_documento: dto.foto_documento ?? null,
        tipo_pessoa: dto.tipo_pessoa ?? 'visitante',
        face_id: dto.face_id ?? null,
      },
    });
  }

  async obterHistorico(idPessoa: number) {
    return this.prisma.visitas.findMany({
      where: { id_pessoa: Number(idPessoa) },
      include: {
        apartamento: { select: { id: true, bloco: true, apto: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async atualizarBiometria(idPessoa: number, faceId: string, status = 'synced', erro: string | null = null) {
    return this.prisma.pessoas.update({
      where: { id: Number(idPessoa) },
      data: {
        face_id: faceId,
        face_enrolled_at: new Date(),
        face_sync_status: status,
        face_sync_error: erro,
      },
    });
  }

  async bloquearPessoa(idPessoa: number, bloquear: boolean) {
    return this.prisma.pessoas.update({
      where: { id: Number(idPessoa) },
      data: {
        bloqueado: bloquear ? 1 : 0,
      },
    });
  }
}
