import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import {
  CreateDeviceDto,
  FacialService,
  UpdateDeviceDto,
  WebhookEventDto,
} from './facial.service';

@Controller('facial')
export class FacialController {
  constructor(private readonly service: FacialService) {}

  @Get('devices')
  list(@Query('id_condominio', ParseIntPipe) idCondominio: number) {
    return this.service.listDevices(idCondominio);
  }

  @Get('devices/:id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.getDevice(id);
  }

  @Post('devices')
  create(@Body() body: CreateDeviceDto) {
    return this.service.createDevice(body);
  }

  @Put('devices/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateDeviceDto) {
    return this.service.updateDevice(id, body);
  }

  @Delete('devices/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeDevice(id);
  }

  @Post('devices/:id/test')
  test(@Param('id', ParseIntPipe) id: number) {
    return this.service.testDevice(id);
  }

  @Post('devices/:id/trigger')
  trigger(@Param('id', ParseIntPipe) id: number) {
    return this.service.triggerDevice(id);
  }

  @Post('sync/morador/:id')
  syncMorador(@Param('id', ParseIntPipe) id: number) {
    return this.service.syncMorador(id);
  }

  @Post('sync/visitante/:id')
  syncVisitante(@Param('id', ParseIntPipe) id: number) {
    return this.service.syncVisitante(id);
  }

  @Get('acessos')
  acessos(
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @Query('limit') limitStr?: string,
  ) {
    const limit = limitStr ? Number(limitStr) : 50;
    return this.service.listAcessos(idCondominio, limit);
  }

  @Get('acessos/visitante/:id')
  acessosVisitante(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limitStr?: string,
  ) {
    const limit = limitStr ? Number(limitStr) : 30;
    return this.service.listAcessosPessoa('visitante', id, limit);
  }

  @Get('acessos/morador/:id')
  acessosMorador(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limitStr?: string,
  ) {
    const limit = limitStr ? Number(limitStr) : 30;
    return this.service.listAcessosPessoa('morador', id, limit);
  }
}

@Controller('facial/webhook')
export class FacialWebhookController {
  constructor(private readonly service: FacialService) {}

  @Public()
  @Post(':token')
  receive(@Param('token') token: string, @Body() payload: WebhookEventDto) {
    return this.service.processWebhook(token, payload);
  }
}

/**
 * Endpoints públicos para o simulador de terminal facial (browser).
 * Autenticação via webhook_token do device.
 */
@Controller('facial/simulator')
export class FacialSimulatorController {
  constructor(private readonly service: FacialService) {}

  @Public()
  @Get(':token/persons')
  async listPersons(@Param('token') token: string) {
    const device = await this.service.findDeviceByToken(token);
    return this.service.listPersonsForDevice(device.id);
  }
}
