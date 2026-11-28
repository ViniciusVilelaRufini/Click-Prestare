import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { idDoCorpo } from '../interfone/interfone-app.controller';
import type { MotivoAberturaPedido } from '../interfone/interfone-acoes.service';
import { CentralService } from './central.service';
import type { PedidoDaCentral } from './central.service';
import { operadorDoToken } from './operador.util';

/**
 * Console da central (operadores que atendem vários condomínios). Toda rota começa por
 * `operadorDoToken`: só token de operador bem formado, sem senha temporária pendente; porteiro,
 * síndico, morador e CRM → 403. O TenantGuard só deixa o token de operador passar em controllers
 * `central/...`. As ações não levam o log automático: abrir é auditado no serviço, com o motivo.
 */
@Controller('central')
export class CentralController {
  constructor(private readonly central: CentralService) {}

  @Get('condominios')
  async condominios(@ReqUser() user: JwtPayload) {
    operadorDoToken(user);
    return this.central.condominios();
  }

  @Get('fila')
  async fila(@ReqUser() user: JwtPayload) {
    operadorDoToken(user);
    return this.central.fila();
  }

  @SkipAudit()
  @Post('chamadas/:id/atender')
  @HttpCode(200)
  async atender(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.central.atender(operadorDoToken(user), id);
  }

  @SkipAudit()
  @Post('chamadas/:id/abrir')
  @HttpCode(200)
  async abrir(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<MotivoAberturaPedido> | undefined,
    @ReqUser() user: JwtPayload,
  ) {
    const op = operadorDoToken(user);
    return this.central.abrir(op, id, body ? { codigo: body.codigo as MotivoAberturaPedido['codigo'], detalhe: body.detalhe } : null);
  }

  @SkipAudit()
  @Post('chamadas/:id/encerrar')
  @HttpCode(200)
  async encerrar(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.central.encerrar(operadorDoToken(user), id);
  }

  @Get('chamadas/:id/contexto')
  async contexto(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.central.contexto(operadorDoToken(user), id);
  }

  /** Pede a autorização ao morador (`{ nome, motivo?, tipo, id_apartamento? }`) → PedidoResumo. */
  @SkipAudit()
  @Post('chamadas/:id/pedido')
  @HttpCode(200)
  async pedido(@Param('id', ParseIntPipe) id: number, @Body() body: PedidoDaCentral | undefined, @ReqUser() user: JwtPayload) {
    const op = operadorDoToken(user);
    return this.central.pedido(op, id, body);
  }

  @SkipAudit()
  @Post('ligar')
  @HttpCode(200)
  async ligar(@Body() body: { id_apartamento?: number } | undefined, @ReqUser() user: JwtPayload) {
    const op = operadorDoToken(user);
    return this.central.ligar(op, idDoCorpo(body?.id_apartamento, 'id_apartamento'));
  }

  /** Chamadas atendidas pela central num dia (`?data=AAAA-MM-DD`, até 30 dias atrás). */
  @Get('historico')
  async historico(@Query('data') data: string, @ReqUser() user: JwtPayload) {
    operadorDoToken(user);
    return this.central.historico(data);
  }

  /** Alertas do Guarita dos condomínios da central (`?pendentes=1`: só os não vistos). */
  @Get('alertas')
  async alertas(@Query('pendentes') pendentes: string | undefined, @ReqUser() user: JwtPayload) {
    operadorDoToken(user);
    return this.central.alertas(pendentes === '1' || pendentes === 'true');
  }

  @SkipAudit()
  @Post('alertas/:id/visto')
  @HttpCode(200)
  async alertaVisto(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.central.alertaVisto(operadorDoToken(user), id);
  }

  /** "Ligar" do operador: unidades do condomínio da central (`?busca=`), só `{ id, rotulo }`. */
  @Get('condominios/:id/unidades')
  async unidades(
    @Param('id', ParseIntPipe) id: number,
    @Query('busca') busca: string | undefined,
    @ReqUser() user: JwtPayload,
  ) {
    operadorDoToken(user);
    return this.central.unidades(id, busca);
  }
}
