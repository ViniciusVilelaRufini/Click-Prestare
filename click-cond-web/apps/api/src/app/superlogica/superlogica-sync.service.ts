import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SuperlogicaService } from './superlogica.service';
import { SuperlogicaContato, SuperlogicaUnidade } from './superlogica.types';

/**
 * Importação de unidades e sincronização das cobranças da Superlógica.
 *
 * Só lê do ERP; escreve apenas no banco do Clique. Trabalha exclusivamente em
 * condomínios com `id_superlogica_cond` preenchido — sem vínculo, o condomínio
 * é ignorado. Ver INTEGRACAO_SUPERLOGICA.md.
 */

/** Intervalo do polling. Boleto muda devagar; de hora em hora é suficiente. */
const INTERVALO_SYNC_MS = 60 * 60 * 1000;

/** Espera antes da primeira execução, para não competir com o boot. */
const ATRASO_INICIAL_MS = 5 * 60 * 1000;

export interface ResultadoImportacao {
  unidadesNoErp: number;
  apartamentosCriados: number;
  apartamentosVinculados: number;
  duplicadasIgnoradas: string[];
  /**
   * Contatos do ERP por apartamento criado/vinculado.
   *
   * Devolvidos em vez de virarem moradores aqui: criar morador exige o cadastro
   * oficial (MoradoresService), e fazer este módulo depender dele fecharia um
   * ciclo entre SuperlogicaModule e MoradoresModule. Quem orquestra é o CRM.
   */
  contatosPorApartamento: { idApartamento: number; contatos: SuperlogicaContato[] }[];
}

export interface ResultadoSync {
  cobrancasLidas: number;
  lancamentosGravados: number;
  semApartamento: number;
  descartadas: number;
}

@Injectable()
export class SuperlogicaSyncService implements OnModuleInit {
  private readonly logger = new Logger(SuperlogicaSyncService.name);
  private syncRodando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly superlogica: SuperlogicaService,
  ) {}

  onModuleInit() {
    setInterval(() => void this.tickSincronizacao(), INTERVALO_SYNC_MS);
    setTimeout(() => void this.tickSincronizacao(), ATRASO_INICIAL_MS);
  }

  /**
   * Normaliza a identificação da unidade vinda do ERP.
   *
   * A Superlógica manda com zeros à esquerda ("000408", bloco "01"). Guardar
   * assim deixaria o app mostrando "Apto 000408" e, pior, o casamento por texto
   * do Financeiro (`\bApto 408\b`) não encontraria o lançamento.
   */
  static normalizarUnidade(valor: string | null | undefined): string {
    const bruto = (valor ?? '').trim();
    if (!bruto) return '';
    // Só tira zeros de identificação puramente numérica: "0A1" não é número e
    // mexer nela mudaria o nome da unidade.
    if (!/^\d+$/.test(bruto)) return bruto;
    const semZeros = bruto.replace(/^0+/, '');
    return semZeros || '0';
  }

  /** Unidade fantasma do ERP (lançamento do próprio condomínio). */
  private ehUnidadeFantasma(apto: string): boolean {
    return !apto || /^0+$/.test(apto);
  }

  private async condominioVinculado(idCondominioClique: number) {
    const condominio = await this.prisma.condominios.findUnique({
      where: { id: idCondominioClique },
      select: { id: true, nome: true, id_superlogica_cond: true },
    });
    if (!condominio) throw new NotFoundException('Condomínio não encontrado');
    if (condominio.id_superlogica_cond == null) {
      throw new ConflictException('Condomínio não está vinculado à Superlógica');
    }
    return condominio as { id: number; nome: string; id_superlogica_cond: number };
  }

  /**
   * Cria/vincula os apartamentos a partir das unidades do ERP.
   *
   * Roda uma vez, na ativação. É o passo que grava `id_superlogica_uni` e
   * dispensa qualquer casamento por texto na hora de sincronizar cobrança.
   *
   * Idempotente: reexecutar não duplica, porque o upsert usa a chave única
   * (id_condominio, bloco, apto).
   */
  async importarUnidades(idCondominioClique: number): Promise<ResultadoImportacao> {
    const condominio = await this.condominioVinculado(idCondominioClique);
    const unidades = await this.superlogica.listarUnidades(condominio.id_superlogica_cond);

    let criados = 0;
    let vinculados = 0;
    const duplicadas: string[] = [];
    const vistos = new Set<string>();
    const contatosPorApartamento: { idApartamento: number; contatos: SuperlogicaContato[] }[] = [];

    for (const u of unidades) {
      const apto = SuperlogicaSyncService.normalizarUnidade(u.st_unidade_uni);
      const bloco = SuperlogicaSyncService.normalizarUnidade(u.st_bloco_uni) || null;

      if (this.ehUnidadeFantasma(apto)) continue;

      // Duas unidades do ERP que normalizam para a mesma identificação
      // sobrescreveriam o vínculo uma da outra — e as cobranças de uma cairiam
      // na outra. Melhor não importar e reportar para conferência humana.
      const chave = `${bloco ?? ''}|${apto}`;
      if (vistos.has(chave)) {
        duplicadas.push(chave.replace('|', ' '));
        continue;
      }
      vistos.add(chave);

      const existente = await this.prisma.apartamentos.findFirst({
        where: { id_condominio: idCondominioClique, bloco, apto },
        select: { id: true, id_superlogica_uni: true },
      });

      let idApartamento: number;

      if (existente) {
        idApartamento = existente.id;
        if (existente.id_superlogica_uni !== Number(u.id_unidade_uni)) {
          await this.prisma.apartamentos.update({
            where: { id: existente.id },
            data: { id_superlogica_uni: Number(u.id_unidade_uni) },
          });
          vinculados++;
        }
      } else {
        const novo = await this.prisma.apartamentos.create({
          data: {
            id_condominio: idCondominioClique,
            bloco,
            apto,
            id_superlogica_uni: Number(u.id_unidade_uni),
          },
        });
        idApartamento = novo.id;
        criados++;
      }

      contatosPorApartamento.push({ idApartamento, contatos: u.contatos ?? [] });
    }

    this.logger.log(
      `Importação do condomínio ${idCondominioClique}: ${criados} criados, ${vinculados} vinculados, ${duplicadas.length} duplicadas.`,
    );

    return {
      unidadesNoErp: unidades.length,
      apartamentosCriados: criados,
      apartamentosVinculados: vinculados,
      duplicadasIgnoradas: duplicadas,
      contatosPorApartamento,
    };
  }

  /** Primeiro dia do mês anterior — início da janela sincronizada. */
  private inicioJanela(hoje = new Date()): Date {
    return new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  }

  /** Último dia do mês seguinte — cobre boleto já emitido para o próximo mês. */
  private fimJanela(hoje = new Date()): Date {
    return new Date(hoje.getFullYear(), hoje.getMonth() + 2, 0);
  }

  /**
   * Espelha as cobranças de um condomínio no Financeiro.
   *
   * Faz upsert por (origem, id_condominio, id_externo): reprocessar o mesmo
   * período atualiza o que mudou (pagamento, valor) sem duplicar.
   */
  async sincronizarCondominio(idCondominioClique: number, hoje = new Date()): Promise<ResultadoSync> {
    const condominio = await this.condominioVinculado(idCondominioClique);

    const cobrancas = await this.superlogica.listarCobrancas(
      condominio.id_superlogica_cond,
      this.inicioJanela(hoje),
      this.fimJanela(hoje),
    );

    // Um único SELECT resolve o vínculo de todas as cobranças do lote.
    const apartamentos = await this.prisma.apartamentos.findMany({
      where: { id_condominio: idCondominioClique, id_superlogica_uni: { not: null } },
      select: { id_superlogica_uni: true, apto: true, bloco: true },
    });
    const porUnidade = new Map(apartamentos.map((a) => [a.id_superlogica_uni, a]));

    let gravados = 0;
    let semApartamento = 0;
    let descartadas = 0;

    for (const cobranca of cobrancas) {
      const apartamento = porUnidade.get(Number(cobranca.id_unidade_uni));
      if (!apartamento) {
        // Unidade não importada (ou fantasma do ERP). Sem apartamento não há a
        // quem mostrar — e inventar um vínculo é justamente como cobrança
        // aparece para o morador errado.
        semApartamento++;
        continue;
      }

      const dados = this.superlogica.mapearCobranca(
        cobranca,
        idCondominioClique,
        apartamento.apto ?? '',
        apartamento.bloco,
      );
      if (!dados) {
        descartadas++;
        continue;
      }

      await this.prisma.financeiro.upsert({
        where: {
          origem_id_condominio_id_externo: {
            origem: dados.origem,
            id_condominio: dados.id_condominio,
            id_externo: dados.id_externo,
          },
        },
        create: dados,
        // Só o que a Superlógica manda é atualizado. Campos que o operador
        // possa ter preenchido no Clique (comprovante, foto) ficam de fora.
        update: {
          nome: dados.nome,
          valor: dados.valor,
          data: dados.data,
          data_vencimento: dados.data_vencimento,
          pago: dados.pago,
          status: dados.status,
          descricao: dados.descricao,
          pix_copia_cola: dados.pix_copia_cola,
          url_boleto: dados.url_boleto,
        },
      });
      gravados++;
    }

    this.logger.log(
      `Sync do condomínio ${idCondominioClique}: ${gravados} lançamento(s), ${semApartamento} sem apartamento, ${descartadas} descartada(s).`,
    );

    return {
      cobrancasLidas: cobrancas.length,
      lancamentosGravados: gravados,
      semApartamento,
      descartadas,
    };
  }

  /** Sincroniza todos os condomínios vinculados. Usado pelo tick horário. */
  async sincronizarTodos(): Promise<Record<number, ResultadoSync | string>> {
    const vinculados = await this.prisma.condominios.findMany({
      where: { id_superlogica_cond: { not: null } },
      select: { id: true, nome: true },
    });

    const resultado: Record<number, ResultadoSync | string> = {};

    for (const c of vinculados) {
      try {
        resultado[c.id] = await this.sincronizarCondominio(c.id);
      } catch (err: any) {
        // Um condomínio com problema não pode parar a sincronização dos outros.
        this.logger.error(`Sync do condomínio ${c.id} (${c.nome}) falhou: ${err?.message ?? err}`);
        resultado[c.id] = `erro: ${err?.message ?? err}`;
      }
    }

    return resultado;
  }

  private async tickSincronizacao() {
    if (this.syncRodando) return;
    this.syncRodando = true;
    try {
      const vinculados = await this.prisma.condominios.count({
        where: { id_superlogica_cond: { not: null } },
      });
      // Nenhum condomínio ativado: nem chega a falar com o ERP.
      if (vinculados === 0) return;

      await this.sincronizarTodos();
    } catch (err: any) {
      this.logger.error(`Tick de sincronização Superlógica falhou: ${err?.message ?? err}`);
    } finally {
      this.syncRodando = false;
    }
  }
}
