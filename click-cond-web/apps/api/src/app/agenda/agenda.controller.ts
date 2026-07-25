import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { AgendaService } from './agenda.service';

/**
 * Manutenções programadas — consumido pela tela ListAgenda do app.
 * Mesmos caminhos das rotas Express /agenda/* que o app já chama.
 */
@Controller('agenda')
export class AgendaController {
  constructor(private readonly service: AgendaService) {}

  @Get('get-all')
  getAll(
    @Query('id_condominio') idCondominio: string,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.findAll(Number(idCondominio), payload);
  }

  @Get('get')
  getOne(@Query('id') id: string, @ReqUser() payload: JwtPayload) {
    return this.service.findOne(Number(id), payload);
  }

  // Body: { id_condominio, agenda: { titulo, descricao, data_inicio, ... } }
  @Post('insert')
  @HttpCode(200)
  insert(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.create(Number(body?.id_condominio), body?.agenda ?? {}, payload);
  }

  @Post('update')
  @HttpCode(200)
  update(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.update(Number(body?.id_condominio), body?.agenda ?? {}, payload);
  }

  @Post('remove')
  @HttpCode(200)
  remove(@Body() body: { id: string | number }, @ReqUser() payload: JwtPayload) {
    return this.service.remove(Number(body?.id), payload);
  }
}
