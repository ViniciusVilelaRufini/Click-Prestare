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
import { TenantAccessService } from './tenant-access.service';

/**
 * Bloqueia acesso cross-tenant em rotas estruturadas como
 * `/condominios/:idCondominio/...`.
 *
 * Quando a URL contém :idCondominio, verifica que ele bate com o
 * `id_condominio` do JWT. Sem essa verificação, qualquer porteiro
 * autenticado consegue ler/editar dados de outros condomínios chutando IDs.
 *
 * Tokens mobile (síndico/morador/funcionário do app) não carregam
 * id_condominio — para esses, resolve o vínculo de verdade via
 * TenantAccessService (consulta Sindicos_Condominios/Apartamentos_Users),
 * em vez de liberar sem checar. Sem isso, qualquer usuário do app conseguia
 * escolher um :idCondominio arbitrário na URL e passar por este guard.
 *
 * Rotas marcadas como @Public (login, webhook) são liberadas.
 * Rotas sem :idCondominio na URL não são afetadas — o tenant precisa ser
 * checado no service (os helpers assertSameTenant/TenantAccessService ajudam).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tenant: TenantAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    const urlCondId = Number(idCondominioParam);
    if (Number.isNaN(urlCondId)) {
      throw new ForbiddenException('Acesso negado: condomínio inválido para esta sessão');
    }

    // Porteiro/portaria-web: id_condominio fixo no JWT, compara direto.
    const userCondId = user.id_condominio;
    if (userCondId) {
      if (urlCondId !== userCondId) {
        this.logger.warn(
          `Tenant mismatch: user ${user.sub} (cond ${userCondId}) tentou acessar cond ${idCondominioParam} em ${request.method} ${request.url}`,
        );
        throw new ForbiddenException('Acesso negado: condomínio inválido para esta sessão');
      }
      return true;
    }

    // Token mobile (síndico/morador/funcionário) sem id_condominio: resolve
    // o vínculo de verdade via banco. Lança ForbiddenException se não pertencer.
    await this.tenant.assertCondominio(urlCondId, user);
    return true;
  }
}
