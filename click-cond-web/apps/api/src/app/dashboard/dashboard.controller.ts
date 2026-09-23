import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador } from '../auth/tenant.util';

/**
 * Painel da PORTARIA-WEB: visitantes recentes (nome, documento, fotos),
 * ocorrências, acessos do facial e log de auditoria. O TenantGuard só confere
 * o vínculo com o condomínio — morador tem vínculo —, por isso o papel é
 * conferido aqui. O app usa /dashboard/summary e /dashboard/meus-eventos.
 */
@Controller('condominios/:idCondominio/dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  get(@Param('idCondominio', ParseIntPipe) idCondominio: number, @ReqUser() user: JwtPayload) {
    assertOperador(user, 'abrir o painel da portaria');
    return this.service.summary(idCondominio);
  }
}
