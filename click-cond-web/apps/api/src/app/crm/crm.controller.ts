import { Controller, Get, Post, Put, Body, Res, NotFoundException, Param, ParseIntPipe, UseGuards, SetMetadata } from '@nestjs/common';
import { CrmService } from './crm.service';
import { CrmAdminGuard } from './crm-admin.guard';

/**
 * CRM comercial — visão da operadora (Click Prestare) sobre seus condomínios-cliente.
 * Escopo cross-condomínio (administrativo), não filtrado por tenant.
 *
 * Protegido por CrmAdminGuard: só tokens com role 'crm_admin' (emitidos pelo
 * login do CRM) acessam estes dados. Token de porteiro é rejeitado com 403.
 *
 * Exceção: GET /crm/health é público para health check de infraestrutura.
 */
@Controller('crm')
export class CrmController {
  constructor(private readonly service: CrmService) {}

  /**
   * Health check público — retorna status de conexão do banco, latência e
   * modo de dados (live/mock). Não requer autenticação.
   */
  @Get('health')
  health() {
    return this.service.healthCheck();
  }

  @UseGuards(CrmAdminGuard)
  @Get('overview')
  overview() {
    return this.service.overview();
  }

  @UseGuards(CrmAdminGuard)
  @Get('clientes')
  clientes() {
    return this.service.clientes();
  }

  @UseGuards(CrmAdminGuard)
  @Get('clientes/:id')
  async cliente(@Param('id', ParseIntPipe) id: number) {
    const cliente = await this.service.cliente(id);
    if (!cliente) throw new NotFoundException('Cliente não encontrado');
    return cliente;
  }

  @UseGuards(CrmAdminGuard)
  @Put('clientes/:id')
  async atualizar(@Param('id', ParseIntPipe) id: number, @Body() data: any) {
    const atualizado = await this.service.atualizarCliente(id, data);
    if (!atualizado) throw new NotFoundException('Cliente não encontrado');
    return { success: true, data: atualizado };
  }

  @UseGuards(CrmAdminGuard)
  @Get('clientes/:id/exportar')
  async exportar(@Param('id', ParseIntPipe) id: number, @Res() res: any) {
    const csv = await this.service.exportarClienteCsv(id);
    if (!csv) throw new NotFoundException('Cliente não encontrado ou offline');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=crm-relatorio-condominio-${id}.csv`);
    return res.send(csv);
  }

  @UseGuards(CrmAdminGuard)
  @Get('ocorrencias')
  async ocorrencias() {
    return this.service.ocorrencias();
  }

  @UseGuards(CrmAdminGuard)
  @Put('ocorrencias/:id')
  async responderOcorrencia(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { resposta: string }
  ) {
    const atualizado = await this.service.responderOcorrencia(id, body.resposta);
    if (!atualizado) throw new NotFoundException('Ocorrência não encontrada');
    return { success: true, data: atualizado };
  }

  @UseGuards(CrmAdminGuard)
  @Post('ocorrencias')
  async criarOcorrencia(
    @Body() body: { idCondominio: number; descricao: string; tipo?: number }
  ) {
    const criada = await this.service.criarOcorrencia(body.idCondominio, body.descricao, body.tipo);
    return { success: true, data: criada };
  }

  @UseGuards(CrmAdminGuard)
  @Get('ocorrencias/:id/mensagens')
  async listMessages(@Param('id', ParseIntPipe) id: number) {
    return this.service.listMessages(id);
  }

  @UseGuards(CrmAdminGuard)
  @Post('ocorrencias/:id/mensagens')
  async createMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { mensagem: string }
  ) {
    return this.service.createMessage(id, body.mensagem);
  }

  @UseGuards(CrmAdminGuard)
  @Put('ocorrencias/:id/reabrir')
  async reabrirOcorrencia(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { novasInformacoes: string }
  ) {
    const atualizado = await this.service.reabrirOcorrencia(id, body.novasInformacoes);
    if (!atualizado) throw new NotFoundException('Ocorrência não encontrada');
    return { success: true, data: atualizado };
  }
}


