import { Injectable, Logger } from '@nestjs/common';

/**
 * Última versão publicada do Agente Local (tarefa 8 — auto-atualização).
 *
 * Fonte: as envs `AGENT_LATEST_VERSION` / `AGENT_DOWNLOAD_URL` / `AGENT_SHA256`
 * quando as TRÊS estão presentes (override manual, ex.: para publicar uma
 * versão fora do fluxo normal do GitHub); senão o release mais recente do
 * GitHub cuja tag comece com `agent-v` (`GET /repos/.../releases` — NÃO
 * `/releases/latest`, que é o mais recente do repositório inteiro,
 * independente do prefixo da tag; o mesmo repo hospeda outros releases que
 * não são do agente), ignorando rascunho/pre-release, assets
 * `click-agent.exe` + `click-agent.exe.sha256`.
 *
 * O agente confia cegamente neste SHA-256 para decidir se troca o próprio
 * executável (ver agent/src/core/atualizador.js) — por isso qualquer falha
 * aqui (rede, release sem os assets esperados, tag num formato inesperado)
 * devolve `{ versao: null, url: null, sha256: null }` em vez de um valor
 * parcial ou desatualizado: "não sei" é seguro, um hash errado não é.
 */
export interface AgentVersaoInfo {
  versao: string | null;
  url: string | null;
  sha256: string | null;
}

const SEM_VERSAO: AgentVersaoInfo = { versao: null, url: null, sha256: null };

const CACHE_MS = 10 * 60 * 1000;
// Lista (não /releases/latest — ver comentário da classe), páginas de 20 são
// mais que suficientes: um release novo do agente aparece bem antes disso.
const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/Viniciusvile/Click-Prestare/releases?per_page=20';
const NOME_ASSET_EXE = 'click-agent.exe';
const NOME_ASSET_SHA256 = 'click-agent.exe.sha256';
// Timeout curto nas chamadas ao GitHub: isto roda no caminho de
// GET facial/agent/saude (chamado pelo portal) e GET .../versao (chamado
// pelo agente) — uma API do GitHub lenta/travada não pode arrastar essas
// respostas junto.
const FETCH_TIMEOUT_MS = 5000;

/**
 * Compara duas versões `AAAA.MM.DD[.N]` numericamente, segmento a segmento
 * (segmento faltando = 0). Mesma regra de agent/src/core/atualizador.js —
 * duplicada de propósito: são runtimes diferentes (API em TS, agente em JS
 * puro sem dependências), não vale a pena compartilhar módulo por uma
 * função de 10 linhas.
 */
export function compararVersoesAgente(a: string, b: string): number {
  const segmentos = (v: string) =>
    String(v || '')
      .split('.')
      .map((n) => Number(n) || 0);
  const sa = segmentos(a);
  const sb = segmentos(b);
  const tamanho = Math.max(sa.length, sb.length);
  for (let i = 0; i < tamanho; i++) {
    const diff = (sa[i] || 0) - (sb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

@Injectable()
export class AgentVersionService {
  private readonly logger = new Logger(AgentVersionService.name);
  private cache: { info: AgentVersaoInfo; em: number } | null = null;

  /** Última versão disponível, com cache de 10 min (o GitHub tem rate-limit
   *  de API sem autenticação, e a versão não muda a cada segundo). */
  async getLatest(): Promise<AgentVersaoInfo> {
    const doEnv = this.fromEnv();
    if (doEnv) return doEnv;

    if (this.cache && Date.now() - this.cache.em < CACHE_MS) {
      return this.cache.info;
    }
    const info = await this.fetchDoGithub();
    this.cache = { info, em: Date.now() };
    return info;
  }

  private fromEnv(): AgentVersaoInfo | null {
    const versao = process.env['AGENT_LATEST_VERSION'];
    const url = process.env['AGENT_DOWNLOAD_URL'];
    const sha256 = process.env['AGENT_SHA256'];
    // Só vale como override se as TRÊS estiverem presentes — uma env solta
    // (ex.: só a versão, esquecendo a URL) não pode virar um "novo download"
    // sem destino.
    if (versao && url && sha256) return { versao, url, sha256 };
    return null;
  }

  private async fetchDoGithub(): Promise<AgentVersaoInfo> {
    try {
      const res = await fetch(GITHUB_RELEASES_URL, {
        headers: {
          // A API do GitHub recusa requisições sem User-Agent.
          'User-Agent': 'click-prestare-agent-updater',
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`GitHub releases respondeu HTTP ${res.status}`);
      const releases = (await res.json()) as {
        tag_name?: string;
        draft?: boolean;
        prerelease?: boolean;
        assets?: { name?: string; browser_download_url?: string }[];
      }[];
      if (!Array.isArray(releases)) throw new Error('GitHub releases: resposta não é uma lista');

      // O mais recente cuja tag comece com agent-v, pulando rascunho e
      // pre-release — a lista já vem ordenada por data de criação
      // decrescente, então o primeiro que bate é o mais novo.
      const release = releases.find(
        (r) => !r?.draft && !r?.prerelease && typeof r?.tag_name === 'string' && r.tag_name.startsWith('agent-v'),
      );
      if (!release) throw new Error('nenhum release com tag agent-v* encontrado (publicado/não-draft)');

      const tag = release.tag_name || '';
      const versaoMatch = /^agent-v(.+)$/.exec(tag);
      if (!versaoMatch) throw new Error(`tag do release fora do padrão agent-v<versão>: "${tag}"`);
      const versao = versaoMatch[1];

      const assets = Array.isArray(release.assets) ? release.assets : [];
      const assetExe = assets.find((a) => a?.name === NOME_ASSET_EXE);
      const assetSha = assets.find((a) => a?.name === NOME_ASSET_SHA256);
      if (!assetExe?.browser_download_url || !assetSha?.browser_download_url) {
        throw new Error(`release sem os assets esperados (${NOME_ASSET_EXE} / ${NOME_ASSET_SHA256})`);
      }

      const shaRes = await fetch(assetSha.browser_download_url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!shaRes.ok) throw new Error(`download do .sha256 respondeu HTTP ${shaRes.status}`);
      const shaTexto = await shaRes.text();
      const shaMatch = /[0-9a-fA-F]{64}/.exec(shaTexto);
      if (!shaMatch) throw new Error('arquivo .sha256 sem um hash hex de 64 caracteres');

      return { versao, url: assetExe.browser_download_url, sha256: shaMatch[0] };
    } catch (err) {
      this.logger.warn(
        `falha ao consultar a última versão do agente no GitHub: ${(err as Error)?.message || err}`,
      );
      return SEM_VERSAO;
    }
  }
}
