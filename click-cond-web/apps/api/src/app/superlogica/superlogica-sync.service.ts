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

/**
 * Meses para trás na varredura horária. Cobre o boleto do mês corrente e a
 * virada de mês, que é onde quase toda mudança de status acontece.
 */
const MESES_ATRAS_PADRAO = 1;

/**
 * Meses para trás na varredura profunda.
 *
 * Sem ela, cobrança fora da janela horária NUNCA mais era relida: o morador
 * inadimplente quitava um boleto de três meses atrás, a Superlógica marcava
 * pago, e o Clique seguia mostrando "pendente" para sempre — sem que o síndico
 * pudesse corrigir, já que baixa manual em `origem='superlogica'` é bloqueada.
 * Doze meses cobrem o horizonte de cobrança que a administradora persegue.
 */
const MESES_ATRAS_PROFUNDA = 12;

/**
 * Espaçamento entre varreduras profundas. Uma vez por dia: dívida antiga muda
 * raramente, e varrer 13 meses de todos os condomínios de hora em hora seria
 * dezenas de páginas por prédio sem nada de novo para trazer.
 */
const INTERVALO_PROFUNDA_MS = 24 * 60 * 60 * 1000;

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
  /** Quantos meses para trás esta passada olhou. */
  mesesAtras: number;
  /**
   * Unidades do ERP vinculadas a mais de um apartamento. Cobrança delas não é
   * gravada — seria entregue ao morador errado. Exige correção manual.
   */
  unidadesAmbiguas: number[];
}

@Injectable()
export class SuperlogicaSyncService implements OnModuleInit {
  private readonly logger = new Logger(SuperlogicaSyncService.name);
  private syncRodando = false;

  /**
   * Quando a última varredura profunda rodou. Fica em memória de propósito:
   * o Railway roda uma réplica só, e um restart forçar uma varredura profunda
   * logo no primeiro tick é o comportamento desejado, não um efeito colateral.
   */
  private ultimaProfundaEm: number | null = null;

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

  /** Primeiro dia do mês que abre a janela sincronizada. */
  private inicioJanela(hoje = new Date(), mesesAtras = MESES_ATRAS_PADRAO): Date {
    return new Date(hoje.getFullYear(), hoje.getMonth() - mesesAtras, 1);
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
  async sincronizarCondominio(
    idCondominioClique: number,
    hoje = new Date(),
    opcoes: { profunda?: boolean } = {},
  ): Promise<ResultadoSync> {
    const condominio = await this.condominioVinculado(idCondominioClique);
    const mesesAtras = opcoes.profunda ? MESES_ATRAS_PROFUNDA : MESES_ATRAS_PADRAO;

    const cobrancas = await this.superlogica.listarCobrancas(
      condominio.id_superlogica_cond,
      this.inicioJanela(hoje, mesesAtras),
      this.fimJanela(hoje),
    );

    // Um único SELECT resolve o vínculo de todas as cobranças do lote.
    const apartamentos = await this.prisma.apartamentos.findMany({
      where: { id_condominio: idCondominioClique, id_superlogica_uni: { not: null } },
      select: { id_superlogica_uni: true, apto: true, bloco: true },
    });

    // `new Map(...)` guardava só o último apartamento de cada unidade. Dois
    // apartamentos com o mesmo `id_superlogica_uni` faziam as cobranças caírem
    // em quem viesse por último na consulta — em silêncio, boleto de um morador
    // aparecendo na tela de outro.
    //
    // O índice único `un_apto_superlogica` existiria para impedir isso, mas
    // NÃO está aplicado em produção (ver §6 do INTEGRACAO_SUPERLOGICA.md), e
    // uma proteção que depende de um índice ausente não é proteção. Aqui a
    // ambiguidade é detectada e as duas pontas são descartadas: melhor a
    // cobrança não aparecer para ninguém do que aparecer para o morador errado.
    const porUnidade = new Map<number | null, { apto: string | null; bloco: string | null }>();
    const unidadesAmbiguas = new Set<number>();
    for (const a of apartamentos) {
      const uni = Number(a.id_superlogica_uni);
      if (porUnidade.has(uni)) {
        unidadesAmbiguas.add(uni);
        continue;
      }
      porUnidade.set(uni, a);
    }
    for (const uni of unidadesAmbiguas) {
      porUnidade.delete(uni);
      this.logger.error(
        `Condomínio ${idCondominioClique}: unidade ${uni} da Superlógica está vinculada a mais de um apartamento. ` +
          'As cobranças dela NÃO serão gravadas — corrija o vínculo e aplique o índice un_apto_superlogica.',
      );
    }

    // O que já está gravado deste condomínio. Serve a duas coisas que o upsert
    // sozinho não sabe fazer: preservar o status de comprovante em auditoria e
    // não perder a linha digitável já extraída.
    const jaGravados = await this.prisma.financeiro.findMany({
      where: { id_condominio: idCondominioClique, origem: 'superlogica' },
      select: { id_externo: true, status: true, linha_digitavel: true },
    });
    const porExterno = new Map(jaGravados.map((f) => [f.id_externo, f]));

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

      const existente = porExterno.get(dados.id_externo);

      // A linha digitável não vem na listagem do ERP: é raspada do HTML da 2ª
      // via, um fetch por cobrança. Reaproveitar a que já está gravada evita
      // repetir isso a cada passada — e, sobretudo, evita que uma raspagem que
      // falhou sobrescreva com null a linha que já funcionava.
      if (!dados.linha_digitavel) {
        dados.linha_digitavel = existente?.linha_digitavel ?? null;
      }
      // Boleto já pago não precisa de linha digitável: ninguém vai pagar de
      // novo. Sem esse corte, a varredura profunda dispararia um fetch para
      // cada cobrança de doze meses, uma a uma.
      if (!dados.linha_digitavel && dados.url_boleto && !dados.pago) {
        dados.linha_digitavel = await SuperlogicaService.extrairLinhaDigitavel(dados.url_boleto);
      }

      // O morador anexa o comprovante e o lançamento vai para status '2'
      // (aguardando auditoria do síndico). O sync sobrescrevia isso com
      // 'pendente' no tick seguinte, e o síndico perdia o aviso de que havia
      // comprovante para conferir — o arquivo ficava, o sinal sumia.
      //
      // Quando o ERP confirma o pagamento, aí sim 'pago' vence: a auditoria
      // perdeu o objeto.
      if (!dados.pago && existente?.status === '2') {
        dados.status = '2';
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
          linha_digitavel: dados.linha_digitavel,
          pix_copia_cola: dados.pix_copia_cola,
          url_boleto: dados.url_boleto,
        },
      });
      gravados++;
    }

    this.logger.log(
      `Sync do condomínio ${idCondominioClique} (${mesesAtras}m atrás): ${gravados} lançamento(s), ${semApartamento} sem apartamento, ${descartadas} descartada(s).`,
    );

    return {
      cobrancasLidas: cobrancas.length,
      lancamentosGravados: gravados,
      semApartamento,
      descartadas,
      mesesAtras,
      unidadesAmbiguas: [...unidadesAmbiguas],
    };
  }

  /** Sincroniza todos os condomínios vinculados. Usado pelo tick horário. */
  async sincronizarTodos(opcoes: { profunda?: boolean } = {}): Promise<Record<number, ResultadoSync | string>> {
    const vinculados = await this.prisma.condominios.findMany({
      where: { id_superlogica_cond: { not: null } },
      select: { id: true, nome: true },
    });

    const resultado: Record<number, ResultadoSync | string> = {};

    for (const c of vinculados) {
      try {
        resultado[c.id] = await this.sincronizarCondominio(c.id, new Date(), opcoes);
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

      // Uma vez por dia a passada olha doze meses para trás, para pegar baixa
      // em cobrança antiga que a janela horária não alcança.
      const agora = Date.now();
      const profunda =
        this.ultimaProfundaEm === null || agora - this.ultimaProfundaEm >= INTERVALO_PROFUNDA_MS;

      await this.sincronizarTodos({ profunda });

      // Só marca depois de concluir: falha no meio deixa a próxima passada
      // tentar de novo em vez de esperar mais 24h.
      if (profunda) this.ultimaProfundaEm = agora;
    } catch (err: any) {
      this.logger.error(`Tick de sincronização Superlógica falhou: ${err?.message ?? err}`);
    } finally {
      this.syncRodando = false;
    }
  }
}
