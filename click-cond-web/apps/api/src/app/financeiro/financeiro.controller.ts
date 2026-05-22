import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { FinanceiroService } from './financeiro.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { Public } from '../auth/public.decorator';

@Controller('financeiro')
export class FinanceiroController {
  constructor(private readonly service: FinanceiroService) {}

  @Post('insert')
  @HttpCode(200)
  insert(
    @Body() body: { id_condominio: string | number; financeiro: any },
    @ReqUser() payload: JwtPayload,
  ) {
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? 'Administrador';
    return this.service.insert(Number(body.id_condominio), body.financeiro, operatorName);
  }

  @Post('update')
  @HttpCode(200)
  update(
    @Body() body: { id_condominio: string | number; financeiro: any },
    @ReqUser() payload: JwtPayload,
  ) {
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? 'Administrador';
    return this.service.update(Number(body.id_condominio), body.financeiro, operatorName);
  }

  @Post('remove')
  @HttpCode(200)
  remove(@Body() body: { id: string | number }) {
    return this.service.remove(Number(body.id));
  }

  @Get('get-all')
  getAll(
    @Query('id_condominio') idCondominio: string,
    @Query('mes') mes: string,
    @Query('ano') ano: string,
    @ReqUser() payload: JwtPayload,
  ) {
    const isSindico = payload?.user?.typeAccess === 'Sindico';
    return this.service.getAll(Number(idCondominio), mes, ano, isSindico);
  }

  @Get('get')
  get(@Query('id_condominio') idCondominio: string, @Query('id') id: string, @ReqUser() payload: JwtPayload) {
    return this.service.get(Number(idCondominio), Number(id), payload?.user);
  }

  @Get('moradores/get-all')
  getAllMoradores(
    @Query('id_condominio') idCondominio: string,
    @Query('mes') mes: string,
    @Query('ano') ano: string,
  ) {
    return this.service.getAllMoradores(Number(idCondominio), mes, ano);
  }

  @Get('inadimplentes/get-all')
  getAllInadimplentes(@Query('id_condominio') idCondominio: string) {
    return this.service.getAllInadimplentes(Number(idCondominio));
  }

  @Get('inadimplente/get')
  getInadimplenteDetail(
    @Query('id_condominio') idCondominio: string,
    @Query('apto') apto: string,
    @Query('bloco') bloco: string,
  ) {
    return this.service.getInadimplenteDetail(Number(idCondominio), apto, bloco);
  }

  @Post('inadimplente/notificar')
  notifyInadimplente(
    @Body('id_condominio') idCondominio: string | number,
    @Body('apto') apto: string,
    @Body('bloco') bloco: string,
  ) {
    return this.service.notifyInadimplente(Number(idCondominio), apto, bloco);
  }

  @Get('grafico/get-all')
  getGrafico(
    @Query('id_condominio') idCondominio: string,
    @Query('mes') mes: string,
    @Query('ano') ano: string,
  ) {
    return this.service.getGrafico(Number(idCondominio), mes, ano);
  }

  @Get('get-by-user')
  getByUser(@Query('id_user') idUser: string, @Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    const typeAccess = payload?.typeAccess ?? payload?.user?.typeAccess;
    const isMorador = typeAccess === 'Morador';
    const currentUserId = payload?.user?.id ?? payload?.sub;
    const targetUserId = isMorador ? (currentUserId ?? Number(idUser)) : Number(idUser);
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
  uploadSharedFile(@Body() body: { id: string | number; file: string; type: string }) {
    return this.service.uploadSharedFile(Number(body.id), body.file, body.type);
  }

  @Post('update-status')
  @HttpCode(200)
  updateStatus(@Body() body: { id: string | number; status: string | number }) {
    return this.service.updateStatus(Number(body.id), body.status);
  }

  @Public()
  @Post('webhook/asaas')
  @HttpCode(200)
  handleAsaasWebhook(@Body() body: any) {
    return this.service.handleAsaasWebhook(body);
  }

  @Post('recorrencia/register-card')
  @HttpCode(200)
  registerRecurringCard(@ReqUser() payload: JwtPayload, @Body() body: { cardData: any }) {
    return this.service.registerRecurringCard(Number(payload.user.id), body.cardData);
  }

  @Post('rateio')
  @HttpCode(200)
  createRateio(
    @Body() body: { id_condominio: string | number; rateioData: any },
    @ReqUser() payload: JwtPayload,
  ) {
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? 'Administrador';
    return this.service.createRateio(Number(body.id_condominio), body.rateioData, operatorName);
  }

  @Post('inadimplente/acordo')
  @HttpCode(200)
  createAcordoInadimplente(
    @Body() body: { id_condominio: string | number; acordoData: any },
    @ReqUser() payload: JwtPayload,
  ) {
    const operatorName = payload?.user?.name ?? payload?.user?.nome ?? 'Administrador';
    return this.service.createAcordoInadimplente(Number(body.id_condominio), body.acordoData, operatorName);
  }
}
