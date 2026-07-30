import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';

export interface CreateApartamentoDto {
  bloco?: string;
  apto: string;
  fracao?: string;
  qtd_vagas?: number;
  id_condominio: number;
}

@Injectable()
export class ApartamentosService {
  private readonly logger = new Logger(ApartamentosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantAccessService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Rejeita unidades inválidas/fantasma no cadastro. "Apto 000 Bloco
   * Condominio" já entrou uma vez no banco e recebeu cobrança do job de
   * recorrência, poluindo a inadimplência — esta validação impede repetir.
   */
  private assertAptoValido(apto?: string | null, bloco?: string | null) {
    const aptoNorm = (apto ?? '').trim();
    const blocoNorm = (bloco ?? '').trim().toLowerCase();
    if (!aptoNorm) {
      throw new BadRequestException('Informe o número do apartamento.');
    }
    if (/^0+$/.test(aptoNorm)) {
      throw new BadRequestException(`"${aptoNorm}" não é um número de apartamento válido.`);
    }
    if (blocoNorm === 'condominio' || blocoNorm === 'condomínio') {
      throw new BadRequestException('"Condomínio" não pode ser usado como nome de bloco — informe o bloco real da unidade.');
    }
  }

  async findAll(idCondominio: number, search?: string) {
    if (!this.prisma.isConnected) {
      const mocks = [
        { id: 1, bloco: 'A', apto: '101', fracao: '0.0125', id_condominio: Number(idCondominio), qtdMoradores: 3 },
        { id: 2, bloco: 'A', apto: '102', fracao: '0.0125', id_condominio: Number(idCondominio), qtdMoradores: 2 },
        { id: 3, bloco: 'A', apto: '201', fracao: '0.0125', id_condominio: Number(idCondominio), qtdMoradores: 4 },
        { id: 4, bloco: 'B', apto: '101', fracao: '0.0150', id_condominio: Number(idCondominio), qtdMoradores: 1 },
        { id: 5, bloco: 'B', apto: '102', fracao: '0.0150', id_condominio: Number(idCondominio), qtdMoradores: 5 },
      ];

      if (search) {
        const s = search.toLowerCase();
        return mocks.filter((a) => a.apto.includes(s) || a.bloco.toLowerCase().includes(s));
      }
      return mocks;
    }

    const list = await this.prisma.apartamentos.findMany({
      where: {
        id_condominio: Number(idCondominio),
        ...(search
          ? {
              OR: [
                { apto: { contains: search } },
                { bloco: { contains: search } },
              ],
            }
          : {}),
      },
      include: {
        users: { select: { id_user: true } },
      },
    });

    list.sort((a, b) => {
      if (a.bloco === b.bloco) {
        return (a.apto ?? '').localeCompare(b.apto ?? '', 'pt', { numeric: true });
      }
      return (a.bloco ?? '').localeCompare(b.bloco ?? '');
    });

    return list.map((a) => ({
      id: a.id,
      bloco: a.bloco,
      apto: a.apto,
      fracao: a.fracao,
      qtd_vagas: a.qtd_vagas ?? 0,
      id_condominio: a.id_condominio,
      // Contagem canônica = usuários distintos vinculados (Apartamentos_Users), igual ao modal/app.
      qtdMoradores: new Set(a.users.map((u) => u.id_user)).size,
    }));
  }

  async findOne(id: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return { id, bloco: 'A', apto: '101', fracao: null, id_condominio: 1, qtdMoradores: 2 };
    }

    const a = await this.prisma.apartamentos.findUnique({ where: { id: Number(id) } });
    if (!a) throw new NotFoundException(`Apartamento ${id} não encontrado`);
    await this.tenant.assertEntidade(a.id_condominio, user, `apartamento #${id}`);
    return a;
  }

  async create(dto: CreateApartamentoDto, user?: JwtPayload) {
    assertStaff(user, 'cadastrar apartamento');
    await this.tenant.assertCondominio(dto.id_condominio, user);
    this.assertAptoValido(dto.apto, dto.bloco);
    if (!this.prisma.isConnected) {
      return {
        id: Date.now(),
        bloco: dto.bloco ?? null,
        apto: dto.apto,
        fracao: dto.fracao ?? null,
        id_condominio: dto.id_condominio,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    try {
      return await this.prisma.apartamentos.create({
        data: {
          bloco: dto.bloco ?? null,
          apto: dto.apto,
          fracao: dto.fracao ?? null,
          qtd_vagas: Number(dto.qtd_vagas) || 0,
          id_condominio: dto.id_condominio,
        },
      });
    } catch (err: any) {
      // Existe `@@unique([id_condominio, bloco, apto])`, então duplicata é
      // barrada no banco — mas o erro cru do Prisma subia como 500 e a tela
      // mostrava um texto técnico. O operador precisa saber que a unidade já
      // existe, não que houve falha no servidor.
      if (err?.code === 'P2002') {
        const label = dto.bloco ? `Apto ${dto.apto} Bloco ${dto.bloco}` : `Apto ${dto.apto}`;
        throw new BadRequestException(`${label} já está cadastrado neste condomínio.`);
      }
      this.logger.error(
        `[apartamentos.create] Falha: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Não foi possível cadastrar o apartamento. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }
  }

  async update(id: number, dto: Partial<CreateApartamentoDto>, user?: JwtPayload) {
    assertStaff(user, 'editar apartamento');
    if (!this.prisma.isConnected) {
      return { success: true, id };
    }

    const atual = await this.prisma.apartamentos.findUnique({
      where: { id: Number(id) },
      select: { apto: true, bloco: true, id_condominio: true },
    });
    if (!atual) throw new NotFoundException(`Apartamento ${id} não encontrado`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `apartamento #${id}`);

    // Valida o estado FINAL da unidade (campo enviado ou valor atual) —
    // impede transformar uma unidade válida em fantasma via update parcial.
    if (dto.apto !== undefined || dto.bloco !== undefined) {
      this.assertAptoValido(dto.apto ?? atual.apto, dto.bloco ?? atual.bloco);
    }

    try {
      return await this.prisma.apartamentos.update({
        where: { id: Number(id) },
        data: {
          ...(dto.bloco !== undefined && { bloco: dto.bloco }),
          ...(dto.apto !== undefined && { apto: dto.apto }),
          ...(dto.fracao !== undefined && { fracao: dto.fracao }),
          ...(dto.qtd_vagas !== undefined && { qtd_vagas: Number(dto.qtd_vagas) || 0 }),
        },
      });
    } catch (err: any) {
      // Renomear para uma unidade que já existe cai no unique e caía aqui
      // como "não encontrado" — mensagem que manda o operador procurar o
      // problema no lugar errado. A existência já foi conferida acima.
      if (err?.code === 'P2002') {
        const apto = dto.apto ?? atual.apto;
        const bloco = dto.bloco ?? atual.bloco;
        const label = bloco ? `Apto ${apto} Bloco ${bloco}` : `Apto ${apto}`;
        throw new BadRequestException(`${label} já está cadastrado neste condomínio.`);
      }
      this.logger.error(
        `[apartamentos.update] Falha ao atualizar ${id}: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Não foi possível salvar o apartamento. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }
  }

  /**
   * Remove a unidade. TODAS as chaves estrangeiras que apontam para
   * Apartamentos são `onDelete: Cascade` — vínculos de morador, visitantes,
   * vagas, agendamentos de área e mudanças somem junto, em silêncio.
   *
   * Como não dá para desfazer, a exclusão passa a contar o que vai levar
   * embora e devolver isso na resposta, além de registrar na auditoria. Sem
   * esse rastro, "sumiram as visitas do 101" era impossível de explicar
   * depois — o módulo inteiro não tinha auditoria nenhuma, sendo o único com
   * uma operação em cascata desse tamanho.
   */
  async remove(id: number, user?: JwtPayload) {
    assertStaff(user, 'remover apartamento');
    if (!this.prisma.isConnected) return { success: true };
    const atual = await this.prisma.apartamentos.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true, apto: true, bloco: true },
    });
    if (!atual) throw new NotFoundException(`Apartamento ${id} não encontrado`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `apartamento #${id}`);

    const [moradores, visitantes, vagas, agendamentos, mudancas] = await Promise.all([
      this.prisma.apartamentos_Users.count({ where: { id_apto: Number(id) } }),
      this.prisma.visitantes.count({ where: { id_apartamento: Number(id) } }),
      this.prisma.vagas.count({ where: { id_apartamento: Number(id) } }),
      this.prisma.areas_Sociais_Agendamentos.count({ where: { id_apartamento: Number(id) } }),
      this.prisma.mudancas.count({ where: { id_apartamento: Number(id) } }),
    ]);
    const arrastados = { moradores, visitantes, vagas, agendamentos, mudancas };

    try {
      await this.prisma.apartamentos.delete({ where: { id: Number(id) } });
    } catch (err: any) {
      // O catch respondia sempre "não encontrado", mascarando a causa real —
      // mesmo padrão que escondia a violação de chave estrangeira em
      // visitantes. A existência já foi conferida acima.
      this.logger.error(
        `[apartamentos.remove] Falha ao excluir ${id}: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Não foi possível remover o apartamento. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }

    const label = atual.bloco ? `Apto ${atual.apto} Bloco ${atual.bloco}` : `Apto ${atual.apto}`;
    await this.auditoria.registrar({
      id_condominio: atual.id_condominio,
      usuario_nome: user?.nome ?? 'Sistema',
      acao: 'DELETE',
      modulo: 'apartamentos',
      entidade_id: Number(id),
      descricao:
        `Removeu ${label} e, em cascata, ${moradores} vínculo(s) de morador, ` +
        `${visitantes} visita(s), ${vagas} vaga(s), ${agendamentos} reserva(s) e ${mudancas} mudança(s)`,
      detalhes: { apartamento: { id: Number(id), apto: atual.apto, bloco: atual.bloco }, arrastados },
    });

    return { success: true, arrastados };
  }

  async importBulk(idCondominio: number, linhas: any[], user?: JwtPayload) {
    assertStaff(user, 'importar apartamentos em massa');
    await this.tenant.assertCondominio(idCondominio, user);
    const criados = [];
    const ignorados: { apto: string; bloco: string | null; motivo: string }[] = [];
    for (const item of linhas) {
      const apto = item.apto?.toString() || item.lote?.toString();
      if (!apto) continue;
      const bloco = item.bloco?.toString() || item.quadra?.toString() || null;
      const fracao = item.fracao?.toString() || null;

      // Import em massa não aborta por uma linha inválida — pula e reporta.
      try {
        this.assertAptoValido(apto, bloco);
      } catch (err: any) {
        ignorados.push({ apto, bloco, motivo: err?.message ?? 'Unidade inválida' });
        continue;
      }

      try {
        if (this.prisma.isConnected) {
          const existing = await this.prisma.apartamentos.findFirst({
            where: {
              id_condominio: Number(idCondominio),
              apto,
              bloco,
            },
          });
          if (existing) continue;

          const novo = await this.prisma.apartamentos.create({
            data: {
              bloco,
              apto,
              fracao,
              id_condominio: Number(idCondominio),
            },
          });
          criados.push(novo);
        } else {
          criados.push({
            id: Date.now() + Math.random(),
            bloco,
            apto,
            fracao,
            id_condominio: Number(idCondominio),
          });
        }
      } catch (err: any) {
        console.log('Erro ao importar apartamento:', apto, err?.message);
      }
    }
    return { ok: true, total: criados.length, criados, ignorados };
  }
}