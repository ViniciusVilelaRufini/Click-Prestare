import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { UsuarioAppGuard, idUsuarioApp } from '../auth/usuario-app.guard';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { InterfoneAcoesService } from './interfone-acoes.service';
import type { QuemMorador } from './interfone-acoes.service';
import { InterfonePedidosService } from './interfone-pedidos.service';
import type { DecisaoPedido } from './interfone-pedidos.service';

/** Id inteiro positivo do corpo, ou 400. */
export function idDoCorpo(v: unknown, campo: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequestException(`${campo} inválido.`);
  return n;
}

/**
 * Interfone no app do morador. Só token de usuário do app (UsuarioAppGuard);
 * o vínculo com a unidade é conferido no serviço em toda rota.
 *
 * Atender/recusar/ligar não geram auditoria automática (o registro da chamada
 * é o histórico); abrir grava INTERFONE_ABRIR no serviço.
 */
@UseGuards(UsuarioAppGuard)
@Controller('interfone')
export class InterfoneAppController {
  constructor(
    private readonly acoes: InterfoneAcoesService,
    private readonly pedidos: InterfonePedidosService,
  ) {}

  private quem(user: JwtPayload | undefined): QuemMorador {
    const uid = idUsuarioApp(user);
    return { papel: 'morador', uid, nome: String(user?.nome ?? user?.user?.name ?? '').trim() };
  }

  @Get('disponivel')
  disponivel(@ReqUser() user: JwtPayload) {
    return this.acoes.disponivel(this.quem(user).uid);
  }

  @Get('chamadas/:id')
  estado(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.acoes.estadoParaApp(id, this.quem(user).uid);
  }

  @SkipAudit()
  @Post('chamadas/:id/atender')
  @HttpCode(200)
  atender(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.acoes.atender(id, this.quem(user));
  }

  @SkipAudit()
  @Post('chamadas/:id/recusar')
  @HttpCode(200)
  recusar(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.acoes.recusar(id, this.quem(user).uid);
  }

  @SkipAudit()
  @Post('chamadas/:id/abrir')
  @HttpCode(200)
  abrir(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.acoes.abrir(id, this.quem(user));
  }

  @SkipAudit()
  @Post('ligar-portaria')
  @HttpCode(200)
  ligarPortaria(@Body() body: { id_apartamento?: number }, @ReqUser() user: JwtPayload) {
    return this.acoes.ligarPortaria(this.quem(user), idDoCorpo(body?.id_apartamento, 'id_apartamento'));
  }

  /** Pedido do portão (tela de Autorizar/Negar). Vínculo com a unidade do pedido conferido no serviço. */
  @Get('pedidos/:id')
  pedido(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.pedidos.paraApp(id, this.quem(user).uid);
  }

  /**
   * `{ decisao: 'autorizar' | 'negar', mensagem? }`. Autorizar abre o portão da chamada uma vez
   * (auditado no serviço); 409 `pedido_respondido` / `pedido_expirado`; 403 sem vínculo.
   */
  @SkipAudit()
  @Post('pedidos/:id/responder')
  @HttpCode(200)
  responderPedido(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { decisao?: DecisaoPedido; mensagem?: string } | undefined,
    @ReqUser() user: JwtPayload,
  ) {
    const uid = this.quem(user).uid;
    const decisao = body?.decisao;
    if (decisao !== 'autorizar' && decisao !== 'negar') throw new BadRequestException('decisao deve ser autorizar ou negar.');
    if (body?.mensagem !== undefined && body.mensagem !== null && typeof body.mensagem !== 'string') {
      throw new BadRequestException('mensagem deve ser texto.');
    }
    return this.pedidos.responder(id, uid, decisao, body?.mensagem ?? undefined);
  }

  @Get('historico')
  historico(@Query('id_apartamento', ParseIntPipe) idApartamento: number, @ReqUser() user: JwtPayload) {
    return this.acoes.historico(this.quem(user).uid, idApartamento);
  }

  @Get('preferencia')
  preferencia(@ReqUser() user: JwtPayload) {
    return this.acoes.preferencia(this.quem(user).uid);
  }

  @Put('preferencia')
  definirPreferencia(@Body() body: { receber?: boolean }, @ReqUser() user: JwtPayload) {
    if (typeof body?.receber !== 'boolean') throw new BadRequestException('receber deve ser true ou false.');
    return this.acoes.definirPreferencia(this.quem(user).uid, body.receber);
  }
}
