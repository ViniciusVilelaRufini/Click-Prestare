import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ConvitesService } from './convites.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { Public } from '../auth/public.decorator';

/**
 * Convite de visita por link.
 *
 * Duas rotas aqui são `@Public()` — as que o visitante abre no celular sem ter
 * conta. São as primeiras rotas do sistema em que alguém sem sessão GRAVA
 * dado; até então `@Public()` cobria só autenticação e webhooks de pagamento.
 *
 * A trava dessas duas é o token: 32 bytes aleatórios, guardado como hash, de
 * uso único e com validade de 24h.
 */
@Controller('convites')
export class ConvitesController {
  constructor(private readonly service: ConvitesService) {}

  /** Morador gera o link. O tipo é o ÚNICO campo aceito do cliente. */
  @Post()
  @HttpCode(200)
  gerar(@Body() body: { is_prestador?: boolean }, @ReqUser() user: JwtPayload) {
    return this.service.gerar(user, body?.is_prestador === true);
  }

  /** Convites preenchidos esperando decisão deste morador. */
  @Get('pendentes')
  pendentes(@ReqUser() user: JwtPayload) {
    return this.service.listarPendentes(user);
  }

  @Post(':id/confirmar')
  @HttpCode(200)
  confirmar(@Param('id') id: string, @ReqUser() user: JwtPayload) {
    return this.service.confirmar(Number(id), user);
  }

  @Post(':id/recusar')
  @HttpCode(200)
  recusar(@Param('id') id: string, @ReqUser() user: JwtPayload) {
    return this.service.recusar(Number(id), user);
  }

  // ===================== Público =====================

  @Public()
  @Get('publico/:token')
  lerPublico(@Param('token') token: string) {
    return this.service.lerPublico(token);
  }

  @Public()
  @Post('publico/:token')
  @HttpCode(200)
  responder(
    @Param('token') token: string,
    @Body() body: { nome?: string; cpf?: string; foto?: string; aceite?: boolean },
  ) {
    return this.service.responder(token, body);
  }
}
