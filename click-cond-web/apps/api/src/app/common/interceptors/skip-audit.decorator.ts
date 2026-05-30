import { SetMetadata } from '@nestjs/common';

/**
 * Marca um endpoint para o AuditInterceptor NÃO gravar log automático.
 *
 * Use quando o service já chama `AuditoriaService.registrar()` com
 * contexto rico (detalhes estruturados). Sem isso, o interceptor grava
 * um log duplicado com descrição genérica e body cru, poluindo a
 * tabela de auditoria.
 *
 * Exemplo:
 *   @SkipAudit()
 *   @Post('check-in')
 *   checkIn(...) { ... }
 */
export const SKIP_AUDIT_KEY = 'skipAudit';
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);
