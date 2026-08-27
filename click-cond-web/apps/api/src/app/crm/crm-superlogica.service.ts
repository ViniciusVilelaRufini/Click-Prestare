import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { SuperlogicaClient, SuperlogicaConfigError } from '../superlogica/superlogica.client';
import { SuperlogicaService } from '../superlogica/superlogica.service';

/**
 * Ativação comercial da integração Superlógica.
 *
 * Vincular um condomínio do Clique a um condomínio do ERP é o que "liga" a
 * integração para aquele prédio — é o passo que acontece no dia em que a venda
 * fecha. Sem vínculo, o condomínio é ignorado por toda a integração.
 *
 * Só leitura na Superlógica; a escrita acontece no banco do Clique.
 */

export interface CondominioSuperlogicaDisponivel {
  idSuperlogica: number;
  nome: string;
  /** Preenchido quando este condomínio do ERP já está vinculado. */
  vinculadoA: { id: number; nome: string } | null;
}

export interface CondominioCliqueVinculo {
  id: number;
  nome: string;
  ativo: boolean;
  idSuperlogica: number | null;
  totalApartamentos: number;
  /** Quantos apartamentos já têm vínculo de unidade (vindos da importação). */
  apartamentosVinculados: number;
}

@Injectable()
export class CrmSuperlogicaService {
  private readonly logger = new Logger(CrmSuperlogicaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly superlogica: SuperlogicaService,
    private readonly client: SuperlogicaClient,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Diz se as credenciais estão configuradas, para a tela avisar em vez de
   * mostrar um erro de rede sem explicação.
   */
  status() {
    return { configurado: this.client.estaConfigurado() };
  }

  /**
   * Condomínios do ERP disponíveis para vínculo, já marcando quais estão em
   * uso. É a lista que o operador vê ao ativar um cliente.
   */
  async listarDisponiveis(): Promise<CondominioSuperlogicaDisponivel[]> {
    const [doErp, jaVinculados] = await Promise.all([
      this.superlogica.listarCondominios(),
      this.prisma.condominios.findMany({
        where: { id_superlogica_cond: { not: null } },
        select: { id: true, nome: true, id_superlogica_cond: true },
      }),
    ]);

    const porIdSuperlogica = new Map(jaVinculados.map((c) => [c.id_superlogica_cond, c]));

    return doErp.map((c) => {
      const vinculo = porIdSuperlogica.get(Number(c.id_condominio_cond));
      return {
        idSuperlogica: Number(c.id_condominio_cond),
        nome: c.st_fantasia_cond || c.st_nome_cond,
        vinculadoA: vinculo ? { id: vinculo.id, nome: vinculo.nome } : null,
      };
    });
  }

  /** Condomínios do Clique e o estado do vínculo de cada um. */
  async listarCondominiosClique(): Promise<CondominioCliqueVinculo[]> {
    const condominios = await this.prisma.condominios.findMany({
      select: { id: true, nome: true, ativo: true, id_superlogica_cond: true },
      orderBy: { nome: 'asc' },
    });

    return Promise.all(
      condominios.map(async (c) => {
        const [total, vinculados] = await Promise.all([
          this.prisma.apartamentos.count({ where: { id_condominio: c.id } }),
          this.prisma.apartamentos.count({
            where: { id_condominio: c.id, id_superlogica_uni: { not: null } },
          }),
        ]);

        return {
          id: c.id,
          nome: c.nome,
          ativo: c.ativo === 1,
          idSuperlogica: c.id_superlogica_cond,
          totalApartamentos: total,
          apartamentosVinculados: vinculados,
        };
      }),
    );
  }

  /**
   * Liga a integração para um condomínio.
   *
   * Valida que o id existe mesmo no ERP: aceitar um número qualquer criaria um
   * vínculo que só falharia depois, na primeira sincronização.
   */
  async vincular(idCondominioClique: number, idSuperlogica: number, operador: string) {
    const condominio = await this.prisma.condominios.findUnique({
      where: { id: idCondominioClique },
      select: { id: true, nome: true, id_superlogica_cond: true },
    });
    if (!condominio) throw new NotFoundException('Condomínio não encontrado');

    const disponiveis = await this.listarDisponiveis();
    const alvo = disponiveis.find((c) => c.idSuperlogica === idSuperlogica);
    if (!alvo) {
      throw new NotFoundException(`Condomínio ${idSuperlogica} não existe na Superlógica`);
    }

    // Um condomínio do ERP só alimenta um do Clique. A checagem aqui dá a
    // mensagem boa; o índice único un_cond_superlogica é quem garante de fato,
    // fechando a corrida entre esta consulta e a gravação.
    if (alvo.vinculadoA && alvo.vinculadoA.id !== idCondominioClique) {
      throw new ConflictException(
        `"${alvo.nome}" já está vinculado ao condomínio "${alvo.vinculadoA.nome}"`,
      );
    }

    // Trocar de condomínio no ERP invalida os vínculos de unidade existentes:
    // id_unidade_uni 726 no condomínio 24 não é a mesma unidade que o 726 no
    // condomínio 31. Manter os antigos faria a sincronização casar cobrança com
    // o apartamento errado — vazamento entre moradores do mesmo prédio.
    const trocouDeErp =
      condominio.id_superlogica_cond != null && condominio.id_superlogica_cond !== idSuperlogica;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (trocouDeErp) {
          await tx.apartamentos.updateMany({
            where: { id_condominio: idCondominioClique },
            data: { id_superlogica_uni: null },
          });
        }

        await tx.condominios.update({
          where: { id: idCondominioClique },
          data: { id_superlogica_cond: idSuperlogica },
        });
      });
    } catch (e: any) {
      // P2002 = violação do índice un_cond_superlogica. Só acontece se outro
      // operador vinculou o mesmo condomínio entre a checagem acima e este
      // update. Sem tratar, o operador veria "Internal Server Error".
      if (e?.code === 'P2002') {
        throw new ConflictException(
          `"${alvo.nome}" acabou de ser vinculado a outro condomínio. Atualize a tela.`,
        );
      }
      throw e;
    }

    this.logger.log(`Condomínio ${idCondominioClique} vinculado à Superlógica ${idSuperlogica} por ${operador}`);

    await this.auditoria.registrar({
      id_condominio: idCondominioClique,
      usuario_nome: operador,
      acao: 'UPDATE',
      modulo: 'superlogica',
      entidade_id: idCondominioClique,
      descricao: `Integração Superlógica ativada: vinculado a "${alvo.nome}" (id ${idSuperlogica})`,
      detalhes: {
        idSuperlogica,
        nomeSuperlogica: alvo.nome,
        vinculoAnterior: condominio.id_superlogica_cond,
        vinculosDeUnidadeLimpos: trocouDeErp,
      },
    });

    return { success: true, idSuperlogica, nomeSuperlogica: alvo.nome };
  }

  /**
   * Desliga a integração para um condomínio.
   *
   * Não apaga os lançamentos já sincronizados — só interrompe a atualização.
   * Apagar histórico financeiro do morador por causa de um clique no CRM seria
   * destrutivo demais para uma ação de dois cliques.
   */
  async desvincular(idCondominioClique: number, operador: string) {
    const condominio = await this.prisma.condominios.findUnique({
      where: { id: idCondominioClique },
      select: { id: true, nome: true, id_superlogica_cond: true },
    });
    if (!condominio) throw new NotFoundException('Condomínio não encontrado');
    if (condominio.id_superlogica_cond == null) {
      return { success: true, jaEstavaDesvinculado: true };
    }

    // Os vínculos de unidade também caem, mantendo o invariante "id_superlogica_uni
    // só existe enquanto o condomínio está vinculado".
    //
    // Sem isso haveria um caminho de vazamento: desvincular do ERP 24 e depois
    // vincular ao 31 não passaria pela checagem de troca de vincular() — o
    // vínculo anterior já seria null —, e os apartamentos ficariam com ids de
    // unidade do 24 sendo casados contra cobranças do 31.
    //
    // Os lançamentos em Financeiro NÃO são tocados: desativar interrompe a
    // atualização, não apaga o histórico do morador.
    await this.prisma.$transaction(async (tx) => {
      await tx.apartamentos.updateMany({
        where: { id_condominio: idCondominioClique },
        data: { id_superlogica_uni: null },
      });

      await tx.condominios.update({
        where: { id: idCondominioClique },
        data: { id_superlogica_cond: null },
      });
    });

    await this.auditoria.registrar({
      id_condominio: idCondominioClique,
      usuario_nome: operador,
      acao: 'UPDATE',
      modulo: 'superlogica',
      entidade_id: idCondominioClique,
      descricao: 'Integração Superlógica desativada',
      detalhes: { vinculoAnterior: condominio.id_superlogica_cond, vinculosDeUnidadeLimpos: true },
    });

    return { success: true };
  }

  /**
   * Prévia das unidades do ERP, para o operador conferir ANTES de importar.
   *
   * Só leitura: não grava nada. Existe porque importar às cegas num condomínio
   * que já tem apartamentos cadastrados à mão é como se descobre, tarde demais,
   * que a numeração não bate.
   */
  async previewUnidades(idCondominioClique: number) {
    const condominio = await this.prisma.condominios.findUnique({
      where: { id: idCondominioClique },
      select: { id: true, nome: true, id_superlogica_cond: true },
    });
    if (!condominio) throw new NotFoundException('Condomínio não encontrado');
    if (condominio.id_superlogica_cond == null) {
      throw new ConflictException('Condomínio ainda não está vinculado à Superlógica');
    }

    // idSuperlogica vem do banco, nunca do cliente — ver INTEGRACAO_SUPERLOGICA.md §6.1.
    const unidades = await this.superlogica.listarUnidades(condominio.id_superlogica_cond);
    const existentes = await this.prisma.apartamentos.count({
      where: { id_condominio: idCondominioClique },
    });

    return {
      totalNoErp: unidades.length,
      apartamentosNoClique: existentes,
      amostra: unidades.slice(0, 10).map((u) => ({
        idSuperlogica: Number(u.id_unidade_uni),
        bloco: u.st_bloco_uni || null,
        unidade: u.st_unidade_uni,
        contatos: u.contatos?.length ?? 0,
      })),
    };
  }

  /** Traduz falha de credencial numa mensagem que o operador entende. */
  static descreverErro(e: unknown): string {
    if (e instanceof SuperlogicaConfigError) {
      return 'Credenciais da Superlógica não configuradas no servidor.';
    }
    return (e as Error)?.message ?? 'Falha ao consultar a Superlógica.';
  }
}
