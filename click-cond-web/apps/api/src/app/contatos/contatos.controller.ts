import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ContatosService } from './contatos.service';
import type { ContatoDto } from './contatos.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

// Superfície mobile-compat (get-all/insert/update/remove), igual a Documentos —
// é o formato que o app Flutter já fala via apiGetAll/apiSaveObject.
@Controller('contatos')
export class ContatosController {
  constructor(private readonly service: ContatosService) {}

  @Get('get-all')
  getAll(@Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    return this.service.getAll(Number(idCondominio), payload);
  }

  @Post('insert')
  @HttpCode(200)
  insert(
    @Body() body: { id_condominio: string | number; contato: ContatoDto },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.insert(Number(body.id_condominio), body.contato, payload);
  }

  @Post('update')
  @HttpCode(200)
  update(
    @Body() body: { id_condominio: string | number; contato: ContatoDto },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.update(Number(body.id_condominio), body.contato, payload);
  }

  @Post('remove')
  @HttpCode(200)
  remove(@Body() body: { id: string | number }, @ReqUser() payload: JwtPayload) {
    return this.service.remove(Number(body.id), payload);
  }
}
