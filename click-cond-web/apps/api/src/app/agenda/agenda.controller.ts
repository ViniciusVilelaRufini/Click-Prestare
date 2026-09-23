import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { UsuarioAppGuard } from '../auth/usuario-app.guard';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { AgendaService } from './agenda.service';

/**
 * Manutenções programadas — consumido pela tela ListAgenda do app.
 * Mesmos caminhos das rotas Express /agenda/* que o app já chama.
 */
// Rotas do app: o `sub` só é Users.id em token de usuário do app. O do
// porteiro (Funcionarios_Portaria.id) e o do CRM agiam como o usuário de
// mesmo número. Rotas @Public continuam abertas.
@UseGuards(UsuarioAppGuard)
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
