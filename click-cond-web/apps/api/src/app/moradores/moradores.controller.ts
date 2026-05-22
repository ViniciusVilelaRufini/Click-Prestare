import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import { CreateMoradorDto, MoradoresService } from './moradores.service';

@Controller('condominios/:idCondominio/moradores')
export class MoradoresController {
  constructor(private readonly service: MoradoresService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('search') search?: string,
    @Query('id_apto') idApto?: string,
  ) {
    return this.service.findAll(idCondominio, search, idApto ? Number(idApto) : undefined);
  }

  @Get('export-excel')
  exportExcel(@Param('idCondominio', ParseIntPipe) idCondominio: number) {
    return this.service.exportExcel(idCondominio);
  }

  @Post('import-bulk')
  importBulk(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: { linhas: any[] },
  ) {
    return this.service.importBulk(idCondominio, body.linhas);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreateMoradorDto, 'id_condominio'>,
  ) {
    return this.service.create({ ...body, id_condominio: idCondominio });
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<CreateMoradorDto>,
  ) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    this.service.remove(id);
    return { ok: true };
  }

  @Post(':id/send-credentials')
  sendCredentials(@Param('id', ParseIntPipe) id: number) {
    return this.service.sendCredentials(id);
  }
}
