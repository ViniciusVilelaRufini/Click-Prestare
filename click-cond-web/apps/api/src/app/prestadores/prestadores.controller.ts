import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import { CreatePrestadorDto, PrestadoresService } from './prestadores.service';

@Controller('condominios/:idCondominio/prestadores')
export class PrestadoresController {
  constructor(private readonly service: PrestadoresService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(idCondominio, search);
  }

  @Get(':id')
  get(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(id, idCondominio);
  }

  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreatePrestadorDto, 'id_condominio'>,
  ) {
    return this.service.create({ ...body, id_condominio: idCondominio });
  }

  @Put(':id')
  update(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<CreatePrestadorDto>,
  ) {
    return this.service.update(id, body, idCondominio);
  }

  @Delete(':id')
  remove(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.service.remove(id, idCondominio);
    return { ok: true };
  }
}
