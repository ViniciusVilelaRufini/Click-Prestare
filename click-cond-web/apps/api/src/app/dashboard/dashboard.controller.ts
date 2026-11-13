import { Controller, ForbiddenException, Get, Optional, Param, ParseIntPipe } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador, isSindico } from '../auth/tenant.util';
import { TenantAccessService, ehFuncionarioDoApp } from '../auth/tenant-access.service';

/**
 * Painel da PORTARIA-WEB: visitantes recentes (nome, documento, fotos),
 * ocorrências, acessos do facial e log de auditoria. O TenantGuard só confere
 * o vínculo com o condomínio — morador tem vínculo —, por isso o papel é
 * conferido aqui. O app usa /dashboard/summary e /dashboard/meus-eventos.
 */
@Controller('condominios/:idCondominio/dashboard')
export class DashboardController {
  constructor(
    private readonly service: DashboardService,
    // Global (TenantAccessModule); opcional só pelos specs. Sem ele, funcionário do app é recusado.
    @Optional() private readonly tenant?: TenantAccessService,
  ) {}

  @Get()
  get(@Param('idCondominio', ParseIntPipe) idCondominio: number, @ReqUser() user: JwtPayload) {
    assertOperador(user, 'abrir o painel da portaria');
    return this.recorteOcorrencias(idCondominio, user).then((recorte) =>
      this.service.summary(idCondominio, {
        // A foto do documento (RG) dos visitantes só vai para o síndico.
        incluirFotoDocumento: isSindico(user),
        ...(recorte != null ? { ocorrenciasSoPublicasOuDe: recorte } : {}),
      }),
    );
  }

  private async recorteOcorrencias(idCondominio: number, user: JwtPayload): Promise<number | null> {
    if (!ehFuncionarioDoApp(user)) return null;
    if (!this.tenant) throw new ForbiddenException('Acesso negado.');
    return this.tenant.recorteOcorrenciasPrivadas(idCondominio, user);
  }
}
