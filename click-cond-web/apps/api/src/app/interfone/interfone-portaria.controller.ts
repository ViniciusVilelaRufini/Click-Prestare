import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { requireTenant } from '../auth/tenant.util';
import { idFuncionarioPortariaDoToken } from '../auth/usuario-do-token.util';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { InterfoneAcoesService } from './interfone-acoes.service';
import type { QuemPortaria } from './interfone-acoes.service';
import { idDoCorpo } from './interfone-app.controller';

/**
 * Interfone no console da portaria. Só o porteiro (`tipo_sub ===
 * 'funcionario_portaria'`, carimbado no login): o síndico no console não
 * atende o interfone. O condomínio da chamada é conferido contra o do token
 * no serviço (mesmo efeito de assertTenantStrict).
 */
@Controller('interfone/portaria')
export class InterfonePortariaController {
  constructor(private readonly acoes: InterfoneAcoesService) {}

  private porteiro(user: JwtPayload | undefined): QuemPortaria {
    const uid = idFuncionarioPortariaDoToken(user);
    if (!uid) throw new ForbiddenException('Acesso negado: o interfone do console é do porteiro.');
    requireTenant(user, 'interfone da portaria');
    return { papel: 'portaria', uid, nome: String(user?.nome ?? '').trim(), idCondominio: Number(user?.id_condominio) };
  }

  @SkipAudit()
  @Post('chamadas/:id/atender')
  @HttpCode(200)
  atender(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.acoes.atender(id, this.porteiro(user));
  }

  @SkipAudit()
  @Post('ligar')
  @HttpCode(200)
  ligar(@Body() body: { id_apartamento?: number }, @ReqUser() user: JwtPayload) {
    return this.acoes.ligarUnidade(this.porteiro(user), idDoCorpo(body?.id_apartamento, 'id_apartamento'));
  }

  @SkipAudit()
  @Post('chamadas/:id/abrir')
  @HttpCode(200)
  abrir(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.acoes.abrir(id, this.porteiro(user));
  }

  @SkipAudit()
  @Post('chamadas/:id/encerrar')
  @HttpCode(200)
  encerrar(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.acoes.encerrarPortaria(id, this.porteiro(user));
  }

  @Get('hoje')
  hoje(@ReqUser() user: JwtPayload) {
    return this.acoes.hoje(this.porteiro(user).idCondominio);
  }
}
