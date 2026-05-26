import { Controller, Get, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RelatoriosService } from './relatorios.service';

@Controller('condominios/:idCondominio/relatorios')
export class RelatoriosController {
  constructor(private readonly service: RelatoriosService) {}

  @Get()
  async download(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Res() res: Response,
    @Query('tipo') tipo: 'visitantes' | 'encomendas' | 'ocorrencias' | 'financeiro',
    @Query('formato') formato: 'pdf' | 'xlsx',
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    const { buffer, mime, filename } = await this.service.generate(
      idCondominio,
      tipo,
      formato,
      dataInicio,
      dataFim
    );

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get('auditoria')
  async getAuditoria(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
  ) {
    return this.service.getAuditoria(idCondominio);
  }
}
