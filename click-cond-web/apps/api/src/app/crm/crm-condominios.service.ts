import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { FacialDeviceClientService } from '../facial/facial-device-client.service';

export interface CriarCondominioDto {
  nome: string;
  identificacao?: string | null;
  plano?: string | null;
  valorMensal?: number | null;
  diaVencimento?: number | null;
  /** Síndico inicial. Cria Users + Sindicos + vínculo, e devolve a senha gerada. */
  sindico?: {
    nome: string;
    email: string;
    telefone?: string | null;
    documento?: string | null;
    senha?: string | null;
  } | null;
  /** Geração de apartamentos em lote. Ex.: 2 blocos × 4 andares × 4 por andar. */
  apartamentos?: {
    blocos?: string[] | null;
    andares?: number | null;
    porAndar?: number | null;
  } | null;
}

/** O que a desativação congelou — devolvido para a UI confirmar o efeito. */
export interface ResumoDesativacao {
  moradores: number;
  funcionarios: number;
  terminais: number;
  apartamentos: number;
}

/**
 * Ciclo de vida comercial do condomínio no CRM: criação, desativação,
 * reativação e purga definitiva.
 *
 * A exclusão é deliberadamente em duas fases:
 *
 *   1. `desativar` corta o acesso na hora (o app já filtra `ativo = 0`, e aqui
 *      revogamos o token do agente local e desligamos os terminais) mas não
 *      apaga nada. Existe janela para desfazer.
 *   2. `purgar` remove de vez, e só aceita condomínio já desativado + o nome
 *      digitado por extenso. Antes de apagar qualquer linha, desprovisiona os
 *      rostos dos terminais — se a ordem se inverter, o sistema perde a lista
 *      de quem está gravado no aparelho e as pessoas continuam abrindo a porta
 *      do prédio para sempre, sem nada no banco para removê-las depois.
 *
 * Sobre contas: a cascata do banco cobre as 33 tabelas com `id_condominio`,
 * mas NÃO cobre `Users`. Apagar as contas junto é o que causou o incidente de
 * 30/06/2026 (um login que era síndico deste condomínio e funcionário de
 * outro foi destruído junto). Por isso a purga só apaga uma conta depois da
 * cascata, e apenas se ela tiver ficado sem nenhum vínculo em qualquer outro
 * condomínio.
 */
@Injectable()
export class CrmCondominiosService {
  private readonly logger = new Logger(CrmCondominiosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly deviceClient: FacialDeviceClientService,
  ) {}

  // ════════════════════════ Criação ════════════════════════

  async criar(dto: CriarCondominioDto, operador: string) {
    const nome = (dto?.nome ?? '').trim();
    if (!nome) throw new BadRequestException('Informe o nome do condomínio.');

    if (dto.sindico?.email) {
      const emailExistente = await this.prisma.users.findFirst({
        where: { OR: [{ email: dto.sindico.email }, { login: dto.sindico.email }] },
        select: { id: true },
      });
      if (emailExistente) {
        throw new ConflictException(
          'Já existe uma conta com este e-mail. Cadastre o condomínio e vincule o síndico existente depois.',
        );
      }
    }

    const senhaSindico =
      dto.sindico?.senha?.trim() || this.gerarSenha();

    const resultado = await this.prisma.$transaction(async (tx) => {
      const cond = await tx.condominios.create({
        data: {
          nome,
          identificacao: dto.identificacao?.trim() || null,
          ativo: 1,
          categoria_padrao: dto.plano?.trim() || 'Taxa Condominial',
          valor_condominio: Number(dto.valorMensal ?? 0),
          dia_vencimento: Number(dto.diaVencimento ?? 10),
        },
      });

      // Apartamentos em lote. skipDuplicates protege a unique
      // (id_condominio, bloco, apto) se o operador repetir um bloco.
      const aptos = this.montarApartamentos(cond.id, dto.apartamentos);
      if (aptos.length) {
        await tx.apartamentos.createMany({ data: aptos, skipDuplicates: true });
      }

      let idUserSindico: number | null = null;
      if (dto.sindico?.nome && dto.sindico?.email) {
        const user = await tx.users.create({
          data: {
            name: dto.sindico.nome.trim(),
            email: dto.sindico.email.trim(),
            login: dto.sindico.email.trim(),
            password: await bcrypt.hash(senhaSindico, 10),
            phone: dto.sindico.telefone?.trim() || null,
            cpf: dto.sindico.documento?.trim() || null,
            is_sindico: 1,
          },
        });
        await tx.sindicos.create({
          data: {
            name: dto.sindico.nome.trim(),
            email: dto.sindico.email.trim(),
            phone: dto.sindico.telefone?.trim() || null,
            doc_identification: dto.sindico.documento?.trim() || null,
            id_user: user.id,
          },
        });
        await tx.sindicos_Condominios.create({
          data: { id_user: user.id, id_condominio: cond.id },
        });
        idUserSindico = user.id;
      }

      return { cond, totalAptos: aptos.length, idUserSindico };
    });

    await this.auditoria.registrar({
      id_condominio: resultado.cond.id,
      usuario_nome: operador,
      acao: 'CREATE',
      modulo: 'crm-condominio',
      entidade_id: resultado.cond.id,
      descricao: `Condomínio "${nome}" criado pelo CRM`,
      detalhes: {
        apartamentos: resultado.totalAptos,
        sindico: dto.sindico?.email ?? null,
      },
    });

    return {
      id: resultado.cond.id,
      nome: resultado.cond.nome,
      apartamentosCriados: resultado.totalAptos,
      sindicoCriado: resultado.idUserSindico != null,
      // Devolvida uma única vez, para a UI mostrar/enviar ao síndico.
      senhaSindico: resultado.idUserSindico != null ? senhaSindico : null,
    };
  }

  /**
   * Geração em lote de unidades num condomínio que já existe.
   * `skipDuplicates` deixa a operação repetível: rodar de novo para um bloco
   * novo não esbarra nas unidades já cadastradas.
   */
  async gerarApartamentos(
    idCondominio: number,
    cfg: { blocos: string[]; andares: number; porAndar: number },
    operador: string,
  ) {
    const cond = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { id: true, nome: true },
    });
    if (!cond) throw new NotFoundException('Condomínio não encontrado.');

    const linhas = this.montarApartamentos(idCondominio, cfg);
    if (!linhas.length) {
      throw new BadRequestException('Informe ao menos um bloco, os andares e as unidades por andar.');
    }

    const antes = await this.prisma.apartamentos.count({ where: { id_condominio: idCondominio } });
    await this.prisma.apartamentos.createMany({ data: linhas, skipDuplicates: true });
    const depois = await this.prisma.apartamentos.count({ where: { id_condominio: idCondominio } });
    const criados = depois - antes;

    await this.auditoria.registrar({
      id_condominio: idCondominio,
      usuario_nome: operador,
      acao: 'CREATE',
      modulo: 'apartamentos',
      entidade_id: idCondominio,
      descricao: `Gerou ${criados} unidade(s) em lote para "${cond.nome}" pelo CRM`,
      detalhes: { blocos: cfg.blocos, andares: cfg.andares, porAndar: cfg.porAndar, criados, repetidos: linhas.length - criados },
    });

    return { success: true, criados, repetidos: linhas.length - criados, total: depois };
  }

  /** Gera bloco × andar × unidade — ex.: bloco A, andar 3, unidade 2 → "302". */
  private montarApartamentos(
    idCondominio: number,
    cfg: CriarCondominioDto['apartamentos'],
  ): { id_condominio: number; bloco: string; apto: string }[] {
    if (!cfg) return [];
    const blocos = (cfg.blocos ?? []).map((b) => b.trim()).filter(Boolean);
    const andares = Number(cfg.andares ?? 0);
    const porAndar = Number(cfg.porAndar ?? 0);
    if (!blocos.length || andares <= 0 || porAndar <= 0) return [];

    // Teto de segurança: um dedo pesado no formulário não pode gerar 100 mil
    // linhas numa transação.
    const total = blocos.length * andares * porAndar;
    if (total > 2000) {
      throw new BadRequestException(
        `A combinação geraria ${total} apartamentos. Reduza os blocos, andares ou unidades por andar (máximo 2000).`,
      );
    }

    const linhas: { id_condominio: number; bloco: string; apto: string }[] = [];
    for (const bloco of blocos) {
      for (let andar = 1; andar <= andares; andar++) {
        for (let n = 1; n <= porAndar; n++) {
          linhas.push({
            id_condominio: idCondominio,
            bloco,
            apto: `${andar}${String(n).padStart(2, '0')}`,
          });
        }
      }
    }
    return linhas;
  }

  private gerarSenha(): string {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(
      { length: 8 },
      () => alfabeto[Math.floor(Math.random() * alfabeto.length)],
    ).join('');
  }

  // ════════════════════ Desativação / reativação ════════════════════

  async desativar(id: number, motivo: string, operador: string): Promise<ResumoDesativacao> {
    const cond = await this.prisma.condominios.findUnique({ where: { id } });
    if (!cond) throw new NotFoundException('Condomínio não encontrado.');
    if (cond.ativo === 0) {
      throw new ConflictException('Este condomínio já está desativado.');
    }
    const justificativa = (motivo ?? '').trim();
    if (justificativa.length < 5) {
      throw new BadRequestException('Informe o motivo da desativação (mínimo 5 caracteres).');
    }

    const resumo = await this.contar(id);

    await this.prisma.$transaction([
      // agent_token = null derruba o agente local: resolveCondominioForAgent
      // deixa de encontrar o condomínio e o agente perde a sincronização.
      this.prisma.condominios.update({
        where: { id },
        data: { ativo: 0, agent_token: null },
      }),
      this.prisma.facial_Devices.updateMany({
        where: { id_condominio: id },
        data: { ativo: 0 },
      }),
    ]);

    await this.auditoria.registrar({
      id_condominio: id,
      usuario_nome: operador,
      acao: 'DEACTIVATE',
      modulo: 'crm-condominio',
      entidade_id: id,
      descricao: `Condomínio "${cond.nome}" desativado — ${justificativa}`,
      detalhes: resumo,
    });

    return resumo;
  }

  async reativar(id: number, operador: string) {
    const cond = await this.prisma.condominios.findUnique({ where: { id } });
    if (!cond) throw new NotFoundException('Condomínio não encontrado.');
    if (cond.ativo === 1) {
      throw new ConflictException('Este condomínio já está ativo.');
    }

    await this.prisma.$transaction([
      this.prisma.condominios.update({ where: { id }, data: { ativo: 1 } }),
      this.prisma.facial_Devices.updateMany({
        where: { id_condominio: id },
        data: { ativo: 1 },
      }),
    ]);

    await this.auditoria.registrar({
      id_condominio: id,
      usuario_nome: operador,
      acao: 'REACTIVATE',
      modulo: 'crm-condominio',
      entidade_id: id,
      descricao: `Condomínio "${cond.nome}" reativado`,
    });

    // O agent_token é regerado sob demanda no próximo download de config.
    return { success: true, nome: cond.nome };
  }

  private async contar(id: number): Promise<ResumoDesativacao> {
    const [moradores, funcionarios, terminais, apartamentos] = await Promise.all([
      this.prisma.moradores.count({ where: { id_condominio: id } }),
      this.prisma.funcionarios.count({ where: { id_condominio: id } }),
      this.prisma.facial_Devices.count({ where: { id_condominio: id } }),
      this.prisma.apartamentos.count({ where: { id_condominio: id } }),
    ]);
    return { moradores, funcionarios, terminais, apartamentos };
  }

  // ════════════════════════ Purga ════════════════════════

  async purgar(id: number, confirmacaoNome: string, operador: string) {
    const cond = await this.prisma.condominios.findUnique({ where: { id } });
    if (!cond) throw new NotFoundException('Condomínio não encontrado.');

    if (cond.ativo !== 0) {
      throw new ConflictException(
        'Desative o condomínio antes de excluir definitivamente. A desativação já corta o acesso e dá margem para desfazer.',
      );
    }
    if ((confirmacaoNome ?? '').trim() !== cond.nome.trim()) {
      throw new BadRequestException(
        'O nome digitado não confere com o nome do condomínio.',
      );
    }

    const resumo = await this.contar(id);

    // 1. Rostos fora dos terminais ANTES de tocar no banco.
    const facial = await this.limparTerminais(id);

    // 2. Contas candidatas — decididas antes, apagadas depois da cascata.
    const candidatos = await this.usuariosVinculados(id);

    // 3. A cascata do banco leva as 33 tabelas com id_condominio.
    await this.prisma.condominios.delete({ where: { id } });

    // 4. Só agora: apaga as contas que ficaram sem QUALQUER vínculo.
    const contasRemovidas = await this.removerContasOrfas(candidatos);

    await this.auditoria.registrar({
      id_condominio: id,
      usuario_nome: operador,
      acao: 'DELETE',
      modulo: 'crm-condominio',
      entidade_id: id,
      descricao: `Condomínio "${cond.nome}" excluído definitivamente pelo CRM`,
      detalhes: {
        ...resumo,
        contasRemovidas,
        contasPreservadas: candidatos.length - contasRemovidas,
        terminaisLimpos: facial.limpos,
        terminaisComFalha: facial.falhas,
      },
    });

    return {
      success: true,
      nome: cond.nome,
      ...resumo,
      contasRemovidas,
      contasPreservadas: candidatos.length - contasRemovidas,
      terminaisLimpos: facial.limpos,
      terminaisComFalha: facial.falhas,
    };
  }

  /**
   * Apaga todos os rostos gravados nos terminais do condomínio.
   * Best-effort por aparelho: um terminal offline não pode travar a exclusão,
   * mas volta na resposta para o operador saber que aquele equipamento ainda
   * tem gente cadastrada e precisa ser limpo na mão (ou reinicializado).
   */
  private async limparTerminais(idCondominio: number) {
    let limpos = 0;
    const falhas: string[] = [];

    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio },
    });

    for (const device of devices) {
      try {
        const ids = await this.deviceClient.listUserIds(device as any);
        if (ids.length) {
          await this.deviceClient.removeUsers(device as any, ids);
        }
        limpos++;
      } catch (e: any) {
        this.logger.error(
          `Falha ao limpar rostos do terminal ${device.id} (${device.nome}): ${e?.message}`,
        );
        falhas.push(device.nome ?? `#${device.id}`);
      }
    }

    return { limpos, falhas };
  }

  /** Todo Users com algum papel neste condomínio (síndico, morador, funcionário). */
  private async usuariosVinculados(idCondominio: number): Promise<number[]> {
    const [sindicos, moradores, funcionarios, aptoUsers] = await Promise.all([
      this.prisma.sindicos_Condominios.findMany({
        where: { id_condominio: idCondominio },
        select: { id_user: true },
      }),
      this.prisma.moradores.findMany({
        where: { id_condominio: idCondominio },
        select: { id_user: true },
      }),
      this.prisma.funcionarios.findMany({
        where: { id_condominio: idCondominio },
        select: { id_user: true },
      }),
      this.prisma.apartamentos_Users.findMany({
        where: { apartamento: { id_condominio: idCondominio } },
        select: { id_user: true },
      }),
    ]);

    const ids = new Set<number>();
    for (const lista of [sindicos, moradores, funcionarios, aptoUsers]) {
      for (const r of lista as { id_user: number | null }[]) {
        if (r.id_user != null) ids.add(r.id_user);
      }
    }
    return [...ids];
  }

  /**
   * Apaga apenas as contas que, depois da cascata, não sobraram vinculadas a
   * nenhum condomínio. É aqui que mora a proteção contra o incidente de
   * shared-email: quem for síndico ou funcionário de outro prédio permanece.
   */
  private async removerContasOrfas(candidatos: number[]): Promise<number> {
    let removidas = 0;

    for (const idUser of candidatos) {
      const [sindico, morador, funcionario, aptoUser] = await Promise.all([
        this.prisma.sindicos_Condominios.count({ where: { id_user: idUser } }),
        this.prisma.moradores.count({ where: { id_user: idUser } }),
        this.prisma.funcionarios.count({ where: { id_user: idUser } }),
        this.prisma.apartamentos_Users.count({ where: { id_user: idUser } }),
      ]);

      if (sindico + morador + funcionario + aptoUser > 0) continue;

      try {
        await this.prisma.users.delete({ where: { id: idUser } });
        removidas++;
      } catch (e: any) {
        // Uma conta que não sai (FK residual de outro módulo) não pode
        // derrubar a exclusão inteira — o condomínio já foi apagado.
        this.logger.warn(`Conta ${idUser} não pôde ser removida: ${e?.message}`);
      }
    }

    return removidas;
  }
}
