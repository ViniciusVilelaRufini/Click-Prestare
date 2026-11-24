import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { FinanceiroController } from './financeiro.controller';

/**
 * C2 — "Notificar inadimplente" respondia 201 (padrão do @Post) e o app
 * publicado exige 200: mostrava falha depois de enviar e o reenvio duplicava
 * push e e-mail. O resultado de verdade vai no `success` do corpo.
 */
describe('POST financeiro/inadimplente/notificar', () => {
  it('responde 200', () => {
    const fn = (FinanceiroController.prototype as any).notifyInadimplente;
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, fn)).toBe(200);
  });
});
