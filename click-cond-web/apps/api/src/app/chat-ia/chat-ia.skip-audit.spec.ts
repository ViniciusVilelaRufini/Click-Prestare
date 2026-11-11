import { ChatIaController } from './chat-ia.controller';
import { SKIP_AUDIT_KEY } from '../common/interceptors/skip-audit.decorator';

/**
 * A pergunta ao assistente é conversa privada do usuário do app. O corpo traz
 * `id_condominio`, então o AuditInterceptor gravava a pergunta inteira em
 * audit_logs.detalhes — legível pelos operadores da portaria na tela de
 * auditoria. A rota precisa ficar fora do log automático.
 */
describe('ChatIaController — conversa fora do log de auditoria', () => {
  it('POST /chat-ia/perguntar está marcado com @SkipAudit', () => {
    const marcado = Reflect.getMetadata(SKIP_AUDIT_KEY, ChatIaController.prototype.perguntar);
    expect(marcado).toBe(true);
  });

  it('ações que mudam dados continuam auditadas', () => {
    expect(Reflect.getMetadata(SKIP_AUDIT_KEY, ChatIaController.prototype.confirmar)).toBeUndefined();
    expect(Reflect.getMetadata(SKIP_AUDIT_KEY, ChatIaController.prototype.reindex)).toBeUndefined();
  });
});
