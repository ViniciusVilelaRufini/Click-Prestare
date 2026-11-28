import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { CrmAdminGuard } from './crm-admin.guard';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { autorDoToken } from '../auth/usuario-do-token.util';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { InterfoneConfigService } from '../interfone/interfone-config.service';

/**
 * Interfone pelo app no CRM: liga o módulo (contratado) condomínio a
 * condomínio. Só depois disso o síndico vê e configura a aba Interfone.
 */
@UseGuards(CrmAdminGuard)
@Controller('crm/interfone')
export class CrmInterfoneController {
  constructor(private readonly config: InterfoneConfigService) {}

  @Get('clientes')
  clientes() {
    return this.config.clientesCrm();
  }

  @SkipAudit()
  @Post('clientes/:id/contratado')
  contratado(@Param('id', ParseIntPipe) id: number, @Body('ligado') ligado: boolean, @ReqUser() user?: JwtPayload) {
    const nome = (user as any)?.nome ?? (user as any)?.email ?? 'Admin CRM';
    return this.config.definirContratado(id, ligado, { nome, ...autorDoToken(user) });
  }
}
