import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Fechamento mensal do livro caixa.
 *
 * Quando o síndico apresenta a prestação de contas em assembleia, ele
 * "fecha" o mês — a partir daí o sistema bloqueia mutações nos lançamentos
 * daquele período. Para corrigir algo, é necessário REABRIR explicitamente
 * (motivo registrado na auditoria).
 *
 * Exceção: cobranças de morador ("Apto X Bloco Y - Ref. MM/YYYY") podem
 * ser marcadas como pagas mesmo em mês fechado — moradores pagam atrasado
 * com frequência e bloquear isso travaria a operação.
 */
@Injectable()
export class FechamentoService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly tenant: TenantAccessService,
  ) {}

  /**
   * Lista fechamentos do condomínio (ativos e históricos).
   */
  async listar(idCondominio: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) return [];

    return this.prisma.fechamentoMensal.findMany({
      where: { id_condominio: Number(idCondominio) },
      orderBy: [{ ano: 'desc' }, { mes: 'desc' }, { fechado_em: 'desc' }],
    });
  }

  /**
   * Verifica se um período (mes/ano) está atualmente fechado.
   * Resposta cacheável — usada em insert/update/delete para barrar.
   */
  async isFechado(idCondominio: number, mes: number, ano: number): Promise<boolean> {
    if (!this.prisma.isConnected) return false;
    const f = await this.prisma.fechamentoMensal.findFirst({
      where: { id_condominio: Number(idCondominio), mes, ano, ativo: 1 },
      select: { id: true },
    });
    return !!f;
  }

  /**
   * Fecha um mês. Falha se já estiver fechado e ativo.
   */
  async fechar(
    idCondominio: number,
    mes: number,
    ano: number,
    user?: JwtPayload,
    observacao?: string,
  ) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) return { ok: true };

    if (!mes || mes < 1 || mes > 12) {
      throw new BadRequestException('Mês inválido (esperado 1-12)');
    }
    if (!ano || ano < 2000 || ano > 2100) {
      throw new BadRequestException('Ano inválido');
    }

    // Já fechado e ativo?
    const existente = await this.prisma.fechamentoMensal.findFirst({
      where: { id_condominio: Number(idCondominio), mes, ano, ativo: 1 },
    });
    if (existente) {
      throw new BadRequestException(`Mês ${String(mes).padStart(2, '0')}/${ano} já está fechado.`);
    }

    // Existe histórico (reaberto)? Cria novo registro ativo.
    const fechado = await this.prisma.fechamentoMensal.upsert({
      where: {
        id_condominio_mes_ano: { id_condominio: Number(idCondominio), mes, ano },
      },
      update: {
        fechado_em: new Date(),
        fechado_por: user?.nome ?? 'Sistema',
        observacao: observacao ?? null,
        reaberto_em: null,
        reaberto_por: null,
        motivo_reabertura: null,
        ativo: 1,
      },
      create: {
        id_condominio: Number(idCondominio),
        mes,
        ano,
        fechado_por: user?.nome ?? 'Sistema',
        observacao: observacao ?? null,
        ativo: 1,
      },
    });

    await this.auditoria.registrar({
      id_condominio: Number(idCondominio),
      usuario_nome: user?.nome ?? 'Sistema',
      acao: 'STATUS',
      modulo: 'financeiro',
      entidade_id: fechado.id,
      descricao: `Fechou competência ${String(mes).padStart(2, '0')}/${ano}`,
      detalhes: {
        fechamento: {
          mes,
          ano,
          observacao: observacao ?? null,
          fechado_em: fechado.fechado_em.toISOString(),
        },
      },
    });

    return { ok: true, fechamento: fechado };
  }

  /**
   * Reabre um mês fechado. Exige motivo (registrado na auditoria) — ato
   * grave, não pode ser feito sem justificativa.
   */
  async reabrir(
    idCondominio: number,
    mes: number,
    ano: number,
    motivo: string,
    user?: JwtPayload,
  ) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) return { ok: true };

    const motivoLimpo = motivo?.trim();
    if (!motivoLimpo || motivoLimpo.length < 10) {
      throw new BadRequestException(
        'Reabrir um mês fechado exige motivo (mínimo 10 caracteres). Esse motivo fica registrado para sempre na auditoria.',
      );
    }

    const fechado = await this.prisma.fechamentoMensal.findFirst({
      where: { id_condominio: Number(idCondominio), mes, ano, ativo: 1 },
    });
    if (!fechado) {
      throw new NotFoundException(`Mês ${String(mes).padStart(2, '0')}/${ano} não está fechado.`);
    }

    await this.prisma.fechamentoMensal.update({
      where: { id: fechado.id },
      data: {
        ativo: 0,
        reaberto_em: new Date(),
        reaberto_por: user?.nome ?? 'Sistema',
        motivo_reabertura: motivoLimpo,
      },
    });

    await this.auditoria.registrar({
      id_condominio: Number(idCondominio),
      usuario_nome: user?.nome ?? 'Sistema',
      acao: 'STATUS',
      modulo: 'financeiro',
      entidade_id: fechado.id,
      descricao: `Reabriu competência ${String(mes).padStart(2, '0')}/${ano}`,
      detalhes: {
        reabertura: {
          mes,
          ano,
          motivo: motivoLimpo,
          fechado_original_em: fechado.fechado_em.toISOString(),
          fechado_por: fechado.fechado_por,
        },
      },
    });

    return { ok: true };
  }

  /**
   * Lança exceção se o período de uma data está fechado. Use no insert/
   * update/delete de lançamentos financeiros.
   *
   * Quando `nomeLancamento` é fornecido E é cobrança de morador
   * ("Apto X Bloco Y - Ref."), permite mesmo em mês fechado (pagamento
   * atrasado é comum). Útil em updateStatus.
   */
  async assertPodeAlterar(
    idCondominio: number,
    data: Date | null | undefined,
    operacao: 'insert' | 'update' | 'delete' | 'updateStatus',
    nomeLancamento?: string | null,
  ): Promise<void> {
    if (!data) return; // Sem data, não bloqueia.

    const mes = data.getMonth() + 1;
    const ano = data.getFullYear();
    const fechado = await this.isFechado(idCondominio, mes, ano);
    if (!fechado) return;

    // Exceção: marcar como pago cobrança de morador é OK mesmo em mês
    // fechado (morador paga atrasado).
    //
    // O nome da cobrança varia conforme a origem, e a regra antiga só aceitava
    // o formato do app ("- Ref. MM/AAAA"). Ficavam de fora justamente as duas
    // origens mais comuns — a recorrência ("- Condomínio Ref. 07/2026") e o
    // modal da portaria-web ("- Taxa Condominial Ref. 07/2026") — além de
    // rateio e acordo. Resultado: depois de fechar a competência, o síndico não
    // conseguia dar baixa em nenhum pagamento atrasado das faturas geradas
    // automaticamente, que são a maioria.
    if (operacao === 'updateStatus' && nomeLancamento) {
      const ehCobrancaMorador =
        /^Apto\s+\S+\s+Bloco\s+\S+\s+-\s+.*\b(Ref\.|Rateio:|Acordo\s+Parc\.)/i.test(nomeLancamento);
      if (ehCobrancaMorador) return;
    }

    throw new ForbiddenException(
      `Competência ${String(mes).padStart(2, '0')}/${ano} está fechada. ` +
      `Para alterar lançamentos deste mês, reabra a competência primeiro (com motivo).`,
    );
  }
}
