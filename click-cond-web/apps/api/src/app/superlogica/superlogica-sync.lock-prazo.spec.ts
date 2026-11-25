jest.mock('../common/lock-distribuido', () => {
  const real = jest.requireActual('../common/lock-distribuido');
  return { ...real, executarComLock: jest.fn(async () => true) };
});

import { executarComLock } from '../common/lock-distribuido';
import { SuperlogicaSyncService } from './superlogica-sync.service';

/**
 * J16 da revisão dos ciclos (jobs): o sync da Superlógica roda a cada 1 h e
 * usava o prazo padrão do lock (1 h). Uma passada longa (a profunda de 12
 * meses, muitos condomínios) devolvia o lock no meio, e o tick seguinte (em
 * outra instância) gravava as mesmas cobranças em paralelo.
 */
describe('Superlógica sync — prazo do lock', () => {
  afterEach(() => jest.useRealTimers());

  it('o lock do sync aguenta 3 h (o padrão de 1 h é o próprio intervalo)', async () => {
    jest.useFakeTimers();
    const svc = new SuperlogicaSyncService({ isConnected: false } as any, {} as any);
    svc.onModuleInit();
    jest.advanceTimersByTime(60 * 60 * 1000);

    const chamadas = (executarComLock as jest.Mock).mock.calls.filter((c) => c[1] === 'superlogica:sync');
    expect(chamadas.length).toBeGreaterThanOrEqual(2); // o primeiro (5 min) e o horário
    for (const c of chamadas) expect(c[3].duracaoMaximaMs).toBeGreaterThanOrEqual(3 * 60 * 60 * 1000);
  });
});
