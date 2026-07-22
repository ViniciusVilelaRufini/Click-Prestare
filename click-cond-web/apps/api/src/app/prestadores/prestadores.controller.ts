import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query,
} from '@nestjs/common';
import { CreatePrestadorDto, PrestadoresService } from './prestadores.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('condominios/:idCondominio/prestadores')
export class PrestadoresController {
  constructor(private readonly service: PrestadoresService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('search') search: string | undefined,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.findAll(idCondominio, search, payload);
  }

  @Get(':id')
  get(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.findOne(id, idCondominio, payload);
  }

  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreatePrestadorDto, 'id_condominio'>,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.create({ ...body, id_condominio: idCondominio }, payload);
  }

  @Put(':id')
  update(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<CreatePrestadorDto>,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.update(id, body, idCondominio, payload);
  }

  @Patch(':id/foto')
  clearFoto(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { campo: 'pessoa' | 'documento' },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.clearFoto(id, body.campo, idCondominio, payload);
  }

  @Delete(':id')
  remove(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
  ) {
    this.service.remove(id, idCondominio, payload);
    return { ok: true };
  }
}
