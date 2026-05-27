import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query,
} from '@nestjs/common';
import { CreateEncomendaDto, EncomendasService } from './encomendas.service';

@Controller('condominios/:idCondominio/encomendas')
export class EncomendasController {
  constructor(private readonly service: EncomendasService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(idCondominio, status);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreateEncomendaDto, 'id_condominio'>,
  ) {
    return this.service.create({ ...body, id_condominio: idCondominio });
  }

  @Patch(':id/retirar')
  retirar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      retirado_por: string;
      retirado_doc?: string;
      retirado_assinatura?: string;
      retirado_foto?: string;
    },
  ) {
    return this.service.retirar(
      id,
      body.retirado_por,
      body.retirado_doc,
      body.retirado_assinatura,
      body.retirado_foto,
    );
  }

  @Patch(':id/notificar')
  notificar(@Param('id', ParseIntPipe) id: number) {
    return this.service.notificar(id);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    return { ok: true };
  }
}
