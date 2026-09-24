import { Logger, UnauthorizedException } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentVersionService, compararVersoesAgente } from './agent-version.service';

/**
 * Auto-atualização (tarefa 8):
 *  - AgentVersionService resolve a última versão publicada (override por env,
 *    senão o último release do GitHub) com cache de 10 min; qualquer falha
 *    devolve { versao: null } em vez de lançar — o agente confia cegamente
 *    no sha256 daqui para decidir se troca o próprio executável, então "não
 *    sei" é o único resultado seguro para um erro.
 *  - GET facial/agent/condo/:token/versao (AgentController) expõe isso ao
 *    agente, token validado como as outras rotas condo/*.
 *
 * `fetch` é sempre mockado — nenhum teste aqui toca a rede real nem o
 * GitHub de verdade.
 */
describe('compararVersoesAgente()', () => {
  it('mesma versão é 0', () => {
    expect(compararVersoesAgente('2026.09.24', '2026.09.24')).toBe(0);
  });

  it('segmento faltando conta como 0', () => {
    expect(compararVersoesAgente('2026.09.24', '2026.09.24.0')).toBe(0);
  });

  it('compara numericamente (10 > 9), não como string', () => {
    expect(compararVersoesAgente('2026.09.10', '2026.09.9')).toBeGreaterThan(0);
  });

  it('mais velha é negativa', () => {
    expect(compararVersoesAgente('2026.09.20', '2026.09.24')).toBeLessThan(0);
  });
});

describe('AgentVersionService.getLatest()', () => {
  const envOriginais = {
    AGENT_LATEST_VERSION: process.env['AGENT_LATEST_VERSION'],
    AGENT_DOWNLOAD_URL: process.env['AGENT_DOWNLOAD_URL'],
    AGENT_SHA256: process.env['AGENT_SHA256'],
  };

  beforeEach(() => {
    // Os testes de caminho de falha (tag inválida, sem assets, GitHub fora
    // do ar) disparam `Logger.warn` de propósito — silencia pra não sujar o
    // output do jest com WARN esperado.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined as any);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envOriginais)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    jest.restoreAllMocks();
    delete (global as any).fetch;
  });

  it('as três envs presentes: usa o override, não chama fetch', async () => {
    process.env['AGENT_LATEST_VERSION'] = '2026.09.30';
    process.env['AGENT_DOWNLOAD_URL'] = 'https://exemplo.com/click-agent.exe';
    process.env['AGENT_SHA256'] = 'a'.repeat(64);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new AgentVersionService();
    const info = await service.getLatest();

    expect(info).toEqual({
      versao: '2026.09.30',
      url: 'https://exemplo.com/click-agent.exe',
      sha256: 'a'.repeat(64),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('só uma ou duas das três envs presentes: NÃO usa override parcial, cai pro GitHub', async () => {
    process.env['AGENT_LATEST_VERSION'] = '2026.09.30';
    // AGENT_DOWNLOAD_URL e AGENT_SHA256 ausentes.
    const fetchMock = jest.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) {
        return respostaReleases([
          releaseFake({
            tag_name: 'agent-v2026.09.28',
            assets: [
              { name: 'click-agent.exe', browser_download_url: 'https://gh/click-agent.exe' },
              { name: 'click-agent.exe.sha256', browser_download_url: 'https://gh/click-agent.exe.sha256' },
            ],
          }),
        ]);
      }
      return respostaTexto('b'.repeat(64) + '  click-agent.exe\n');
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new AgentVersionService();
    const info = await service.getLatest();

    expect(info.versao).toBe('2026.09.28'); // veio do GitHub, não da env parcial
    expect(fetchMock).toHaveBeenCalled();
  });

  it('GitHub: monta { versao, url, sha256 } a partir da tag e dos dois assets do release mais novo com tag agent-v*', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) {
        return respostaReleases([
          releaseFake({
            tag_name: 'agent-v2026.09.25',
            assets: [
              { name: 'click-agent.exe', browser_download_url: 'https://gh/download/click-agent.exe' },
              { name: 'click-agent.exe.sha256', browser_download_url: 'https://gh/download/click-agent.exe.sha256' },
            ],
          }),
        ]);
      }
      return respostaTexto('C'.repeat(64)); // maiúsculo — o consumo é case-insensitive
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new AgentVersionService();
    const info = await service.getLatest();

    expect(info).toEqual({
      versao: '2026.09.25',
      url: 'https://gh/download/click-agent.exe',
      sha256: 'C'.repeat(64),
    });
  });

  it('pula releases que não são do agente (tag sem prefixo agent-v) até achar um que é', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) {
        return respostaReleases([
          releaseFake({ tag_name: 'portaria-web-v3.0.0', assets: [] }), // outro produto do mesmo repo
          releaseFake({
            tag_name: 'agent-v2026.09.20',
            assets: [
              { name: 'click-agent.exe', browser_download_url: 'https://gh/click-agent.exe' },
              { name: 'click-agent.exe.sha256', browser_download_url: 'https://gh/click-agent.exe.sha256' },
            ],
          }),
        ]);
      }
      return respostaTexto('9'.repeat(64));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const info = await new AgentVersionService().getLatest();
    expect(info.versao).toBe('2026.09.20');
  });

  it('pula draft e pre-release mesmo com tag agent-v*', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) {
        return respostaReleases([
          releaseFake({ tag_name: 'agent-v2026.09.30', draft: true, assets: [] }),
          releaseFake({ tag_name: 'agent-v2026.09.29', prerelease: true, assets: [] }),
          releaseFake({
            tag_name: 'agent-v2026.09.25',
            assets: [
              { name: 'click-agent.exe', browser_download_url: 'https://gh/click-agent.exe' },
              { name: 'click-agent.exe.sha256', browser_download_url: 'https://gh/click-agent.exe.sha256' },
            ],
          }),
        ]);
      }
      return respostaTexto('8'.repeat(64));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const info = await new AgentVersionService().getLatest();
    expect(info.versao).toBe('2026.09.25');
  });

  it('sha256 extrai só o primeiro token hex de 64 (formato "sha256sum": "<hash>  <arquivo>")', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) {
        return respostaReleases([
          releaseFake({
            tag_name: 'agent-v2026.09.25',
            assets: [
              { name: 'click-agent.exe', browser_download_url: 'https://gh/click-agent.exe' },
              { name: 'click-agent.exe.sha256', browser_download_url: 'https://gh/click-agent.exe.sha256' },
            ],
          }),
        ]);
      }
      return respostaTexto(`${'d'.repeat(64)}  click-agent.exe\n`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const info = await new AgentVersionService().getLatest();
    expect(info.sha256).toBe('d'.repeat(64));
  });

  it('nenhum release com tag agent-v*: devolve versao null', async () => {
    const fetchMock = jest.fn(async () => respostaReleases([releaseFake({ tag_name: 'v2026.09.25', assets: [] })]));
    global.fetch = fetchMock as unknown as typeof fetch;

    const info = await new AgentVersionService().getLatest();
    expect(info).toEqual({ versao: null, url: null, sha256: null });
  });

  it('release sem os assets esperados: devolve versao null', async () => {
    const fetchMock = jest.fn(async () =>
      respostaReleases([releaseFake({ tag_name: 'agent-v2026.09.25', assets: [{ name: 'outro-arquivo.txt' }] })]),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const info = await new AgentVersionService().getLatest();
    expect(info).toEqual({ versao: null, url: null, sha256: null });
  });

  it('GitHub inalcançável (fetch rejeita): devolve versao null, não lança', async () => {
    const fetchMock = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(new AgentVersionService().getLatest()).resolves.toEqual({
      versao: null,
      url: null,
      sha256: null,
    });
  });

  it('HTTP não-2xx da API do GitHub: devolve versao null', async () => {
    const fetchMock = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const info = await new AgentVersionService().getLatest();
    expect(info).toEqual({ versao: null, url: null, sha256: null });
  });

  it('cache de 10 min: duas chamadas seguidas só consultam o GitHub uma vez', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) {
        return respostaReleases([
          releaseFake({
            tag_name: 'agent-v2026.09.25',
            assets: [
              { name: 'click-agent.exe', browser_download_url: 'https://gh/click-agent.exe' },
              { name: 'click-agent.exe.sha256', browser_download_url: 'https://gh/click-agent.exe.sha256' },
            ],
          }),
        ]);
      }
      return respostaTexto('e'.repeat(64));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new AgentVersionService();
    await service.getLatest();
    await service.getLatest();

    // 2 fetches na 1ª chamada (release + .sha256), nenhum a mais na 2ª.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cache expirado (>10 min): consulta o GitHub de novo', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) {
        return respostaReleases([
          releaseFake({
            tag_name: 'agent-v2026.09.25',
            assets: [
              { name: 'click-agent.exe', browser_download_url: 'https://gh/click-agent.exe' },
              { name: 'click-agent.exe.sha256', browser_download_url: 'https://gh/click-agent.exe.sha256' },
            ],
          }),
        ]);
      }
      return respostaTexto('f'.repeat(64));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new AgentVersionService();
    await service.getLatest();
    // Força o cache a parecer velho, sem depender de timers de verdade.
    (service as any).cache.em = Date.now() - 11 * 60 * 1000;
    await service.getLatest();

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

function releaseFake(over: {
  tag_name: string;
  assets: { name: string; browser_download_url?: string }[];
  draft?: boolean;
  prerelease?: boolean;
}) {
  return { draft: false, prerelease: false, ...over };
}
function respostaReleases(releases: unknown[]) {
  return { ok: true, status: 200, json: async () => releases, text: async () => JSON.stringify(releases) };
}
function respostaTexto(texto: string) {
  return { ok: true, status: 200, text: async () => texto, json: async () => ({}) };
}

describe('GET facial/agent/condo/:token/versao', () => {
  it('token inválido: recusa como as outras rotas condo/*', async () => {
    const service: any = {
      resolveCondominioForAgent: jest.fn(async () => {
        throw new UnauthorizedException('Token do agente inválido');
      }),
    };
    const agentVersion: any = { getLatest: jest.fn() };
    const ctrl = new AgentController(service, {} as any, agentVersion);
    await expect(ctrl.condoVersao('token-invalido')).rejects.toThrow(UnauthorizedException);
    expect(agentVersion.getLatest).not.toHaveBeenCalled();
  });

  it('token válido: devolve o que o AgentVersionService resolver', async () => {
    const service: any = { resolveCondominioForAgent: jest.fn(async () => 7) };
    const info = { versao: '2026.09.25', url: 'https://gh/click-agent.exe', sha256: 'a'.repeat(64) };
    const agentVersion: any = { getLatest: jest.fn(async () => info) };
    const ctrl = new AgentController(service, {} as any, agentVersion);

    const res = await ctrl.condoVersao('token-ok');

    expect(res).toEqual(info);
  });

  it('nada publicado / falha: devolve { versao: null, url: null, sha256: null }', async () => {
    const service: any = { resolveCondominioForAgent: jest.fn(async () => 7) };
    const agentVersion: any = {
      getLatest: jest.fn(async () => ({ versao: null, url: null, sha256: null })),
    };
    const ctrl = new AgentController(service, {} as any, agentVersion);

    const res = await ctrl.condoVersao('token-ok');

    expect(res).toEqual({ versao: null, url: null, sha256: null });
  });
});
