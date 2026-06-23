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
import { MockRelayService } from './mock-relay.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertTenantStrict, requireTenant } from '../auth/tenant.util';

@Controller('facial')
export class FacialController {
  constructor(private readonly service: FacialService) {}

  @Get('devices')
  list(
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertTenantStrict(
      idCondominio,
      user,
      `dispositivos do condomínio ${idCondominio}`,
    );
    return this.service.listDevices(idCondominio);
  }

  @Get('devices/:id')
  async get(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
  ) {
    const device = await this.service.getDevice(id);
    assertTenantStrict(device.id_condominio, user, `dispositivo #${id}`);
    return device;
  }

  @Post('devices')
  create(@Body() body: CreateDeviceDto, @ReqUser() user: JwtPayload) {
    assertTenantStrict(body.id_condominio, user, `criação de dispositivo`);
    return this.service.createDevice(body, user);
  }

  @Put('devices/:id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateDeviceDto,
    @ReqUser() user: JwtPayload,
  ) {
    const device = await this.service.getDevice(id);
    assertTenantStrict(device.id_condominio, user, `dispositivo #${id}`);
    return this.service.updateDevice(id, body, user);
  }

  @Delete('devices/:id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
  ) {
    const device = await this.service.getDevice(id);
    assertTenantStrict(device.id_condominio, user, `dispositivo #${id}`);
    return this.service.removeDevice(id, user);
  }

  @Post('devices/:id/test')
  async test(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
  ) {
    const device = await this.service.getDevice(id);
    assertTenantStrict(device.id_condominio, user, `dispositivo #${id}`);
    return this.service.testDevice(id);
  }

  @Post('devices/:id/trigger')
  async trigger(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
  ) {
    const device = await this.service.getDevice(id);
    assertTenantStrict(device.id_condominio, user, `dispositivo #${id}`);
    return this.service.triggerDevice(id, user);
  }

  @Post('sync/all')
  syncAll(
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertTenantStrict(
      idCondominio,
      user,
      `sync facial do condomínio ${idCondominio}`,
    );
    return this.service.syncAllForCondominio(idCondominio, {
      onlyPending: false,
    });
  }

  @Get('sync/status')
  syncStatus(
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertTenantStrict(
      idCondominio,
      user,
      `status facial do condomínio ${idCondominio}`,
    );
    return this.service.getSyncStatus(idCondominio);
  }

  @Post('sync/morador/:id')
  async syncMorador(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
  ) {
    requireTenant(user, 'sincronização de morador');
    await this.service.assertMoradorSameTenant(id, user);
    return this.service.syncMorador(id);
  }

  @Post('sync/visitante/:id')
  async syncVisitante(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
  ) {
    requireTenant(user, 'sincronização de visitante');
    await this.service.assertVisitanteSameTenant(id, user);
    return this.service.syncVisitante(id);
  }

  @Get('acessos')
  acessos(
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @Query('limit') limitStr?: string,
    @ReqUser() user?: JwtPayload,
  ) {
    assertTenantStrict(
      idCondominio,
      user,
      `acessos do condomínio ${idCondominio}`,
    );
    const limit = limitStr ? Number(limitStr) : 50;
    return this.service.listAcessos(idCondominio, limit);
  }

  @Get('acessos/visitante/:id')
  async acessosVisitante(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
    @Query('limit') limitStr?: string,
  ) {
    await this.service.assertVisitanteSameTenant(id, user);
    const limit = limitStr ? Number(limitStr) : 30;
    return this.service.listAcessosPessoa('visitante', id, limit);
  }

  @Get('acessos/morador/:id')
  async acessosMorador(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
    @Query('limit') limitStr?: string,
  ) {
    await this.service.assertMoradorSameTenant(id, user);
    const limit = limitStr ? Number(limitStr) : 30;
    return this.service.listAcessosPessoa('morador', id, limit);
  }

  // ----- Enrollment guiado (captura de UID/QR via leitor) -----

  @Post('enroll/start')
  async startEnroll(
    @Body() body: { id_device: number },
    @ReqUser() user: JwtPayload,
  ) {
    const device = await this.service.getDevice(body.id_device);
    assertTenantStrict(
      device.id_condominio,
      user,
      `dispositivo #${body.id_device}`,
    );
    return this.service.startEnrollCapture(body.id_device);
  }

  @Get('enroll/:sessionId')
  pollEnroll(
    @Param('sessionId') sessionId: string,
    @ReqUser() user: JwtPayload,
  ) {
    requireTenant(user, 'captura de enrollment');
    return this.service.pollEnrollCapture(sessionId, user);
  }

  @Delete('enroll/:sessionId')
  cancelEnroll(
    @Param('sessionId') sessionId: string,
    @ReqUser() user: JwtPayload,
  ) {
    requireTenant(user, 'captura de enrollment');
    return this.service.cancelEnrollCapture(sessionId, user);
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

/**
 * Mock de "botoeira/catraca genérica" para testes sem hardware.
 *
 * Fluxo: quando um Facial_Device tem IP "sim" (ou "simulador"), o
 * triggerRelay redireciona internamente para POST /sim/relay/:deviceId/trigger
 * — esse controller recebe e armazena em memória.
 *
 * O HTML do simulador faz polling em GET /sim/relay/:deviceId/events e exibe
 * uma animação de "porta abrindo" cada vez que chega um novo evento.
 *
 * Permite testar a ponte RFID/QR → botoeira ponta-a-ponta sem hardware.
 */
@Controller('facial/sim/relay')
export class MockRelayController {
  constructor(private readonly mock: MockRelayService) {}

  @Public()
  @Post(':slug/trigger')
  triggerBySlug(@Param('slug') slug: string, @Body() body: any) {
    const ev = this.mock.record(slug, body ?? {});
    return { ok: true, eventId: ev.id, receivedAt: ev.receivedAt };
  }

  @Public()
  @Get(':slug/events')
  list(@Param('slug') slug: string, @Query('since') sinceStr?: string) {
    const since = sinceStr ? Number(sinceStr) : undefined;
    return { events: this.mock.list(slug, since) };
  }

  @Public()
  @Get(':slug/clear')
  clear(@Param('slug') slug: string) {
    this.mock.clear(slug);
    return { ok: true };
  }
}
