import { Controller, Get, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RelatoriosService } from './relatorios.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador, assertSindico } from '../auth/tenant.util';

/**
 * Relatórios gerenciais do condomínio.
 *
 * O TenantGuard já garante, pelo :idCondominio da rota, que o solicitante
 * pertence ao condomínio — mas morador também pertence.
 * Relatórios operacionais (visitantes, encomendas, ocorrências) são permitidos para operadores.
 * Relatório financeiro e exportação de auditoria são restritos ao Síndico (LGPD e sigilo financeiro).
 */
@Controller('condominios/:idCondominio/relatorios')
export class RelatoriosController {
  constructor(private readonly service: RelatoriosService) {}

  @Get()
  async download(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Res() res: Response,
    @ReqUser() payload: JwtPayload,
    @Query('tipo') tipo: 'visitantes' | 'encomendas' | 'ocorrencias' | 'financeiro',
    @Query('formato') formato: 'pdf' | 'xlsx',
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    if (tipo === 'financeiro') {
      assertSindico(payload, 'baixar o relatório financeiro do condomínio');
    } else {
      assertOperador(payload, 'baixar relatórios operacionais do condomínio');
    }
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
    @ReqUser() payload: JwtPayload,
    @Query('modulo') modulo?: string,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
  ) {
    assertOperador(payload, 'consultar a auditoria do condomínio');
    const page = pageStr ? Number(pageStr) : 1;
    const pageSize = pageSizeStr ? Number(pageSizeStr) : 50;
    return this.service.getAuditoria(idCondominio, modulo, dataInicio, dataFim, page, pageSize);
  }

  @Get('auditoria/export')
  async exportAuditoria(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Res() res: Response,
    @ReqUser() payload: JwtPayload,
    @Query('modulo') modulo?: string,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
  ) {
    assertSindico(payload, 'exportar a auditoria do condomínio');
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
    @ReqUser() payload: JwtPayload,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('search') search?: string,
  ) {
    assertOperador(payload, 'consultar o histórico de eventos');
    const page = pageStr ? Number(pageStr) : 1;
    const pageSize = pageSizeStr ? Number(pageSizeStr) : 50;
    return this.service.getEventos(idCondominio, dataInicio, dataFim, page, pageSize, search);
  }
}
