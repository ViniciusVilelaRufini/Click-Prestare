import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import {
  AtualizarEntregadorDto,
  AtualizarStatusDeliveryDto,
  CriarDeliveryDto,
  CriarEntregadorDto,
} from './dto/delivery.dto';
import { DeliveryService } from './delivery.service';

@Controller('delivery')
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}

  @Get()
  listar(
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @Query('status') status: string | undefined,
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.listarAtendimentos(idCondominio, status, user);
  }

  @Post()
  criar(@Body() dto: CriarDeliveryDto, @ReqUser() user: JwtPayload) {
    return this.service.criarAviso(dto, user);
  }

  @Patch(':id')
  atualizarStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AtualizarStatusDeliveryDto,
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.atualizarStatus(id, dto, user);
  }

  @Get('entregadores')
  listarEntregadores(
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @Query('busca') busca: string | undefined,
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.listarEntregadores(idCondominio, busca, user);
  }

  @Post('entregadores')
  criarEntregador(@Body() dto: CriarEntregadorDto, @ReqUser() user: JwtPayload) {
    return this.service.criarEntregador(dto, user);
  }

  @Patch('entregadores/:id')
  atualizarEntregador(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AtualizarEntregadorDto,
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.atualizarEntregador(id, dto, user);
  }
}
