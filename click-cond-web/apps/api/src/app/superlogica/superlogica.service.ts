import { Injectable, Logger } from '@nestjs/common';
import { SuperlogicaClient } from './superlogica.client';
import {
  STATUS_PAGO,
  SuperlogicaCobranca,
  SuperlogicaCondominio,
  SuperlogicaUnidade,
} from './superlogica.types';

/**
 * Leitura da Superlógica e tradução para o modelo do Clique.
 *
 * Nenhum método escreve no ERP. Os métodos daqui também não escrevem no banco
 * do Clique — quem persiste é o serviço de sincronização (ainda não escrito).
 */
@Injectable()
export class SuperlogicaService {
  private readonly logger = new Logger(SuperlogicaService.name);

  constructor(private readonly client: SuperlogicaClient) {}

  /**
   * Condomínios ativos da carteira. Alimenta a tela de ativação do CRM: é a
   * lista de onde o operador escolhe qual condomínio acabou de fechar contrato.
   */
  async listarCondominios(): Promise<SuperlogicaCondominio[]> {
    return this.client.getPaginado<SuperlogicaCondominio>('condominios/get', {
      id: -1,
      somenteCondominiosAtivos: 1,
      ignorarCondominioModelo: 1,
      apenasColunasPrincipais: 1,
    });
  }

  /**
   * Unidades de um condomínio, com os contatos de cada uma.
   *
   * Usado uma vez, na ativação, para popular Apartamentos já com o
   * id_superlogica_uni — é o que dispensa casar unidade por texto depois.
   */
  async listarUnidades(idCondominioSuperlogica: number): Promise<SuperlogicaUnidade[]> {
    const brutas = await this.client.getPaginado<SuperlogicaUnidade>('unidades/index', {
      idCondominio: idCondominioSuperlogica,
      exibirDadosDosContatos: 1,
      exibirGruposDasUnidades: 1,
    });

    return SuperlogicaService.consolidarUnidades(brutas);
  }

  /**
   * Junta as linhas repetidas da mesma unidade numa só.
   *
   * O ERP devolve a MESMA unidade em mais de uma linha quando ela tem mais de
   * um contato — tipicamente uma linha com `contatos: []` e outra com a lista
   * cheia. Observado em produção no condomínio de teste, depois que a unidade
   * 05 passou a ter dois contatos.
   *
   * Sem consolidar, quem pega a primeira linha que casa pode receber a versão
   * vazia. Nos dois consumidores isso é grave: a importação trataria a segunda
   * linha como unidade duplicada e pularia os contatos, e o envio de morador
   * montaria o payload sem os contatos existentes — que é justamente o que
   * poderia apagá-los da unidade.
   */
  static consolidarUnidades(brutas: SuperlogicaUnidade[]): SuperlogicaUnidade[] {
    const porId = new Map<string, SuperlogicaUnidade>();

    for (const u of brutas) {
      const chave = String(u.id_unidade_uni);
      const acumulada = porId.get(chave);

      if (!acumulada) {
        porId.set(chave, { ...u, contatos: [...(u.contatos ?? [])] });
        continue;
      }

      // Mesma unidade: acumula contatos sem repetir por id.
      const vistos = new Set((acumulada.contatos ?? []).map((c) => String(c.id_contato_con)));
      for (const c of u.contatos ?? []) {
        if (vistos.has(String(c.id_contato_con))) continue;
        vistos.add(String(c.id_contato_con));
        acumulada.contatos = [...(acumulada.contatos ?? []), c];
      }
    }

    return [...porId.values()];
  }

  /**
   * Cobranças de um condomínio num período.
   *
   * `status=validos` traz pendentes e pagas, excluindo canceladas e
   * invalidadas — que não devem aparecer para o morador.
   */
  async listarCobrancas(
    idCondominioSuperlogica: number,
    inicio: Date,
    fim: Date,
  ): Promise<SuperlogicaCobranca[]> {
    return this.client.getPaginado<SuperlogicaCobranca>('cobranca/index', {
      idCondominio: idCondominioSuperlogica,
      status: 'validos',
      apenasColunasPrincipais: 1,
      comDadosDasUnidades: 1,
      dtInicio: SuperlogicaClient.formatarData(inicio),
      dtFim: SuperlogicaClient.formatarData(fim),
    });
  }

  /**
   * Nome do lançamento no padrão que o Financeiro do Clique sabe ler.
   *
   * ATENÇÃO: o Clique casa cobrança com morador PARSEANDO este texto
   * (`nomeFaturaDeApto` em financeiro.service.ts). O formato não é cosmético —
   * fugir dele faz a cobrança não aparecer para ninguém ou, pior, aparecer para
   * o morador errado. Já houve vazamento entre apartamentos por causa disso.
   *
   * Recebe apto e bloco do APARTAMENTO DO CLIQUE, não os da Superlógica: os do
   * ERP vêm com zeros à esquerda ("000101") e não bateriam com o cadastro.
   */
  static montarNomeLancamento(apto: string, bloco: string | null | undefined, vencimento: Date): string {
    const mes = String(vencimento.getMonth() + 1).padStart(2, '0');
    const ref = `Ref. ${mes}/${vencimento.getFullYear()}`;
    const blocoNorm = bloco?.trim() ?? '';

    return blocoNorm
      ? `Apto ${apto.trim()} Bloco ${blocoNorm} - ${ref}`
      : `Apto ${apto.trim()} - ${ref}`;
  }

  /**
   * Traduz uma cobrança do ERP para o formato de `Financeiro`.
   *
   * `apto`/`bloco` vêm do Apartamentos já vinculado por id_superlogica_uni.
   * Devolve null se a cobrança não tiver vencimento — sem ele o lançamento é
   * inútil no app e quebraria a tela do morador.
   */
  mapearCobranca(
    cobranca: SuperlogicaCobranca,
    idCondominioClique: number,
    apto: string,
    bloco: string | null | undefined,
  ) {
    const vencimento = SuperlogicaClient.parsearData(cobranca.dt_vencimento_recb);
    if (!vencimento) {
      this.logger.warn(`Cobrança ${cobranca.id_recebimento_recb} sem vencimento válido — ignorada.`);
      return null;
    }

    // Unidade sem identificação ou só de zeros ("0000") é a unidade fantasma
    // que o ERP usa para lançamento do próprio condomínio. Gerar nome a partir
    // dela produziria "Apto  - Ref..." — texto que o casamento por regex do
    // Financeiro pode encaixar em mais de um morador.
    const aptoNorm = (apto ?? '').trim();
    if (!aptoNorm || /^0+$/.test(aptoNorm)) {
      this.logger.warn(`Cobrança ${cobranca.id_recebimento_recb} sem unidade identificável — ignorada.`);
      return null;
    }

    const valor = Number(cobranca.vl_total_recb);
    if (!Number.isFinite(valor)) {
      this.logger.warn(`Cobrança ${cobranca.id_recebimento_recb} com valor inválido ("${cobranca.vl_total_recb}") — ignorada.`);
      return null;
    }

    const pago = cobranca.fl_status_recb === STATUS_PAGO;
    const liquidacao = SuperlogicaClient.parsearData(cobranca.dt_liquidacao_recb);

    return {
      origem: 'superlogica',
      id_externo: String(cobranca.id_recebimento_recb),
      id_condominio: idCondominioClique,
      nome: SuperlogicaService.montarNomeLancamento(aptoNorm, bloco, vencimento),
      // 'C' = cobrança do condomínio (contraposto a 'D', conta pessoal do
      // morador). Define de quem é o lançamento na tela do app.
      tipo: 'C',
      categoria: 'Taxa Condominial',
      valor,
      data_vencimento: vencimento,
      // `data` é a data do pagamento; fica no vencimento enquanto pendente.
      data: liquidacao ?? vencimento,
      pago: pago ? 1 : 0,
      status: pago ? 'pago' : 'pendente',
      descricao: cobranca.st_documento_recb || null,
      linha_digitavel: (cobranca as any).st_linhadigitavel_recb || null,
      pix_copia_cola: cobranca.st_pixqrcode_recb || null,
      url_boleto: cobranca.link_segundavia || null,
      forma_pagamento: 'Boleto',
      nome_operador: 'Superlógica',
    };
  }

  /**
   * Extrai a linha digitável do boleto a partir da URL da 2ª via pública
   * da Superlógica (acessando a versão MiniHtml sem interação).
   */
  static async extrairLinhaDigitavel(urlSegundaVia?: string | null): Promise<string | null> {
    if (!urlSegundaVia || typeof urlSegundaVia !== 'string') return null;
    const miniUrl = urlSegundaVia.replace('-FaturaHtml-flSegundaVia', '-MiniHtml-flSegundaVia');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(miniUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const html = await res.text();
      const m = html.match(/[?&]l=([0-9.\s]+)(?:&|$)/);
      if (m && m[1]) {
        return decodeURIComponent(m[1]).trim();
      }
      const m2 = html.match(/\d{5}\.\d{5}\s+\d{5}\.\d{6}\s+\d{5}\.\d{6}\s+\d\s+\d{14}/);
      if (m2) return m2[0].trim();
    } catch {
      return null;
    }
    return null;
  }
}
