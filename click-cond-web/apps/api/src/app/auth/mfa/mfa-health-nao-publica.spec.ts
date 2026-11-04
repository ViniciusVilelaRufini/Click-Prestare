import 'reflect-metadata';
import { IS_PUBLIC_KEY } from '../public.decorator';
import { MfaController } from './mfa.controller';

/**
 * Pentest 04/11: GET /auth/mfa/health era @Public — qualquer um disparava uma conexão SMTP
 * (transporter.verify) por chamada e lia a mensagem crua de erro do servidor de e-mail.
 * As rotas do desafio continuam públicas (o síndico ainda não tem token nessa etapa).
 */
describe('MfaController — superfície pública', () => {
  const publica = (metodo: keyof MfaController) =>
    Reflect.getMetadata(IS_PUBLIC_KEY, MfaController.prototype[metodo] as any) === true;

  it('health exige autenticação', () => {
    expect(publica('health')).toBe(false);
  });

  it('verify e resend seguem públicas', () => {
    expect(publica('verify')).toBe(true);
    expect(publica('resend')).toBe(true);
  });
});
