import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { JwtPayload } from './jwt-payload.interface';

/**
 * Bloqueia acesso cross-tenant em rotas estruturadas como
 * `/condominios/:idCondominio/...`.
 *
 * Quando a URL contém :idCondominio, verifica que ele bate com o
 * `id_condominio` do JWT. Sem essa verificação, qualquer porteiro
 * autenticado consegue ler/editar dados de outros condomínios chutando IDs.
 *
 * Rotas marcadas como @Public (login, webhook) são liberadas.
 * Rotas sem :idCondominio na URL não são afetadas — o tenant precisa ser
 * checado no service (o helper assertSameTenant ajuda).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const idCondominioParam = request.params?.idCondominio;
    if (!idCondominioParam) return true;

    const user: JwtPayload | undefined = request.user;
    if (!user) return true; // JwtAuthGuard já barra o que precisa

    // Síndico no app pode acessar qualquer condomínio dele; porteiro tem 1 só.
    // Para a portaria-web (porteiro), o id_condominio vem fixo no JWT.
    const userCondId = user.id_condominio;
    const urlCondId = Number(idCondominioParam);

    if (!userCondId) {
      // JWT sem id_condominio: tipicamente síndico no app — checagem
      // específica fica para o módulo (síndico precisa validar via Users x Condominios).
      // Não bloqueamos aqui para não quebrar fluxos válidos do app mobile.
      return true;
    }

    if (Number.isNaN(urlCondId) || urlCondId !== userCondId) {
      this.logger.warn(
        `Tenant mismatch: user ${user.sub} (cond ${userCondId}) tentou acessar cond ${idCondominioParam} em ${request.method} ${request.url}`,
      );
      throw new ForbiddenException('Acesso negado: condomínio inválido para esta sessão');
    }

    return true;
  }
}
