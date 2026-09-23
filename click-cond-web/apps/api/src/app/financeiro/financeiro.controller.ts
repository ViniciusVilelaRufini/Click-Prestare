import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FinanceiroService } from './financeiro.service';
import { FechamentoService } from './fechamento.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertStaff, assertSindico, assertFinanceiroSomenteLeitura } from '../auth/tenant.util';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';

/**
 * O financeiro do condomínio é SOMENTE LEITURA dentro do Clique.
 *
 * A taxa condominial e o resto do que aparece nas telas vêm do ERP
 * Superlógica; o Clique espelha. Síndico e funcionário são leitores — as
 * rotas de mutação abaixo respondem 403 via `assertFinanceiroSomenteLeitura`.
 * Elas continuam existindo (em vez de sumir) porque o app já instalado no
 * celular do síndico segue chamando-as até ele atualizar, e um 403 com texto
 * explicativo é melhor que um 404 disfarçado de erro de conexão.
 *
 * Continuam escrevendo, e de propósito: as contas pessoais do morador
 * (`morador/*`), o job de recorrência e o sync da Superlógica. (Os gateways
 * Asaas e OpenPix foram removidos — não há mais webhook de pagamento.)
 */
@Controller('financeiro')
export class FinanceiroController {
  constructor(
    private readonly service: FinanceiroService,
    private readonly fechamento: FechamentoService,
  ) {}

  @SkipAudit()
  @Post('insert')
  @HttpCode(200)
  insert() {
    assertFinanceiroSomenteLeitura('lançar movimento financeiro');
  }

  @SkipAudit()
  @Post('update')
  @HttpCode(200)
  update() {
    assertFinanceiroSomenteLeitura('editar movimento financeiro');
  }

  @SkipAudit()
  @Post('remove')
  @HttpCode(200)
  remove() {
    assertFinanceiroSomenteLeitura('remover movimento financeiro');
  }

  @Get('get-all')
  getAll(
    @Query('id_condominio') idCondominio: string,
    @Query('mes') mes: string,
    @Query('ano') ano: string,
    @ReqUser() payload: JwtPayload,
    @Query('incluirTaxasCondominiais') incluirTaxasCondominiais?: string,
  ) {
    const isSindico = (payload?.typeAccess ?? payload?.user?.typeAccess) === 'Sindico';
    return this.service.getAll(
      Number(idCondominio), mes, ano, isSindico, payload,
      incluirTaxasCondominiais === 'true',
    );
  }

  @Get('get')
  get(@Query('id_condominio') idCondominio: string, @Query('id') id: string, @ReqUser() payload: JwtPayload) {
    return this.service.get(Number(idCondominio), Number(id), payload);
  }

  // As rotas de inadimplência abaixo são exclusivas do Síndico / Gestão (Art. 6º, III LGPD).
  // Elas expõem a situação financeira de TODOS os apartamentos (valor devido, PIX,
  // comprovante). Porteiros e moradores são BARRADOS para evitar exposição vexatória.
  @Get('moradores/get-all')
  getAllMoradores(
    @Query('id_condominio') idCondominio: string,
    @Query('mes') mes: string,
    @Query('ano') ano: string,
    @ReqUser() payload: JwtPayload,
  ) {
    assertSindico(payload, 'consultar as taxas dos moradores');
    return this.service.getAllMoradores(Number(idCondominio), mes, ano, payload);
  }

  @Get('inadimplentes/get-all')
  getAllInadimplentes(@Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    assertSindico(payload, 'consultar a lista de inadimplentes');
    return this.service.getAllInadimplentes(Number(idCondominio), payload);
  }

  @Get('inadimplencia/dashboard')
  inadimplenciaDashboard(
    @Query('id_condominio') idCondominio: string,
    @Query('mes') mes: string,
    @Query('ano') ano: string,
    @ReqUser() payload: JwtPayload,
  ) {
    assertSindico(payload, 'abrir o dashboard de inadimplência');
    return this.service.getInadimplenciaDashboard(Number(idCondominio), mes, ano, payload);
  }

  @Get('inadimplente/get')
  getInadimplenteDetail(
    @Query('id_condominio') idCondominio: string,
    @Query('apto') apto: string,
    @Query('bloco') bloco: string,
    @ReqUser() payload: JwtPayload,
  ) {
    assertSindico(payload, 'consultar a dívida de um apartamento');
    return this.service.getInadimplenteDetail(Number(idCondominio), apto, bloco, payload);
  }

  @Post('inadimplente/notificar')
  notifyInadimplente(
    @Body('id_condominio') idCondominio: string | number,
    @Body('apto') apto: string,
    @Body('bloco') bloco: string,
    @ReqUser() payload: JwtPayload,
  ) {
    assertSindico(payload, 'notificar inadimplente');
    return this.service.notifyInadimplente(Number(idCondominio), apto, bloco, payload);
  }

  // As leituras administrativas abaixo não tinham checagem de papel nenhuma.
  // Como `assertCondominio` (no service) só confirma VÍNCULO com o condomínio
  // — e morador tem vínculo —, na prática qualquer morador autenticado do
  // prédio alcançava todas elas. As mutações do módulo já exigiam staff desde
  // a auditoria de julho; as leituras ficaram de fora.
  //
  // Nenhuma delas é consumida por tela de morador: no app,
  // `getUserType() == 'morador'` manda para o MoradorFinanceiroView, que só
  // chama `get-all`. As demais telas (livro caixa, relatório, recorrência,
  // fechamento, CSV) são do síndico/funcionário, e na portaria-web a rota
  // /financeiro já é exclusiva do síndico.
  @Get('export-csv')
  async exportCsv(
    @Query('id_condominio') idCondominio: string,
    @Res() res: Response,
    @ReqUser() payload: JwtPayload,
    @Query('mes') mes?: string,
    @Query('ano') ano?: string,
    @Query('incluirTaxasCondominiais') incluirTaxasCondominiais?: string,
  ) {
    // O mais sensível do grupo: leva o livro caixa inteiro embora num arquivo,
    // pagos e em aberto, com o nome da fatura identificando apto e bloco.
    assertStaff(payload, 'exportar o livro caixa');
    const { buffer, filename } = await this.service.exportLivroCaixaCsv(
      Number(idCondominio),
      mes,
      ano,
      payload,
      incluirTaxasCondominiais === 'true',
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get('grafico/get-all')
  getGrafico(
    @Query('id_condominio') idCondominio: string,
    @Query('mes') mes: string,
    @Query('ano') ano: string,
    @ReqUser() payload: JwtPayload,
  ) {
    assertStaff(payload, 'abrir o relatório gráfico do condomínio');
    return this.service.getGrafico(Number(idCondominio), mes, ano, payload);
  }

  @Get('config-auto')
  getConfigAuto(@Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    // Devolve chave_pix, valor da taxa e a régua de cobrança inteira.
    assertStaff(payload, 'consultar a configuração de cobrança');
    return this.service.getConfigAuto(Number(idCondominio), payload);
  }

  @Post('config-auto')
  @HttpCode(200)
  updateConfigAuto() {
    assertFinanceiroSomenteLeitura('configurar cobrança automática');
  }

  @Get('apartamentos-config')
  getApartamentosConfig(@Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    // Revela quais unidades estão isentas da recorrência.
    assertStaff(payload, 'consultar a configuração dos apartamentos');
    return this.service.getApartamentosConfig(Number(idCondominio), payload);
  }

  @Post('apartamento-recorrencia')
  @HttpCode(200)
  updateApartamentoRecorrencia() {
    assertFinanceiroSomenteLeitura('configurar recorrência de apartamento');
  }

  @Get('get-by-user')
  getByUser(@Query('id_user') idUser: string, @Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    const typeAccess = payload?.typeAccess ?? payload?.user?.typeAccess;
    const isSindico = typeAccess === 'Sindico' || typeAccess === 'Admin' || typeAccess === 'Administradora';
    const currentUserId = payload?.user?.id ?? payload?.sub;
    // Somente Síndico/Admin pode consultar o extrato financeiro de outro usuário.
    // Para qualquer outro papel (Morador, Porteiro, Funcionário), força o id_user
    // da própria sessão para impedir espionagem de contas pessoais e boletos.
    const targetUserId = isSindico && idUser ? Number(idUser) : Number(currentUserId);
    return this.service.getByUser(targetUserId, Number(idCondominio), payload);
  }

  @Post('morador/insert')
  @HttpCode(200)
  insertMoradorConta(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id_condominio: string | number; data: any }
  ) {
    const userId = payload?.user?.id ?? payload?.sub;
    return this.service.insertMoradorConta(Number(userId), Number(body.id_condominio), body.data, payload);
  }

  @Post('morador/update')
  @HttpCode(200)
  updateMoradorConta(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id_condominio: string | number; data: any }
  ) {
    const userId = payload?.user?.id ?? payload?.sub;
    return this.service.updateMoradorConta(Number(userId), Number(body.id_condominio), body.data);
  }

  @Post('morador/remove')
  @HttpCode(200)
  removeMoradorConta(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id: string | number }
  ) {
    const userId = payload?.user?.id ?? payload?.sub;
    return this.service.removeMoradorConta(Number(userId), Number(body.id));
  }

  @Post('morador/anexar-codigo')
  @HttpCode(200)
  anexarCodigo(
    @Body() body: { id: string | number; linha_digitavel?: string; pix_copia_cola?: string; codigo_barras?: string },
    @ReqUser() payload: JwtPayload,
  ) {
    const userId = payload?.user?.id ?? payload?.sub;
    return this.service.anexarCodigoMorador(Number(userId), Number(body.id), {
      linha_digitavel: body.linha_digitavel || body.codigo_barras,
      pix_copia_cola: body.pix_copia_cola,
    });
  }

  @Post('upload-shared-file')
  @HttpCode(200)
  uploadSharedFile(
    @Body() body: { id: string | number; file: string; type: string },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.uploadSharedFile(Number(body.id), body.file, body.type, payload);
  }

  @SkipAudit()
  @Post('update-status')
  @HttpCode(200)
  updateStatus() {
    // Some com a "segregação soft" (motivo + forma de pagamento quando o
    // operador dá baixa no que ele mesmo lançou): não há mais baixa manual.
    // Quem marca como pago agora é o sync do ERP (Superlógica).
    assertFinanceiroSomenteLeitura('dar baixa em um lançamento');
  }

  @SkipAudit()
  @Post('admin/limpar-cobrancas-zeradas')
  @HttpCode(200)
  adminLimparCobrancasZeradas(
    @Body() body: { id_condominio: string | number },
    @ReqUser() payload: JwtPayload,
  ) {
    // Limpeza destrutiva de dados — só o administrador da operadora. O
    // síndico saiu da lista junto com o resto da escrita: com o financeiro
    // somente leitura, apagar cobrança em massa virou operação de suporte.
    const typeAccess = payload?.typeAccess ?? payload?.user?.typeAccess;
    if (typeAccess !== 'Admin') {
      throw new ForbiddenException('Apenas o administrador pode executar a limpeza de dados.');
    }
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? payload?.nome ?? 'Administrador';
    return this.service.adminLimparCobrancasZeradas(Number(body.id_condominio), operatorName, payload);
  }

  @SkipAudit()
  @Post('rateio')
  @HttpCode(200)
  createRateio() {
    assertFinanceiroSomenteLeitura('criar rateio');
  }

  @SkipAudit()
  @Post('inadimplente/acordo')
  @HttpCode(200)
  createAcordoInadimplente() {
    assertFinanceiroSomenteLeitura('firmar acordo de inadimplência');
  }

  @Post('conciliacao/importar')
  @HttpCode(200)
  importarOfx() {
    assertFinanceiroSomenteLeitura('importar conciliação bancária');
  }

  @SkipAudit()
  @Post('conciliacao/confirmar')
  @HttpCode(200)
  confirmarConciliacao() {
    assertFinanceiroSomenteLeitura('confirmar conciliação bancária');
  }

  // ============== Fechamento Mensal ==============

  @Get('fechamentos')
  listarFechamentos(
    @Query('id_condominio') idCondominio: string,
    @ReqUser() payload: JwtPayload,
  ) {
    // Quem fechou, quando, observação e motivo de reabertura.
    assertStaff(payload, 'consultar as competências fechadas');
    return this.fechamento.listar(Number(idCondominio), payload);
  }

  @SkipAudit()
  @Post('fechamentos/fechar')
  @HttpCode(200)
  fecharMes() {
    assertFinanceiroSomenteLeitura('fechar competência');
  }

  @SkipAudit()
  @Post('fechamentos/reabrir')
  @HttpCode(200)
  reabrirMes() {
    assertFinanceiroSomenteLeitura('reabrir competência');
  }
}
