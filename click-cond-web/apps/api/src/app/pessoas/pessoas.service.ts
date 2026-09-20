import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

  /**
   * `idPessoa` vem do path (`GET /condominios/:idCondominio/pessoas/:idPessoa/historico`)
   * sem relação alguma com o `:idCondominio` da mesma rota — sem esta
   * checagem, um operador do condomínio A lia nome, documento, telefone e
   * todas as visitas de uma pessoa do condomínio B só trocando o id na URL
   * (IDOR cross-tenant).
   */
  async obterHistorico(idCondominio: number, idPessoa: number) {
    const pessoa = await this.prisma.pessoas.findUnique({
      where: { id: Number(idPessoa) },
      select: { id: true, id_condominio: true },
    });
    if (!pessoa) {
      throw new NotFoundException(`Pessoa ${idPessoa} não encontrada`);
    }
    if (pessoa.id_condominio !== Number(idCondominio)) {
      throw new ForbiddenException('Acesso negado: esta pessoa pertence a outro condomínio.');
    }

    return this.prisma.visitas.findMany({
      where: { id_pessoa: Number(idPessoa) },
      include: {
        apartamento: { select: { id: true, bloco: true, apto: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Confere que a Pessoa existe antes de escrever nela.
   *
   * Sem isso, um `id` inexistente (digitado errado, já excluído, de outro
   * ambiente) deixava o P2025 do Prisma escapar cru do `update` e virar 500
   * — em vez do 404 que o chamador (rota HTTP, sync facial) já sabe tratar.
   */
  private async assertPessoaExiste(idPessoa: number): Promise<void> {
    const existente = await this.prisma.pessoas.findUnique({
      where: { id: Number(idPessoa) },
      select: { id: true },
    });
    if (!existente) {
      throw new NotFoundException(`Pessoa ${idPessoa} não encontrada`);
    }
  }

  async atualizarBiometria(idPessoa: number, faceId: string, status = 'synced', erro: string | null = null) {
    await this.assertPessoaExiste(idPessoa);
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
    await this.assertPessoaExiste(idPessoa);
    return this.prisma.pessoas.update({
      where: { id: Number(idPessoa) },
      data: {
        bloqueado: bloquear ? 1 : 0,
      },
    });
  }
}
