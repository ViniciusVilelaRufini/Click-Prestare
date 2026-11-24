import { Injectable, Logger } from '@nestjs/common';
import { limiteExterno } from '../common/limitar-concorrencia';
import { hojeBrasilia } from '../common/hora-brasilia.util';

/** Bulkhead da Superlógica (máx. 4 em voo por instância — ver LIMITES_EXTERNOS). */
const limitarSuperlogica = limiteExterno('superlogica');

/**
 * Cliente HTTP da API Superlógica Condomínios.
 *
 * SOMENTE LEITURA — por decisão de projeto, e não por convenção. O ERP é a
 * operação financeira real da Prestare: um POST equivocado altera boleto de
 * cliente de verdade. Ver INTEGRACAO_SUPERLOGICA.md.
 *
 * A classe não expõe nenhum método de escrita, e `get()` ainda valida a rota
 * contra uma allowlist antes de sair da máquina.
 */

/**
 * Rotas de LEITURA que a integração pode chamar. Allowlist, não blocklist:
 * qualquer coisa fora desta lista é recusada, então esquecer de proibir algo
 * não abre brecha.
 */
const ROTAS_PERMITIDAS = new Set([
  'condominios/get',
  'unidades/index',
  'cobranca/index',
]);

/**
 * Rotas de ESCRITA. Allowlist separada e propositalmente mínima: uma rota, a
 * que cadastra condômino numa unidade.
 *
 * Escrita aqui altera o cadastro real da administradora. Esta lista não deve
 * crescer sem uma decisão explícita — em especial, nada que mexa em cobrança
 * (liquidar, estornar, excluir) tem lugar nela, e a blocklist abaixo continua
 * valendo por cima.
 */
const ROTAS_ESCRITA_PERMITIDAS = new Set(['unidades/post']);

/**
 * Rotas explicitamente proibidas, mesmo que alguém as adicione à allowlist por
 * engano no futuro. Não é redundância inútil — a primeira delas é um GET que
 * DISPARA E-MAIL REAL de cobrança para o morador. Uma trava "só GET" não pega
 * esse caso, e chamá-la em desenvolvimento manda e-mail para gente de verdade.
 */
const ROTAS_PROIBIDAS = [
  'emailcobrancasemaberto',
  'notificarcomunicado',
  'liquidar',
  'estornar',
  'excluir',
  'desinvalidar',
  'desfazer',
  'imprimircarta',
];

/** Teto da API: acima disso responde 400. */
const MAX_ITENS_POR_PAGINA = 50;

/** Trava de segurança da paginação — evita laço infinito se a API repetir página. */
const MAX_PAGINAS = 200;

export class SuperlogicaConfigError extends Error {}

export class SuperlogicaHttpError extends Error {
  constructor(readonly status: number, readonly corpo: string) {
    super(`Superlógica respondeu ${status}: ${corpo}`);
  }
}

export class SuperlogicaRotaBloqueadaError extends Error {
  constructor(rota: string, motivo: string) {
    super(`Rota "${rota}" bloqueada: ${motivo}`);
  }
}

@Injectable()
export class SuperlogicaClient {
  private readonly logger = new Logger(SuperlogicaClient.name);
  private readonly baseUrl = 'https://api.superlogica.net/v2/condor';

  /**
   * Converte Date para o formato da Superlógica: MM/DD/AAAA.
   *
   * O ERP é americano. Mandar 01/02/2026 querendo 1º de fevereiro devolve
   * janeiro, silenciosamente — o filtro de período traz o mês errado sem erro
   * nenhum. Sempre usar este helper.
   *
   * O dia é o de Brasília: o servidor roda em UTC, e com `getDate()` o
   * contato cadastrado entre 21:00 e 23:59 ia ao ERP com DT_ENTRADA_RES do dia
   * seguinte.
   */
  static formatarData(data: Date): string {
    const dia = hojeBrasilia(data);
    const mes = String(dia.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dia.getUTCDate()).padStart(2, '0');
    return `${mes}/${d}/${dia.getUTCFullYear()}`;
  }

  /**
   * Converte "MM/DD/AAAA HH:mm:ss" (ou só a data) da Superlógica para Date.
   * Devolve null para "" — campo vazio é como o ERP representa ausência.
   */
  static parsearData(valor: string | null | undefined): Date | null {
    if (!valor) return null;
    const m = valor.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    const [, mes, dia, ano] = m;
    const data = new Date(Number(ano), Number(mes) - 1, Number(dia));
    return Number.isNaN(data.getTime()) ? null : data;
  }

  private get appToken(): string {
    const token = process.env.SUPERLOGICA_APP_TOKEN;
    if (!token) throw new SuperlogicaConfigError('SUPERLOGICA_APP_TOKEN ausente.');
    return token;
  }

  private get accessToken(): string {
    const token = process.env.SUPERLOGICA_ACCESS_TOKEN;
    if (!token) throw new SuperlogicaConfigError('SUPERLOGICA_ACCESS_TOKEN ausente.');
    return token;
  }

  /** Diz se as credenciais estão presentes, sem lançar. */
  estaConfigurado(): boolean {
    return Boolean(process.env.SUPERLOGICA_APP_TOKEN && process.env.SUPERLOGICA_ACCESS_TOKEN);
  }

  private validarRota(rota: string, permitidas: Set<string>, contexto: string): string {
    const normalizada = rota.trim().toLowerCase().replace(/^\/+|\/+$/g, '');

    // A blocklist vale para leitura E escrita. `unidades/post` é permitida por
    // estar na allowlist de escrita, mas nada que case com estes termos passa —
    // nem a rota que dispara e-mail real, nem as de baixa/estorno de cobrança.
    const proibida = ROTAS_PROIBIDAS.find((p) => normalizada.includes(p));
    if (proibida) {
      throw new SuperlogicaRotaBloqueadaError(rota, `contém "${proibida}" (operação proibida)`);
    }

    if (!permitidas.has(normalizada)) {
      throw new SuperlogicaRotaBloqueadaError(rota, `fora da allowlist de ${contexto}`);
    }

    return normalizada;
  }

  /**
   * GET numa rota da allowlist. Único método de rede de leitura da classe.
   * Passa pelo bulkhead `superlogica` (LIMITES_EXTERNOS): ERP lento não
   * acumula requisições em voo na instância. O timeout só começa a contar
   * depois que a vaga sai.
   */
  get<T>(rota: string, params: Record<string, string | number> = {}): Promise<T[]> {
    return limitarSuperlogica(() => this.getDireto<T>(rota, params)).then((r) => r.itens);
  }

  /**
   * `reconhecido` diz se o corpo veio no formato de listagem (array ou
   * `{data: [...]}`). Fora disso `itens` é [] — e um [] que não é "a lista
   * está vazia" não pode ser lido como fim da paginação por quem decide algo
   * pela AUSÊNCIA de um registro (ver getPaginadoCompleto).
   */
  private async getDireto<T>(
    rota: string,
    params: Record<string, string | number>,
  ): Promise<{ itens: T[]; reconhecido: boolean }> {
    const rotaValida = this.validarRota(rota, ROTAS_PERMITIDAS, 'leitura');

    const query = new URLSearchParams();
    for (const [chave, valor] of Object.entries(params)) {
      query.set(chave, String(valor));
    }

    const url = `${this.baseUrl}/${rotaValida}?${query.toString()}`;
    const timeoutMs = Number(process.env.SUPERLOGICA_HTTP_TIMEOUT_MS ?? 15000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resposta = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          app_token: this.appToken,
          access_token: this.accessToken,
        },
        signal: controller.signal,
      });

      const texto = await resposta.text();

      if (!resposta.ok) {
        // A API devolve o motivo em {"msg": "..."} — útil no log (ex.: o teto
        // de 50 itens por página).
        this.logger.error(`GET ${rotaValida} → ${resposta.status}: ${texto.slice(0, 300)}`);
        throw new SuperlogicaHttpError(resposta.status, texto.slice(0, 300));
      }

      const dados = JSON.parse(texto);
      // Listagens vêm como array puro; alguns endpoints envelopam em {data}.
      if (Array.isArray(dados)) return { itens: dados as T[], reconhecido: true };
      if (Array.isArray(dados?.data)) return { itens: dados.data as T[], reconhecido: true };
      return { itens: [], reconhecido: false };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * PUT numa rota da allowlist de ESCRITA.
   *
   * Único caminho de escrita da integração. Nome longo de propósito: quem
   * escrever `client.put(...)` sem querer não encontra o método.
   *
   * O corpo vai como `x-www-form-urlencoded` porque é o que a Superlógica
   * espera nos endpoints de gravação — JSON é silenciosamente ignorado.
   */
  putEscritaRestrita<T = unknown>(
    rota: string,
    campos: Record<string, string | number>,
  ): Promise<T> {
    return limitarSuperlogica(() => this.putEscritaRestritaDireto<T>(rota, campos));
  }

  private async putEscritaRestritaDireto<T>(
    rota: string,
    campos: Record<string, string | number>,
  ): Promise<T> {
    const rotaValida = this.validarRota(rota, ROTAS_ESCRITA_PERMITIDAS, 'escrita');

    const corpo = new URLSearchParams();
    for (const [chave, valor] of Object.entries(campos)) {
      corpo.set(chave, String(valor));
    }

    const timeoutMs = Number(process.env.SUPERLOGICA_HTTP_TIMEOUT_MS ?? 15000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resposta = await fetch(`${this.baseUrl}/${rotaValida}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          app_token: this.appToken,
          access_token: this.accessToken,
        },
        body: corpo.toString(),
        signal: controller.signal,
      });

      const texto = await resposta.text();

      if (!resposta.ok) {
        this.logger.error(`PUT ${rotaValida} → ${resposta.status}: ${texto.slice(0, 300)}`);
        throw new SuperlogicaHttpError(resposta.status, texto.slice(0, 300));
      }

      this.logger.log(`PUT ${rotaValida} → 200`);
      return JSON.parse(texto) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Percorre todas as páginas de uma listagem.
   *
   * Para quando a página vem incompleta (menos que o tamanho pedido), que é o
   * sinal de fim — a API não informa total de registros.
   */
  async getPaginado<T>(rota: string, params: Record<string, string | number> = {}): Promise<T[]> {
    return (await this.getPaginadoCompleto<T>(rota, params)).itens;
  }

  /**
   * Como `getPaginado`, dizendo também se a leitura foi COMPLETA: a paginação
   * chegou ao fim (página incompleta) sem bater no teto de páginas e sem
   * nenhuma página em formato desconhecido. Erro HTTP ou de rede lança, como
   * em `get`.
   *
   * Quem conclui algo pela ausência de um registro (a cobrança que sumiu do
   * ERP) só pode concluir com `completo === true`: numa leitura truncada, o
   * que "não veio" pode simplesmente estar na página que não foi lida.
   */
  async getPaginadoCompleto<T>(
    rota: string,
    params: Record<string, string | number> = {},
  ): Promise<{ itens: T[]; completo: boolean }> {
    const acumulado: T[] = [];

    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const { itens: lote, reconhecido } = await limitarSuperlogica(() =>
        this.getDireto<T>(rota, {
          ...params,
          itensPorPagina: MAX_ITENS_POR_PAGINA,
          pagina,
        }),
      );

      acumulado.push(...lote);

      if (!reconhecido) {
        this.logger.warn(`Página ${pagina} de ${rota} veio em formato desconhecido — leitura tratada como incompleta.`);
        return { itens: acumulado, completo: false };
      }

      if (lote.length < MAX_ITENS_POR_PAGINA) return { itens: acumulado, completo: true };
    }

    this.logger.warn(`Paginação de ${rota} atingiu o teto de ${MAX_PAGINAS} páginas — resultado pode estar truncado.`);
    return { itens: acumulado, completo: false };
  }
}
