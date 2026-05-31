import { Body, Controller, Get, Headers, HttpCode, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { FinanceiroService } from './financeiro.service';
import { FechamentoService } from './fechamento.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { Public } from '../auth/public.decorator';
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
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? payload?.nome ?? 'Administrador';
    return this.service.update(Number(body.id_condominio), body.financeiro, operatorName, payload);
  }

  @SkipAudit()
  @Post('remove')
  @HttpCode(200)
  remove(@Body() body: { id: string | number }, @ReqUser() payload: JwtPayload) {
    return this.service.remove(Number(body.id), payload);
  }

  @Get('get-all')
  getAll(
    @Query('id_condominio') idCondominio: string,
    @Query('mes') mes: string,
    @Query('ano') ano: string,
    @ReqUser() payload: JwtPayload,
  ) {
    const isSindico = payload?.user?.typeAccess === 'Sindico';
    return this.service.getAll(Number(idCondominio), mes, ano, isSindico, payload);
  }

  @Get('get')
  get(@Query('id_condominio') idCondominio: string, @Query('id') id: string, @ReqUser() payload: JwtPayload) {
    // Para o get, o service espera payload.user para checagem de typeAccess de morador.
    // Passa o payload inteiro pra que id_condominio também esteja disponível para tenant check.
    return this.service.get(Number(idCondominio), Number(id), payload?.user ?? payload);
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

  @Get('get-by-user')
  getByUser(@Query('id_user') idUser: string, @Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    const typeAccess = payload?.typeAccess ?? payload?.user?.typeAccess;
    const isMorador = typeAccess === 'Morador';
    const currentUserId = payload?.user?.id ?? payload?.sub;
    // Morador SEMPRE recebe os próprios lançamentos, ignorando qualquer
    // id_user que ele tente passar (impede ler dados de outro morador).
    const targetUserId = isMorador ? Number(currentUserId) : Number(idUser);
    return this.service.getByUser(targetUserId, Number(idCondominio));
  }

  @Post('morador/insert')
  @HttpCode(200)
  insertMoradorConta(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id_condominio: string | number; data: any }
  ) {
    const userId = payload?.user?.id ?? payload?.sub;
    return this.service.insertMoradorConta(Number(userId), Number(body.id_condominio), body.data);
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

  @SkipAudit()
  @Post('rateio')
  @HttpCode(200)
  createRateio(
    @Body() body: { id_condominio: string | number; rateioData: any },
    @ReqUser() payload: JwtPayload,
  ) {
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
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? payload?.nome ?? 'Administrador';
    return this.service.createAcordoInadimplente(Number(body.id_condominio), body.acordoData, operatorName, payload);
  }

  @Post('conciliacao/importar')
  @HttpCode(200)
  importarOfx(
    @Body() body: { id_condominio: string | number; ofxContent: string },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.parseOfxContent(Number(body.id_condominio), body.ofxContent, payload);
  }

  @SkipAudit()
  @Post('conciliacao/confirmar')
  @HttpCode(200)
  confirmarConciliacao(
    @Body() body: { id_condominio: string | number; reconciliations: { databaseId: number; dataPagamento: string }[] },
    @ReqUser() payload: JwtPayload,
  ) {
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
    return this.fechamento.reabrir(
      Number(body.id_condominio),
      Number(body.mes),
      Number(body.ano),
      body.motivo,
      payload,
    );
  }
}
