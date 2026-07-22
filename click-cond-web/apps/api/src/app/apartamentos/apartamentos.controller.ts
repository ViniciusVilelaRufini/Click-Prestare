import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import { ApartamentosService, CreateApartamentoDto } from './apartamentos.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('condominios/:idCondominio/apartamentos')
export class ApartamentosController {
  constructor(private readonly service: ApartamentosService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(idCondominio, search);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @ReqUser() payload: JwtPayload) {
    return this.service.findOne(id, payload);
  }

  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreateApartamentoDto, 'id_condominio'>,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.create({ ...body, id_condominio: idCondominio }, payload);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<CreateApartamentoDto>,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.update(id, body, payload);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @ReqUser() payload: JwtPayload) {
    this.service.remove(id, payload);
    return { ok: true };
  }

  @Post('import-bulk')
  importBulk(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: { linhas: any[] },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.importBulk(idCondominio, body.linhas, payload);
  }
}
