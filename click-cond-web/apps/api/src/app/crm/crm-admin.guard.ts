import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Garante que o token pertence a um administrador do CRM (role 'crm_admin').
 *
 * O JwtAuthGuard global já valida a assinatura/expiração do token; aqui
 * restringimos as rotas de dados do CRM para que um token de porteiro
 * (que não tem role) não consiga acessar a visão cross-condomínio.
 */
@Injectable()
export class CrmAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload | undefined = request.user;
    if (user?.role === 'crm_admin') return true;
    throw new ForbiddenException('Acesso restrito ao painel do CRM.');
  }
}
