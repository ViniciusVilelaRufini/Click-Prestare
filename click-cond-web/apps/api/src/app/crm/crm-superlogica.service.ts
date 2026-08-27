import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { SuperlogicaClient, SuperlogicaConfigError } from '../superlogica/superlogica.client';
import { SuperlogicaService } from '../superlogica/superlogica.service';
import { SuperlogicaSyncService } from '../superlogica/superlogica-sync.service';
import { MoradoresService } from '../moradores/moradores.service';
import { SuperlogicaWriteService } from '../superlogica/superlogica-write.service';

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
  /** Mão dupla: envia morador criado no Clique para o ERP. */
  escrita: boolean;
}

@Injectable()
export class CrmSuperlogicaService {
  private readonly logger = new Logger(CrmSuperlogicaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly superlogica: SuperlogicaService,
    private readonly client: SuperlogicaClient,
    private readonly auditoria: AuditoriaService,
    private readonly sync: SuperlogicaSyncService,
    private readonly moradores: MoradoresService,
    private readonly write: SuperlogicaWriteService,
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
      select: { id: true, nome: true, ativo: true, id_superlogica_cond: true, superlogica_escrita: true },
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
          escrita: c.superlogica_escrita === 1,
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

  /**
   * Importa as unidades do ERP como apartamentos vinculados.
   *
   * Fica no CRM (e não no sync automático) porque cria dado: precisa de um
   * humano decidindo, com a prévia na mão.
   */
  async importarUnidades(idCondominioClique: number, operador: string, comMoradores = false) {
    const base = await this.sync.importarUnidades(idCondominioClique);

    const moradores = comMoradores
      ? await this.criarMoradoresDosContatos(base.contatosPorApartamento, idCondominioClique)
      : { criados: 0, jaExistiam: 0, semNome: 0 };

    const resultado = {
      unidadesNoErp: base.unidadesNoErp,
      apartamentosCriados: base.apartamentosCriados,
      apartamentosVinculados: base.apartamentosVinculados,
      duplicadasIgnoradas: base.duplicadasIgnoradas,
      moradoresCriados: moradores.criados,
      moradoresJaExistiam: moradores.jaExistiam,
      moradoresSemNome: moradores.semNome,
    };

    await this.auditoria.registrar({
      id_condominio: idCondominioClique,
      usuario_nome: operador,
      acao: 'CREATE',
      modulo: 'superlogica',
      entidade_id: idCondominioClique,
      descricao:
        `Unidades importadas da Superlógica: ${resultado.apartamentosCriados} apartamento(s) criado(s), ` +
        `${resultado.apartamentosVinculados} vinculado(s)` +
        (comMoradores ? `, ${resultado.moradoresCriados} morador(es) criado(s)` : ''),
      detalhes: { ...resultado, comMoradores },
    });

    return resultado;
  }

  /**
   * Cria os moradores a partir dos contatos que a importação trouxe do ERP.
   *
   * Passa pelo MoradoresService.create de propósito: é ele que cria/reaproveita
   * o Users e monta o vínculo em Apartamentos_Users, sem o qual o Financeiro
   * não sabe de quem é a cobrança.
   *
   * Fica aqui, e não no módulo Superlógica, para não fechar um ciclo entre
   * SuperlogicaModule e MoradoresModule — o CRM já conhece os dois.
   */
  private async criarMoradoresDosContatos(
    porApartamento: { idApartamento: number; contatos: any[] }[],
    idCondominioClique: number,
  ) {
    let criados = 0;
    let jaExistiam = 0;
    let semNome = 0;

    for (const { idApartamento, contatos } of porApartamento) {
      for (const contato of contatos) {
        const nome = (contato.st_nome_con ?? '').trim();
        if (!nome) {
          semNome++;
          continue;
        }

        try {
          const criado = await this.moradores.create({
            nome,
            email: (contato.st_email_con ?? '').trim() || undefined,
            telefone: (contato.st_telefone_con ?? '').trim() || undefined,
            documento: (contato.st_cpf_con ?? '').trim() || undefined,
            // O ERP diz "Proprietário Residente", "Inquilino"...; o Clique usa
            // rótulos curtos. Só dá para afirmar com segurança o inquilino.
            tipo: /inquilin/i.test(contato.st_nometiporesp_tres ?? '') ? 'inquilino' : 'proprietario',
            id_apartamento: idApartamento,
            id_condominio: idCondominioClique,
            // Importar não pode disparar e-mail para o morador: quando essas
            // pessoas são avisadas é decisão da administradora.
            sendCredentials: false,
            // Estas pessoas VIERAM do ERP. Sem isso, o envio automático as
            // mandaria de volta e criaria contato duplicado na unidade.
            skipSuperlogica: true,
          });

          // Grava de onde ele veio. Sem isso, "Reenviar moradores" o trataria
          // como pendente e o mandaria de volta ao ERP — e como os contatos de
          // lá costumam vir sem CPF nem e-mail, a checagem de duplicidade não
          // o reconheceria, criando um contato repetido na unidade.
          const idContato = Number(contato.id_contato_con);
          if (criado?.id && Number.isFinite(idContato)) {
            await this.prisma.moradores.update({
              where: { id: criado.id },
              data: { id_superlogica_con: idContato },
            });
          }

          criados++;
        } catch (err: any) {
          // O create recusa duplicata por e-mail, documento ou nome+apartamento.
          // Numa reimportação isso é o esperado, não um erro.
          if (err?.status === 400) {
            jaExistiam++;
            continue;
          }
          this.logger.warn(`Falha ao importar contato "${nome}": ${err?.message ?? err}`);
          throw err;
        }
      }
    }

    return { criados, jaExistiam, semNome };
  }

  /** Dispara a sincronização de cobranças na hora, sem esperar o ciclo. */
  async sincronizarAgora(idCondominioClique: number, operador: string) {
    const resultado = await this.sync.sincronizarCondominio(idCondominioClique);

    await this.auditoria.registrar({
      id_condominio: idCondominioClique,
      usuario_nome: operador,
      acao: 'UPDATE',
      modulo: 'superlogica',
      entidade_id: idCondominioClique,
      descricao: `Sincronização manual: ${resultado.lancamentosGravados} lançamento(s) gravado(s)`,
      detalhes: resultado,
    });

    return resultado;
  }

  /**
   * Liga/desliga o envio de moradores do Clique para o ERP, por condomínio.
   *
   * Escrita no ERP altera cadastro real da administradora, então nasce
   * desligada e só é ligada de forma explícita, um condomínio por vez.
   */
  async definirEscrita(idCondominioClique: number, ligado: boolean, operador: string) {
    const condominio = await this.prisma.condominios.findUnique({
      where: { id: idCondominioClique },
      select: { id: true, nome: true, id_superlogica_cond: true },
    });
    if (!condominio) throw new NotFoundException('Condomínio não encontrado');
    if (condominio.id_superlogica_cond == null) {
      throw new ConflictException('Vincule o condomínio à Superlógica antes de ligar a escrita');
    }

    await this.prisma.condominios.update({
      where: { id: idCondominioClique },
      data: { superlogica_escrita: ligado ? 1 : 0 },
    });

    await this.auditoria.registrar({
      id_condominio: idCondominioClique,
      usuario_nome: operador,
      acao: 'UPDATE',
      modulo: 'superlogica',
      entidade_id: idCondominioClique,
      descricao: `Envio de moradores ao ERP ${ligado ? 'LIGADO' : 'desligado'}`,
      detalhes: { escrita: ligado },
    });

    return { success: true, escrita: ligado };
  }

  /**
   * Reenvia ao ERP os moradores do condomínio que ainda não subiram.
   *
   * Diferente do envio automático, este é síncrono: o motivo de cada recusa
   * volta para a tela em vez de ficar só no log.
   */
  async reenviarMoradores(idCondominioClique: number, operador: string) {
    const condominio = await this.prisma.condominios.findUnique({
      where: { id: idCondominioClique },
      select: { id: true, id_superlogica_cond: true, superlogica_escrita: true },
    });
    if (!condominio) throw new NotFoundException('Condomínio não encontrado');
    if (condominio.id_superlogica_cond == null) {
      throw new ConflictException('Condomínio não está vinculado à Superlógica');
    }
    if (condominio.superlogica_escrita !== 1) {
      throw new ConflictException('Ligue o envio de moradores antes de reenviar');
    }

    const resultado = await this.write.reenviarPendentes(idCondominioClique);

    await this.auditoria.registrar({
      id_condominio: idCondominioClique,
      usuario_nome: operador,
      acao: 'UPDATE',
      modulo: 'superlogica',
      entidade_id: idCondominioClique,
      descricao: `Reenvio de moradores ao ERP: ${resultado.enviados} de ${resultado.total}`,
      detalhes: resultado,
    });

    return resultado;
  }

  /** Traduz falha de credencial numa mensagem que o operador entende. */
  static descreverErro(e: unknown): string {
    if (e instanceof SuperlogicaConfigError) {
      return 'Credenciais da Superlógica não configuradas no servidor.';
    }
    return (e as Error)?.message ?? 'Falha ao consultar a Superlógica.';
  }
}
