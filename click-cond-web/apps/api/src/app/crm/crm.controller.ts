import { Controller, Get, Post, Put, Delete, Body, Query, Res, NotFoundException, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { CrmService } from './crm.service';
import { CrmCondominiosService } from './crm-condominios.service';
import type { CriarCondominioDto } from './crm-condominios.service';
import { CrmFaturasService } from './crm-faturas.service';
import { CrmAdminGuard } from './crm-admin.guard';
import { MoradoresService } from '../moradores/moradores.service';
import { ApartamentosService } from '../apartamentos/apartamentos.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

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
  constructor(
    private readonly service: CrmService,
    private readonly condominios: CrmCondominiosService,
    private readonly faturas: CrmFaturasService,
    private readonly moradores: MoradoresService,
    private readonly apartamentos: ApartamentosService,
  ) {}

  private operador(payload?: JwtPayload): string {
    return (payload as any)?.nome ?? (payload as any)?.user?.name ?? (payload as any)?.email ?? 'Admin CRM';
  }

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

  // ============== Ciclo de vida do condomínio ==============
  //
  // A exclusão é em duas fases de propósito: desativar corta o acesso e é
  // reversível; a purga apaga em cascata e exige o condomínio já desativado
  // mais o nome digitado por extenso. Ver CrmCondominiosService.

  @UseGuards(CrmAdminGuard)
  @Post('clientes')
  criar(@Body() dto: CriarCondominioDto, @ReqUser() user: JwtPayload) {
    return this.condominios.criar(dto, this.operador(user));
  }

  @UseGuards(CrmAdminGuard)
  @Post('clientes/:id/desativar')
  async desativar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { motivo?: string },
    @ReqUser() user: JwtPayload,
  ) {
    const resumo = await this.condominios.desativar(id, body?.motivo ?? '', this.operador(user));
    return { success: true, data: resumo };
  }

  @UseGuards(CrmAdminGuard)
  @Post('clientes/:id/reativar')
  reativar(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.condominios.reativar(id, this.operador(user));
  }

  /** Exclusão definitiva. `confirmacao` deve repetir o nome do condomínio. */
  @UseGuards(CrmAdminGuard)
  @Delete('clientes/:id')
  purgar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { confirmacao?: string },
    @ReqUser() user: JwtPayload,
  ) {
    return this.condominios.purgar(id, body?.confirmacao ?? '', this.operador(user));
  }

  /**
   * Redefine a senha do síndico e devolve a nova em texto claro.
   * Não existe rota para ler a senha atual: o banco guarda bcrypt.
   */
  @UseGuards(CrmAdminGuard)
  @Post('clientes/:id/sindico/senha')
  redefinirSenhaSindico(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { senha?: string },
    @ReqUser() user: JwtPayload,
  ) {
    return this.condominios.redefinirSenhaSindico(id, body?.senha, this.operador(user));
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

  // ============== Operação do condomínio (visão da operadora) ==============
  //
  // O CRM não consome /condominios/:id/moradores nem /condominios/:id/apartamentos:
  // aquelas rotas passam pelo TenantGuard, que exige um vínculo de tenant que o
  // token do CRM não tem (crm_admin não pertence a nenhum condomínio) — e por isso
  // respondiam 403, deixando a aba de moradores sempre vazia. Aqui a autorização é
  // o CrmAdminGuard, coerente com o resto do CRM, sem afrouxar o guard dos tenants.

  @UseGuards(CrmAdminGuard)
  @Get('clientes/:id/moradores')
  listarMoradores(
    @Param('id', ParseIntPipe) id: number,
    @Query('search') search?: string,
  ) {
    return this.moradores.findAll(id, search);
  }

  @UseGuards(CrmAdminGuard)
  @Post('clientes/:id/moradores')
  criarMorador(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: any,
    @ReqUser() user: JwtPayload,
  ) {
    return this.moradores.create({ ...dto, id_condominio: id }, user);
  }

  @UseGuards(CrmAdminGuard)
  @Get('clientes/:id/apartamentos')
  listarApartamentos(
    @Param('id', ParseIntPipe) id: number,
    @Query('search') search?: string,
  ) {
    return this.apartamentos.findAll(id, search);
  }

  @UseGuards(CrmAdminGuard)
  @Post('clientes/:id/apartamentos')
  criarApartamento(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: any,
    @ReqUser() user: JwtPayload,
  ) {
    return this.apartamentos.create({ ...dto, id_condominio: id }, user);
  }

  @UseGuards(CrmAdminGuard)
  @Put('clientes/:id/apartamentos/:idApto')
  atualizarApartamento(
    @Param('idApto', ParseIntPipe) idApto: number,
    @Body() dto: any,
    @ReqUser() user: JwtPayload,
  ) {
    return this.apartamentos.update(idApto, dto, user);
  }

  /** Remove a unidade. A resposta traz `arrastados`: o que caiu em cascata. */
  @UseGuards(CrmAdminGuard)
  @Delete('clientes/:id/apartamentos/:idApto')
  removerApartamento(
    @Param('idApto', ParseIntPipe) idApto: number,
    @ReqUser() user: JwtPayload,
  ) {
    return this.apartamentos.remove(idApto, user);
  }

  /** Criação em lote de unidades (blocos × andares × unidades por andar). */
  @UseGuards(CrmAdminGuard)
  @Post('clientes/:id/apartamentos/lote')
  criarApartamentosLote(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { blocos: string[]; andares: number; porAndar: number },
    @ReqUser() user: JwtPayload,
  ) {
    return this.condominios.gerarApartamentos(id, body, this.operador(user));
  }

  /** Terminais faciais do condomínio, um a um, com online/offline real. */
  @UseGuards(CrmAdminGuard)
  @Get('clientes/:id/terminais')
  listarTerminais(@Param('id', ParseIntPipe) id: number) {
    return this.service.terminaisFaciais(id);
  }

  // ============== Faturamento real ==============

  @UseGuards(CrmAdminGuard)
  @Get('faturas')
  listarFaturas() {
    return this.faturas.listarFaturas();
  }

  @UseGuards(CrmAdminGuard)
  @Post('faturas/gerar')
  gerarFaturas(@Body() body: { referencia?: string }, @ReqUser() payload: JwtPayload) {
    return this.faturas.gerarFaturasDoMes(body?.referencia, this.operador(payload));
  }

  @UseGuards(CrmAdminGuard)
  @Post('faturas/:id/baixa')
  baixarFatura(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { metodo?: string; motivo?: string; dataPagamento?: string; valorPago?: number },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.faturas.baixarFatura(id, body ?? {}, this.operador(payload));
  }

  @UseGuards(CrmAdminGuard)
  @Post('faturas/:id/cobrar-whatsapp')
  cobrarWhatsApp(@Param('id', ParseIntPipe) id: number, @ReqUser() payload: JwtPayload) {
    return this.faturas.cobrarWhatsApp(id, this.operador(payload));
  }

  @UseGuards(CrmAdminGuard)
  @Get('config')
  getConfig() {
    return this.faturas.getConfig();
  }

  @UseGuards(CrmAdminGuard)
  @Post('config')
  setConfig(@Body() body: Record<string, unknown>, @ReqUser() payload: JwtPayload) {
    return this.faturas.setConfig(body ?? {}, this.operador(payload));
  }

  @UseGuards(CrmAdminGuard)
  @Get('config/gateways-status')
  gatewaysStatus() {
    return this.faturas.gatewaysStatus();
  }

  @UseGuards(CrmAdminGuard)
  @Get('disparos')
  listarDisparos() {
    return this.faturas.listarDisparos();
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


