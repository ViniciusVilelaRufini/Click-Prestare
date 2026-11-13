import { Controller, ForbiddenException, Get, Optional, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RelatoriosService } from './relatorios.service';
import { CondominiosExportService } from './condominios-export.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador, assertSindico, isSindico } from '../auth/tenant.util';
import { TenantAccessService, ehFuncionarioDoApp } from '../auth/tenant-access.service';
import { dataIsoOuErro, inteiroPositivoOuPadrao, textoUnico } from './relatorios-query.util';

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
  constructor(
    private readonly service: RelatoriosService,
    private readonly exportService?: CondominiosExportService,
    // Global (TenantAccessModule). Opcional só porque vários specs instanciam o controller sem ele;
    // sem ele, o funcionário do app é recusado (nunca liberado) — ver recorteOcorrencias.
    @Optional() private readonly tenant?: TenantAccessService,
  ) {}

  /** Funcionário do app: recorte das ocorrências privadas; demais papéis: null (sem consulta). */
  private async recorteOcorrencias(idCondominio: number, payload: JwtPayload): Promise<number | null> {
    if (!ehFuncionarioDoApp(payload)) return null;
    if (!this.tenant) throw new ForbiddenException('Acesso negado.');
    return this.tenant.recorteOcorrenciasPrivadas(idCondominio, payload);
  }

  @Get('export')
  async exportDadosCondominio(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Res() res: Response,
    @ReqUser() payload: JwtPayload,
  ) {
    assertSindico(payload, 'exportar os dados completos do condomínio');
    if (!this.exportService) {
      res.status(500).send('Serviço de exportação indisponível');
      return;
    }
    const { buffer, filename } = await this.exportService.gerarPacoteExportacao(idCondominio, {
      nome: payload.nome || payload.email,
      email: payload.email,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get()
  async download(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Res() res: Response,
    @ReqUser() payload: JwtPayload,
    @Query('tipo') tipo: 'visitantes' | 'encomendas' | 'ocorrencias' | 'financeiro',
    @Query('formato') formato: 'pdf' | 'xlsx',
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string,
    @Query('bloco') bloco?: string,
    @Query('apto') apto?: string,
  ) {
    if (tipo === 'financeiro') {
      assertSindico(payload, 'baixar o relatório financeiro do condomínio');
    } else {
      assertOperador(payload, 'baixar relatórios operacionais do condomínio');
    }
    // Exporta TODAS as ocorrências (descrição, resposta, autor): o funcionário do app sem a flag
    // `ocorrencias` não lê as privadas em lugar nenhum, então não baixa o relatório.
    if (tipo === 'ocorrencias' && ehFuncionarioDoApp(payload)) {
      if (!this.tenant) throw new ForbiddenException('Acesso negado.');
      await this.tenant.assertPermissaoFuncionario(idCondominio, 'ocorrencias', payload);
    }
    const { buffer, mime, filename } = await this.service.generate(
      idCondominio,
      tipo,
      formato,
      dataInicio,
      dataFim,
      bloco,
      apto,
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
    @Query('modulo') modulo?: unknown,
    @Query('dataInicio') dataInicio?: unknown,
    @Query('dataFim') dataFim?: unknown,
    @Query('page') pageStr?: unknown,
    @Query('pageSize') pageSizeStr?: unknown,
  ) {
    assertOperador(payload, 'consultar a auditoria do condomínio');
    // Financeiro/CRM/Superlógica no log carregam valores, nomes e telefone de
    // cobrança: só o síndico lê essas linhas (o porteiro recebe a lista sem elas).
    // As de `ocorrencias` trazem o texto da ocorrência: o funcionário do app sem a flag não as lê.
    const ocultarOcorrencias = (await this.recorteOcorrencias(idCondominio, payload)) !== null;
    return this.service.getAuditoria(
      idCondominio,
      textoUnico(modulo),
      dataIsoOuErro(dataInicio, 'dataInicio'),
      dataIsoOuErro(dataFim, 'dataFim'),
      inteiroPositivoOuPadrao(pageStr, 1),
      inteiroPositivoOuPadrao(pageSizeStr, 50),
      isSindico(payload),
      ocultarOcorrencias,
    );
  }

  @Get('auditoria/export')
  async exportAuditoria(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Res() res: Response,
    @ReqUser() payload: JwtPayload,
    @Query('modulo') modulo?: unknown,
    @Query('dataInicio') dataInicio?: unknown,
    @Query('dataFim') dataFim?: unknown,
  ) {
    assertSindico(payload, 'exportar a auditoria do condomínio');
    const { buffer, filename } = await this.service.exportAuditoriaCsv(
      idCondominio,
      textoUnico(modulo),
      dataIsoOuErro(dataInicio, 'dataInicio'),
      dataIsoOuErro(dataFim, 'dataFim'),
      { nome: payload.nome || payload.email, email: payload.email },
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
    @Query('dataInicio') dataInicio?: unknown,
    @Query('dataFim') dataFim?: unknown,
    @Query('page') pageStr?: unknown,
    @Query('pageSize') pageSizeStr?: unknown,
    @Query('search') search?: unknown,
  ) {
    assertOperador(payload, 'consultar o histórico de eventos');
    const inicio = dataIsoOuErro(dataInicio, 'dataInicio');
    const fim = dataIsoOuErro(dataFim, 'dataFim');
    return this.service.getEventos(
      idCondominio,
      inicio,
      fim,
      inteiroPositivoOuPadrao(pageStr, 1),
      inteiroPositivoOuPadrao(pageSizeStr, 50),
      textoUnico(search),
      await this.recorteOcorrencias(idCondominio, payload),
    );
  }
}

/**
 * Controller dedicado para a rota raiz de condomínio: GET /condominios/:idCondominio/export
 * Conforme Cláusula 9.5 do Contrato e DPA 11.2 (LGPD).
 */
@Controller('condominios/:idCondominio')
export class CondominiosExportController {
  constructor(private readonly exportService: CondominiosExportService) {}

  @Get('export')
  async exportDados(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Res() res: Response,
    @ReqUser() payload: JwtPayload,
  ) {
    assertSindico(payload, 'exportar os dados completos do condomínio');
    const { buffer, filename } = await this.exportService.gerarPacoteExportacao(idCondominio, {
      nome: payload.nome || payload.email,
      email: payload.email,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}
