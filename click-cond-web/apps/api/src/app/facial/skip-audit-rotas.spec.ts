import { Reflector } from '@nestjs/core';
import { SKIP_AUDIT_KEY } from '../common/interceptors/skip-audit.decorator';
import { FacialController } from './facial.controller';
import { RegrasAcessoController } from '../regras-acesso/regras-acesso.controller';
import { CaminhosAcessoController } from '../caminhos-acesso/caminhos-acesso.controller';

/**
 * Essas rotas já gravam auditoria explícita no service (MANUAL_OVERRIDE, DEVICE_CHANGE,
 * RULE_CHANGE). Sem @SkipAudit() o AuditInterceptor gravava uma segunda linha genérica
 * ("Criação em Reconhecimento Facial", corpo cru) para a mesma ação.
 */
describe('@SkipAudit() nas rotas com auditoria explícita', () => {
  const reflector = new Reflector();
  const pula = (alvo: any, metodo: string) => reflector.get<boolean>(SKIP_AUDIT_KEY, alvo.prototype[metodo]);

  it.each(['create', 'update', 'remove', 'rotateToken', 'trigger'])('FacialController.%s', (m) => {
    expect(pula(FacialController, m)).toBe(true);
  });

  it('FacialController.test (sem auditoria explícita) continua no interceptor', () => {
    expect(pula(FacialController, 'test')).toBeUndefined();
  });

  it.each(['create', 'update', 'remove'])('RegrasAcessoController.%s', (m) => {
    expect(pula(RegrasAcessoController, m)).toBe(true);
  });

  it.each(['create', 'update', 'remove'])('CaminhosAcessoController.%s', (m) => {
    expect(pula(CaminhosAcessoController, m)).toBe(true);
  });
});
