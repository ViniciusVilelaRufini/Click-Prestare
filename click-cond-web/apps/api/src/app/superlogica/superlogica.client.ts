import { Injectable, Logger } from '@nestjs/common';

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
 * Rotas que a integração pode chamar. Allowlist, não blocklist: qualquer coisa
 * fora desta lista é recusada, então esquecer de proibir algo não abre brecha.
 */
const ROTAS_PERMITIDAS = new Set([
  'condominios/get',
  'unidades/index',
  'cobranca/index',
]);

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
   */
  static formatarData(data: Date): string {
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${mes}/${dia}/${data.getFullYear()}`;
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

  private validarRota(rota: string): string {
    const normalizada = rota.trim().toLowerCase().replace(/^\/+|\/+$/g, '');

    const proibida = ROTAS_PROIBIDAS.find((p) => normalizada.includes(p));
    if (proibida) {
      throw new SuperlogicaRotaBloqueadaError(rota, `contém "${proibida}" (escrita ou envio a terceiros)`);
    }

    if (!ROTAS_PERMITIDAS.has(normalizada)) {
      throw new SuperlogicaRotaBloqueadaError(rota, 'fora da allowlist de leitura');
    }

    return normalizada;
  }

  /**
   * GET numa rota da allowlist. Único método de rede da classe.
   */
  async get<T>(rota: string, params: Record<string, string | number> = {}): Promise<T[]> {
    const rotaValida = this.validarRota(rota);

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
      if (Array.isArray(dados)) return dados as T[];
      if (Array.isArray(dados?.data)) return dados.data as T[];
      return [];
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
    const acumulado: T[] = [];

    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const lote = await this.get<T>(rota, {
        ...params,
        itensPorPagina: MAX_ITENS_POR_PAGINA,
        pagina,
      });

      acumulado.push(...lote);

      if (lote.length < MAX_ITENS_POR_PAGINA) return acumulado;
    }

    this.logger.warn(`Paginação de ${rota} atingiu o teto de ${MAX_PAGINAS} páginas — resultado pode estar truncado.`);
    return acumulado;
  }
}
