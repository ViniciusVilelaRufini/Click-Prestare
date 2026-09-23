import { FacialController } from './facial.controller';

/**
 * O instalador/.env do Agente Local gravava o API_URL a partir dos cabeçalhos
 * da requisição que baixou o arquivo. Pela portaria-web (Amplify) eles chegam
 * como proto "http" e host "www.clickprestarecondominios.com.br", e o agente
 * era instalado apontando para http://www... — que responde 301 para HTTPS.
 * O agente não segue redirecionamento: nunca falava com a nuvem, sem erro.
 */
describe('FacialController.agentConfig — API_URL gravado no instalador', () => {
  const envOriginal = process.env['PUBLIC_API_URL'];
  afterEach(() => {
    if (envOriginal === undefined) delete process.env['PUBLIC_API_URL'];
    else process.env['PUBLIC_API_URL'] = envOriginal;
  });

  async function baixar(format?: string) {
    const service = {
      getAgentConfigFile: jest.fn(async () => ({ filename: 'x', content: 'x', contentType: 'text/plain' })),
    };
    const controller = new FacialController(service as any);
    const req = {
      protocol: 'http',
      headers: {
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'www.clickprestarecondominios.com.br',
        host: 'www.clickprestarecondominios.com.br',
      },
    };
    const res = { setHeader: jest.fn(), send: jest.fn() };
    const operador = { sub: 1, nome: 'QA_SECURITY_20260923', id_condominio: 7 };
    await controller.agentConfig(7, operador as any, req as any, res as any, format);
    return service.getAgentConfigFile.mock.calls[0][1];
  }

  it.each([['env'], ['bat']])('formato %s usa o domínio HTTPS da API, não os cabeçalhos', async (format) => {
    delete process.env['PUBLIC_API_URL'];
    await expect(baixar(format)).resolves.toBe('https://api.clickprestarecondominios.com.br');
  });

  it('PUBLIC_API_URL continua mandando quando definido', async () => {
    process.env['PUBLIC_API_URL'] = 'https://api-homolog.example.invalid';
    await expect(baixar('env')).resolves.toBe('https://api-homolog.example.invalid');
  });
});
