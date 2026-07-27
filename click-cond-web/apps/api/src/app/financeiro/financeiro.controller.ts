import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { FinanceiroService } from './financeiro.service';
import { FechamentoService } from './fechamento.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { Public } from '../auth/public.decorator';
import { assertStaff } from '../auth/tenant.util';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';

@Controller('financeiro')
export class FinanceiroController {
  constructor(
    private readonly service: FinanceiroService,
    private readonly fechamento: FechamentoService,
  ) {}

  @SkipAudit()
  @Post('insert')
  @HttpCode(200)
  insert(
    @Body() body: { id_condominio: string | number; financeiro: any },
    @ReqUser() payload: JwtPayload,
  ) {
    assertStaff(payload, 'lançar movimento financeiro');
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? payload?.nome ?? 'Administrador';
    return this.service.insert(Number(body.id_condominio), body.financeiro, operatorName, payload);
  }

  @SkipAudit()
  @Post('update')
  @HttpCode(200)
  update(
    @Body() body: { id_condominio: string | number; financeiro: any },
    @ReqUser() payload: JwtPayload,
  ) {
    assertStaff(payload, 'editar movimento financeiro');
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? payload?.nome ?? 'Administrador';
    return this.service.update(Number(body.id_condominio), body.financeiro, operatorName, payload);
  }

  @SkipAudit()
  @Post('remove')
  @HttpCode(200)
  remove(@Body() body: { id: string | number }, @ReqUser() payload: JwtPayload) {
    assertStaff(payload, 'remover movimento financeiro');
    return this.service.remove(Number(body.id), payload);
  }

  @Get('get-all')
  getAll(
    @Query('id_condominio') idCondominio: string,
    @Query('mes') mes: string,
    @Query('ano') ano: string,
    @ReqUser() payload: JwtPayload,
  ) {
    const isSindico = (payload?.typeAccess ?? payload?.user?.typeAccess) === 'Sindico';
    return this.service.getAll(Number(idCondominio), mes, ano, isSindico, payload);
  }

  @Get('get')
  get(@Query('id_condominio') idCondominio: string, @Query('id') id: string, @ReqUser() payload: JwtPayload) {
    return this.service.get(Number(idCondominio), Number(id), payload);
  }

  @Get('moradores/get-all')
  getAllMoradores(
    @Query('id_condominio') idCondominio: string,
    @Query('mes') mes: string,
    @Query('ano') ano: string,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.getAllMoradores(Number(idCondominio), mes, ano, payload);
  }

  @Get('inadimplentes/get-all')
  getAllInadimplentes(@Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    return this.service.getAllInadimplentes(Number(idCondominio), payload);
  }

  @Get('inadimplencia/dashboard')
  inadimplenciaDashboard(
    @Query('id_condominio') idCondominio: string,
    @Query('mes') mes: string,
    @Query('ano') ano: string,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.getInadimplenciaDashboard(Number(idCondominio), mes, ano, payload);
  }

  @Get('inadimplente/get')
  getInadimplenteDetail(
    @Query('id_condominio') idCondominio: string,
    @Query('apto') apto: string,
    @Query('bloco') bloco: string,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.getInadimplenteDetail(Number(idCondominio), apto, bloco, payload);
  }

  @Post('inadimplente/notificar')
  notifyInadimplente(
    @Body('id_condominio') idCondominio: string | number,
    @Body('apto') apto: string,
    @Body('bloco') bloco: string,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.notifyInadimplente(Number(idCondominio), apto, bloco, payload);
  }

  @Get('export-csv')
  async exportCsv(
    @Query('id_condominio') idCondominio: string,
    @Res() res: Response,
    @ReqUser() payload: JwtPayload,
    @Query('mes') mes?: string,
    @Query('ano') ano?: string,
  ) {
    const { buffer, filename } = await this.service.exportLivroCaixaCsv(
      Number(idCondominio),
      mes,
      ano,
      payload,
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
    return this.service.getGrafico(Number(idCondominio), mes, ano, payload);
  }

  @Get('config-auto')
  getConfigAuto(@Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    return this.service.getConfigAuto(Number(idCondominio), payload);
  }

  @Post('config-auto')
  @HttpCode(200)
  updateConfigAuto(
    @Body() body: { id_condominio: string | number; config: any },
    @ReqUser() payload: JwtPayload,
  ) {
    assertStaff(payload, 'configurar cobrança automática');
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? payload?.nome ?? 'Administrador';
    return this.service.updateConfigAuto(Number(body.id_condominio), body.config, operatorName, payload);
  }

  @Get('apartamentos-config')
  getApartamentosConfig(@Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    return this.service.getApartamentosConfig(Number(idCondominio), payload);
  }

  @Post('apartamento-recorrencia')
  @HttpCode(200)
  updateApartamentoRecorrencia(
    @Body() body: { id_condominio: string | number; aptoId: string | number; ignorar: boolean },
    @ReqUser() payload: JwtPayload,
  ) {
    assertStaff(payload, 'configurar recorrência de apartamento');
    return this.service.updateApartamentoRecorrencia(Number(body.id_condominio), Number(body.aptoId), body.ignorar, payload);
  }

  @Get('get-by-user')
  getByUser(@Query('id_user') idUser: string, @Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    const typeAccess = payload?.typeAccess ?? payload?.user?.typeAccess;
    const isMorador = typeAccess === 'Morador';
    const currentUserId = payload?.user?.id ?? payload?.sub;
    // Morador SEMPRE recebe os próprios lançamentos, ignorando qualquer
    // id_user que ele tente passar (impede ler dados de outro morador).
    const targetUserId = isMorador ? Number(currentUserId) : Number(idUser);
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

  // Morador anexa o código escaneado (linha digitável / PIX) à própria conta.
  @Post('morador/anexar-codigo')
  @HttpCode(200)
  anexarCodigoMorador(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id: string | number; linha_digitavel?: string; pix_copia_cola?: string },
  ) {
    const userId = payload?.user?.id ?? payload?.sub;
    return this.service.anexarCodigoMorador(Number(userId), Number(body.id), {
      linha_digitavel: body.linha_digitavel,
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
  updateStatus(
    @Body() body: {
      id: string | number;
      status: string | number;
      // Campos opcionais — só obrigatórios quando autor=operador (segregação soft).
      motivo?: string;
      formaPagamento?: string;
      identificadorComprovante?: string;
    },
    @ReqUser() payload: JwtPayload,
  ) {
    assertStaff(payload, 'alterar status de pagamento');
    return this.service.updateStatus(Number(body.id), body.status, payload, {
      motivo: body.motivo,
      formaPagamento: body.formaPagamento,
      identificadorComprovante: body.identificadorComprovante,
    });
  }

  @Public()
  @SkipAudit()
  @Post('webhook/asaas')
  @HttpCode(200)
  handleAsaasWebhook(
    @Body() body: any,
    @Headers('asaas-access-token') asaasToken?: string,
  ) {
    // Validação de token: Asaas envia o token configurado no painel via
    // header `asaas-access-token`. Sem essa checagem, qualquer pessoa na
    // internet manda POST com event=PAYMENT_RECEIVED e marca dívidas como
    // pagas no nosso banco — fraude trivial.
    //
    // Configurar via env ASAAS_WEBHOOK_TOKEN no Railway, e usar o mesmo
    // valor no painel do Asaas (Configurações → Webhooks).
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    if (!expected) {
      // Sem token configurado, recusa por padrão. Operador deve definir
      // ASAAS_WEBHOOK_TOKEN antes de habilitar a integração em produção.
      throw new UnauthorizedException('Webhook Asaas não configurado (ASAAS_WEBHOOK_TOKEN ausente)');
    }
    if (!asaasToken || asaasToken !== expected) {
      throw new UnauthorizedException('Token de webhook Asaas inválido');
    }
    return this.service.handleAsaasWebhook(body);
  }

  @Public()
  @SkipAudit()
  @Post('webhook/openpix')
  @HttpCode(200)
  handleOpenPixWebhook(
    @Body() body: any,
    @Headers('x-webhook-token') webhookToken?: string,
    @Query('token') tokenQuery?: string,
  ) {
    // Validação de token: sem essa checagem, qualquer pessoa na internet
    // manda POST com event=OPENPIX:CHARGE_COMPLETED e correlationID
    // financeiro_<id> e marca dívidas como pagas — fraude trivial.
    //
    // Configurar via env OPENPIX_WEBHOOK_TOKEN no Railway e usar o mesmo
    // valor na URL do webhook cadastrada na OpenPix, no parâmetro de query
    // ?token=... que a OpenPix repassa, ou via header conforme o painel.
    const expected = process.env.OPENPIX_WEBHOOK_TOKEN;
    if (!expected) {
      // Sem token configurado, recusa por padrão. Operador deve definir
      // OPENPIX_WEBHOOK_TOKEN antes de habilitar a integração em produção.
      throw new UnauthorizedException('Webhook OpenPix não configurado (OPENPIX_WEBHOOK_TOKEN ausente)');
    }
    // Aceita o token via header OU via query (?token=) — o painel da
    // OpenPix/Woovi às vezes só permite configurar a URL do webhook.
    const received = webhookToken || tokenQuery;
    if (!received || received !== expected) {
      throw new UnauthorizedException('Token de webhook OpenPix inválido');
    }
    return this.service.handleOpenPixWebhook(body);
  }

  @SkipAudit()
  @Post('admin/limpar-cobrancas-zeradas')
  @HttpCode(200)
  adminLimparCobrancasZeradas(
    @Body() body: { id_condominio: string | number },
    @ReqUser() payload: JwtPayload,
  ) {
    // Limpeza destrutiva de dados — só síndico (o tenant check no service
    // garante que é o síndico DESTE condomínio) ou admin.
    const typeAccess = payload?.typeAccess ?? payload?.user?.typeAccess;
    if (typeAccess !== 'Sindico' && typeAccess !== 'Admin') {
      throw new ForbiddenException('Apenas síndico ou administrador pode executar a limpeza de dados.');
    }
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? payload?.nome ?? 'Administrador';
    return this.service.adminLimparCobrancasZeradas(Number(body.id_condominio), operatorName, payload);
  }

  @SkipAudit()
  @Post('rateio')
  @HttpCode(200)
  createRateio(
    @Body() body: { id_condominio: string | number; rateioData: any },
    @ReqUser() payload: JwtPayload,
  ) {
    assertStaff(payload, 'criar rateio');
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? payload?.nome ?? 'Administrador';
    return this.service.createRateio(Number(body.id_condominio), body.rateioData, operatorName, payload);
  }

  @SkipAudit()
  @Post('inadimplente/acordo')
  @HttpCode(200)
  createAcordoInadimplente(
    @Body() body: { id_condominio: string | number; acordoData: any },
    @ReqUser() payload: JwtPayload,
  ) {
    assertStaff(payload, 'criar acordo de inadimplência');
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? payload?.nome ?? 'Administrador';
    return this.service.createAcordoInadimplente(Number(body.id_condominio), body.acordoData, operatorName, payload);
  }

  @Post('conciliacao/importar')
  @HttpCode(200)
  importarOfx(
    @Body() body: { id_condominio: string | number; ofxContent: string },
    @ReqUser() payload: JwtPayload,
  ) {
    assertStaff(payload, 'importar conciliação bancária');
    return this.service.parseOfxContent(Number(body.id_condominio), body.ofxContent, payload);
  }

  @SkipAudit()
  @Post('conciliacao/confirmar')
  @HttpCode(200)
  confirmarConciliacao(
    @Body() body: { id_condominio: string | number; reconciliations: { databaseId: number; dataPagamento: string }[] },
    @ReqUser() payload: JwtPayload,
  ) {
    assertStaff(payload, 'confirmar conciliação bancária');
    return this.service.confirmarConciliacao(Number(body.id_condominio), body.reconciliations, payload);
  }

  // ============== Fechamento Mensal ==============

  @Get('fechamentos')
  listarFechamentos(
    @Query('id_condominio') idCondominio: string,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.fechamento.listar(Number(idCondominio), payload);
  }

  @SkipAudit()
  @Post('fechamentos/fechar')
  @HttpCode(200)
  fecharMes(
    @Body() body: { id_condominio: string | number; mes: number; ano: number; observacao?: string },
    @ReqUser() payload: JwtPayload,
  ) {
    assertStaff(payload, 'fechar competência');
    return this.fechamento.fechar(
      Number(body.id_condominio),
      Number(body.mes),
      Number(body.ano),
      payload,
      body.observacao,
    );
  }

  @SkipAudit()
  @Post('fechamentos/reabrir')
  @HttpCode(200)
  reabrirMes(
    @Body() body: { id_condominio: string | number; mes: number; ano: number; motivo: string },
    @ReqUser() payload: JwtPayload,
  ) {
    assertStaff(payload, 'reabrir competência');
    return this.fechamento.reabrir(
      Number(body.id_condominio),
      Number(body.mes),
      Number(body.ano),
      body.motivo,
      payload,
    );
  }
}
