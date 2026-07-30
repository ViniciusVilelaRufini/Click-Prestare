import { MockRelayService } from './mock-relay.service';

/**
 * O simulador de terminal e a botoeira mock são andaimes de teste, e estavam
 * montados em produção:
 *
 *  - `GET /facial/simulator/:token/persons` devolve NOME e FOTO de todos os
 *    moradores e visitantes ativos do condomínio. É `@Public()`, autenticada
 *    só pelo webhook_token do device — token que viaja em URL no webhook e
 *    portanto acaba em log de acesso e de proxy.
 *  - `/facial/sim/relay/:slug/*` não tinha autenticação nenhuma.
 *
 * Agora só são montados com `FACIAL_SIMULATOR_ENABLED=true`.
 */
describe('FacialModule — andaimes de simulação fora de produção', () => {
  const envOriginal = process.env['FACIAL_SIMULATOR_ENABLED'];

  afterEach(() => {
    if (envOriginal === undefined) delete process.env['FACIAL_SIMULATOR_ENABLED'];
    else process.env['FACIAL_SIMULATOR_ENABLED'] = envOriginal;
    jest.resetModules();
  });

  /** O módulo lê a env no import, então cada caso precisa recarregá-lo. */
  async function controllersDoModulo(): Promise<string[]> {
    jest.resetModules();
    const { FacialModule } = await import('./facial.module');
    const lista = Reflect.getMetadata('controllers', FacialModule) ?? [];
    return lista.map((c: any) => c.name);
  }

  it('sem a env, simulador e botoeira mock NÃO são montados', async () => {
    delete process.env['FACIAL_SIMULATOR_ENABLED'];
    const nomes = await controllersDoModulo();
    expect(nomes).not.toContain('FacialSimulatorController');
    expect(nomes).not.toContain('MockRelayController');
  });

  it('com a env em false, seguem fora', async () => {
    process.env['FACIAL_SIMULATOR_ENABLED'] = 'false';
    const nomes = await controllersDoModulo();
    expect(nomes).not.toContain('FacialSimulatorController');
    expect(nomes).not.toContain('MockRelayController');
  });

  it('com a env em true, entram (uso local, sem hardware)', async () => {
    process.env['FACIAL_SIMULATOR_ENABLED'] = 'true';
    const nomes = await controllersDoModulo();
    expect(nomes).toContain('FacialSimulatorController');
    expect(nomes).toContain('MockRelayController');
  });

  it('as rotas reais continuam montadas nos dois casos', async () => {
    delete process.env['FACIAL_SIMULATOR_ENABLED'];
    const nomes = await controllersDoModulo();
    expect(nomes).toContain('FacialController');
    expect(nomes).toContain('FacialWebhookController');
    expect(nomes).toContain('AgentController');
  });
});

/**
 * Os eventos já eram limitados por slug, mas o Map de slugs crescia sem teto —
 * e o slug vem da URL, então é entrada de fora. Chamadas com slugs aleatórios
 * inflavam a memória do processo indefinidamente.
 */
describe('MockRelayService — memória limitada', () => {
  it('descarta o slug mais antigo ao estourar o teto', () => {
    const svc = new MockRelayService();
    for (let i = 0; i < 120; i++) svc.record(`slug-${i}`, { i });

    // O primeiro slug já saiu; o último continua.
    expect(svc.list('slug-0')).toHaveLength(0);
    expect(svc.list('slug-119')).toHaveLength(1);
  });

  it('continua limitando os eventos de um mesmo slug', () => {
    const svc = new MockRelayService();
    for (let i = 0; i < 80; i++) svc.record('porta-entrada', { i });
    expect(svc.list('porta-entrada').length).toBeLessThanOrEqual(50);
  });
});
