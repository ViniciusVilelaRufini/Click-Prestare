import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { CrmAdminGuard } from './crm-admin.guard';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { autorDoToken } from '../auth/usuario-do-token.util';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { InterfoneConfigService } from '../interfone/interfone-config.service';
import type { AtorConfig } from '../interfone/interfone-config.service';

/**
 * Interfone pelo app no CRM: liga o módulo (contratado) condomínio a
 * condomínio. Só depois disso o síndico vê e configura a aba Interfone.
 * Portaria autônoma: aqui também a central contratada, a IA no portão, o
 * número da portaria, as instruções de entrega e a agenda (serviço contratado:
 * o síndico só vê). Toda alteração grava INTERFONE_CONFIG no serviço.
 */
@UseGuards(CrmAdminGuard)
@Controller('crm/interfone')
export class CrmInterfoneController {
  constructor(private readonly config: InterfoneConfigService) {}

  private ator(user?: JwtPayload): AtorConfig {
    const nome = (user as any)?.nome ?? (user as any)?.email ?? 'Admin CRM';
    return { nome, ...autorDoToken(user) };
  }

  @Get('clientes')
  clientes() {
    return this.config.clientesCrm();
  }

  @SkipAudit()
  @Post('clientes/:id/contratado')
  contratado(@Param('id', ParseIntPipe) id: number, @Body('ligado') ligado: boolean, @ReqUser() user?: JwtPayload) {
    return this.config.definirContratado(id, ligado, this.ator(user));
  }

  @SkipAudit()
  @Post('clientes/:id/central')
  central(@Param('id', ParseIntPipe) id: number, @Body('ligado') ligado: boolean, @ReqUser() user?: JwtPayload) {
    return this.config.definirCentral(id, ligado, this.ator(user));
  }

  @SkipAudit()
  @Post('clientes/:id/ia')
  ia(@Param('id', ParseIntPipe) id: number, @Body('ligado') ligado: boolean, @ReqUser() user?: JwtPayload) {
    return this.config.definirIa(id, ligado, this.ator(user));
  }

  @SkipAudit()
  @Put('clientes/:id/portaria')
  portaria(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { numero_portaria?: unknown; instrucao_entregas?: unknown },
    @ReqUser() user?: JwtPayload,
  ) {
    return this.config.salvarPortaria(id, body ?? {}, this.ator(user));
  }

  @Get('clientes/:id/agenda')
  agenda(@Param('id', ParseIntPipe) id: number) {
    return this.config.agendaCrm(id);
  }

  @SkipAudit()
  @Put('clientes/:id/agenda')
  salvarAgenda(@Param('id', ParseIntPipe) id: number, @Body() faixas: unknown, @ReqUser() user?: JwtPayload) {
    return this.config.salvarAgenda(id, faixas, this.ator(user));
  }
}
