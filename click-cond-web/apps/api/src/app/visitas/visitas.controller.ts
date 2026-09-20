import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { VisitasService } from './visitas.service';
import { CriarVisitaDto } from './dto/criar-visita.dto';

@Controller('condominios/:idCondominio/visitas')
export class VisitasController {
  constructor(private readonly service: VisitasService) {}

  @Get('presenca')
  async listarPresenca(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
  ) {
    return this.service.listarPresenca(idCondominio);
  }

  @Get()
  async listar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
  ) {
    return this.service.listarVisitasCondominio(idCondominio);
  }

  @Post()
  async criar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() dto: CriarVisitaDto,
  ) {
    return this.service.criarVisita({ ...dto, id_condominio: idCondominio });
  }

  @Put(':idVisita/entrada')
  async registrarEntrada(
    @Param('idVisita', ParseIntPipe) idVisita: number,
  ) {
    return this.service.registrarEntrada(idVisita);
  }

  @Put(':idVisita/saida')
  async registrarSaida(
    @Param('idVisita', ParseIntPipe) idVisita: number,
  ) {
    return this.service.registrarSaida(idVisita);
  }
}
