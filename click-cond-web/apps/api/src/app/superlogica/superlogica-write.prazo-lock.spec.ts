jest.mock('../common/lock-distribuido', () => ({
  ...jest.requireActual('../common/lock-distribuido'),
  comLock: jest.fn(),
}));

import * as lock from '../common/lock-distribuido';
import { SuperlogicaWriteService } from './superlogica-write.service';

/**
 * Fix round 1 (I-4): quando a escrita na unidade passa de 5 min com o lock,
 * `comLock` rejeita com PrazoDoLockEstouradoError. A fila da unidade converte
 * isso em recusa com motivo — o laço de reenviarPendentes lia `r.enviado` de
 * `undefined` (TypeError).
 */
describe('SuperlogicaWriteService — prazo do lock da unidade estourado', () => {
  afterEach(() => (lock.comLock as jest.Mock).mockReset());

  const servico = () => new SuperlogicaWriteService({} as any, {} as any, {} as any) as any;

  it('vira recusa com motivo de prazo (nunca undefined)', async () => {
    (lock.comLock as jest.Mock)
      .mockRejectedValueOnce(new lock.PrazoDoLockEstouradoError('superlogica:uni:1:2', 300_000));
    const r = await servico().naFilaDaUnidade(
      '1:2',
      async () => ({ enviado: true }),
      (motivo: 'ocupada' | 'prazo') => ({ enviado: false, motivo }),
    );
    expect(r).toEqual({ enviado: false, motivo: 'prazo' });
  });

  it('lock ocupado por outra instância vira recusa "ocupada"', async () => {
    (lock.comLock as jest.Mock).mockResolvedValueOnce({ obtido: false });
    const r = await servico().naFilaDaUnidade(
      '1:2',
      async () => ({ enviado: true }),
      (motivo: 'ocupada' | 'prazo') => ({ enviado: false, motivo }),
    );
    expect(r).toEqual({ enviado: false, motivo: 'ocupada' });
  });

  it('outros erros continuam sendo propagados (o laço de reenvio registra o motivo)', async () => {
    (lock.comLock as jest.Mock).mockRejectedValueOnce(new Error('ERP 500'));
    await expect(
      servico().naFilaDaUnidade('1:2', async () => ({ enviado: true }), () => ({ enviado: false })),
    ).rejects.toThrow('ERP 500');
  });
});
