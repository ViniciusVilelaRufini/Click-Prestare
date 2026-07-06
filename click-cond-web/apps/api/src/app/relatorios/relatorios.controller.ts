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
    @Query('modulo') modulo?: string,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
  ) {
    const page = pageStr ? Number(pageStr) : 1;
    const pageSize = pageSizeStr ? Number(pageSizeStr) : 50;
    return this.service.getAuditoria(idCondominio, modulo, dataInicio, dataFim, page, pageSize);
  }

  @Get('auditoria/export')
  async exportAuditoria(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Res() res: Response,
    @Query('modulo') modulo?: string,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    const { buffer, filename } = await this.service.exportAuditoriaCsv(
      idCondominio,
      modulo,
      dataInicio,
      dataFim,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get('eventos')
  async getEventos(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('search') search?: string,
  ) {
    const page = pageStr ? Number(pageStr) : 1;
    const pageSize = pageSizeStr ? Number(pageSizeStr) : 50;
    return this.service.getEventos(idCondominio, dataInicio, dataFim, page, pageSize, search);
  }
}
