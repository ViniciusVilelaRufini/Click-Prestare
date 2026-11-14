import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ReqUser } from '../../auth/req-user.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.interface';
import { DeliveryPortaoService } from './delivery-portao.service';

/**
 * Configuração do autoatendimento de entregas: a opção do condomínio (com
 * horário) e o QR de entregas de cada portão. Leitura para quem opera a
 * portaria; mudança só para o síndico (typeAccess, não o turno).
 */
@Controller('entrega')
export class EntregaConfigController {
  constructor(private readonly service: DeliveryPortaoService) {}

  @Get('config')
  lerConfig(@Query('id_condominio', ParseIntPipe) idCondominio: number, @ReqUser() user: JwtPayload) {
    return this.service.lerConfig(idCondominio, user);
  }

  @Put('config')
  salvarConfig(
    @Body() body: { id_condominio?: unknown; habilitado?: unknown; inicio?: unknown; fim?: unknown },
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.salvarConfig(
      Number(body?.id_condominio),
      { habilitado: body?.habilitado, inicio: body?.inicio, fim: body?.fim },
      user,
    );
  }

  /** Cria ou troca o token do QR (trocar invalida a folha impressa). */
  @Post('portao/:idDevice/token')
  @HttpCode(200)
  gerarToken(@Param('idDevice', ParseIntPipe) idDevice: number, @ReqUser() user: JwtPayload) {
    return this.service.gerarTokenPortao(idDevice, user);
  }

  /** Desliga o QR de entregas deste portão. */
  @Delete('portao/:idDevice/token')
  removerToken(@Param('idDevice', ParseIntPipe) idDevice: number, @ReqUser() user: JwtPayload) {
    return this.service.removerTokenPortao(idDevice, user);
  }
}
