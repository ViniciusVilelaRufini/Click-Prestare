import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put,
} from '@nestjs/common';
import { VeiculosService } from './veiculos.service';
import type { VeiculoDto } from './veiculos.service';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';

// Rotas protegidas pelo TenantGuard global (valida acesso ao :idCondominio).
@Controller('condominios/:idCondominio')
export class VeiculosController {
  constructor(private readonly service: VeiculosService) {}

  @Get('moradores/:idMorador/veiculos')
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idMorador', ParseIntPipe) idMorador: number,
  ) {
    return this.service.findByMorador(idCondominio, idMorador);
  }

  @SkipAudit()
  @Post('moradores/:idMorador/veiculos')
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idMorador', ParseIntPipe) idMorador: number,
    @Body() body: VeiculoDto,
  ) {
    return this.service.create(idCondominio, idMorador, body);
  }

  @SkipAudit()
  @Put('veiculos/:id')
  update(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: VeiculoDto,
  ) {
    return this.service.update(idCondominio, id, body);
  }

  @SkipAudit()
  @Delete('veiculos/:id')
  remove(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(idCondominio, id);
  }
}
