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
                { nome: { startsWith: search } },
                ...(docLimpo ? [{ doc_identificacao: { equals: docLimpo } }] : []),
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
      take: 50,
    });
  }

  private async atualizarSeNecessario(existente: any, dto: CriarPessoaDto) {
    const updateData: any = {};
    if (dto.telefone && !existente.telefone) updateData.telefone = dto.telefone;
    // Nome: propaga a correção (ex.: "Vinicius dd" -> "Vinicius Vilela").
    // Diferente de telefone/face_id, nome NÃO é "preenche só se faltar" —
    // sem isso, reregistrar com o nome corrigido devolvia o nome antigo em
    // toda parte que lê a Pessoa (lista, auditoria, terminal, a própria
    // resposta do create), e o app publicado manda nome_anterior/id_anterior
    // justamente esperando essa correção (visitantes.controller.ts:378-379).
    const nomeNovo = dto.nome?.trim();
    if (nomeNovo && nomeNovo !== existente.nome) updateData.nome = nomeNovo;
    // Foto (pessoa e documento): sempre que o operador manda uma nova, ela
    // substitui a anterior. "Preenche só se faltar" fazia reregistrar com
    // foto atualizada subir o arquivo e jogar a URL fora, deixando o rosto
    // velho no terminal facial. foto_documento nunca era escrito aqui.
    if (dto.foto_pessoa) updateData.foto_pessoa = dto.foto_pessoa;
    if (dto.foto_documento) updateData.foto_documento = dto.foto_documento;
    if (dto.face_id && !existente.face_id) updateData.face_id = dto.face_id;

    if (Object.keys(updateData).length > 0) {
      return this.prisma.pessoas.update({
        where: { id: existente.id },
        data: updateData,
      });
    }
    return existente;
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
        return this.atualizarSeNecessario(existentePorDoc, dto);
      }
    }

    // Regra herdada da heuristica antiga de agrupamento: mesmo rosto = mesma
    // pessoa. Sem isto, visitante sem CPF (o sistema aceita) vira uma Pessoa
    // nova a cada visita e o terminal acumula varias faces do mesmo humano —
    // o problema que esta migracao existe para resolver.
    if (dto.face_id) {
      const existentePorFace = await this.prisma.pessoas.findFirst({
        where: {
          id_condominio: Number(idCondominio),
          face_id: dto.face_id,
        },
      });

      if (existentePorFace) {
        return this.atualizarSeNecessario(existentePorFace, dto);
      }
    }

    try {
      return await this.prisma.pessoas.create({
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
    } catch (err: any) {
      // `@@unique([id_condominio, doc_identificacao])` (Task 1) faz duas
      // criações concorrentes do mesmo documento colidirem aqui em vez de
      // gerarem duas Pessoas. Sem este catch, a segunda requisição veria o
      // P2002 cru do Prisma como 500 em vez de ganhar a Pessoa que a
      // primeira acabou de criar.
      if (err?.code === 'P2002' && docLimpo) {
        const criadaPelaOutraRequisicao = await this.prisma.pessoas.findFirst({
          where: {
            id_condominio: Number(idCondominio),
            doc_identificacao: docLimpo,
          },
        });
        if (criadaPelaOutraRequisicao) {
          return this.atualizarSeNecessario(criadaPelaOutraRequisicao, dto);
        }
      }
      throw err;
    }
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
