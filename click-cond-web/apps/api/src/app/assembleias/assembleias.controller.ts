import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Post, Query } from '@nestjs/common';
import { AssembleiasService } from './assembleias.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * O id do usuário vinha com `?? 1` como fallback em cinco rotas. Sem id no
 * payload, a ação era atribuída ao usuário 1 — e uma delas é o registro de
 * VOTO: o voto entraria como sendo de outra pessoa. Não dispara hoje (o
 * JwtAuthGuard é global), mas é um default que falha ABERTO.
 */
function exigirUsuario(payload?: JwtPayload): number {
  const id = Number(payload?.user?.id ?? payload?.sub);
  if (!id) throw new ForbiddenException('Sessão sem usuário válido.');
  return id;
}

@Controller('assembleias')
export class AssembleiasController {
  constructor(private readonly service: AssembleiasService) {}

  // ==========================================
  // ASSEMBLEIAS
  // ==========================================
  @Post('insert')
  @HttpCode(200)
  insert(
    @Body() body: { id_condominio: string | number; assembleia: any },
    @ReqUser() payload: JwtPayload,
  ) {
    const userId = exigirUsuario(payload);
    return this.service.insert(Number(body.id_condominio), body.assembleia, Number(userId), payload);
  }

  @Post('update')
  @HttpCode(200)
  update(
    @Body() body: { id_condominio: string | number; assembleia: any },
    @ReqUser() payload: JwtPayload,
  ) {
    const userId = exigirUsuario(payload);
    return this.service.update(Number(body.id_condominio), body.assembleia, Number(userId), payload);
  }

  @Post('remove')
  @HttpCode(200)
  remove(@Body() body: { id: string | number }, @ReqUser() payload: JwtPayload) {
    return this.service.remove(Number(body.id), payload);
  }

  @Get('get-all')
  getAll(@Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    return this.service.getAll(Number(idCondominio), payload);
  }

  @Get('get')
  get(
    @Query('id_condominio') idCondominio: string,
    @Query('id') id: string,
    @ReqUser() payload: JwtPayload,
  ) {
    const userId = exigirUsuario(payload);
    return this.service.get(Number(idCondominio), Number(id), Number(userId), payload);
  }

  @Post('finish/insert')
  @HttpCode(200)
  finish(@Body() body: { id_condominio: string | number; assembleia: any }, @ReqUser() payload: JwtPayload) {
    return this.service.finish(Number(body.id_condominio), body.assembleia, payload);
  }

  // ==========================================
  // VOTAÇÕES E ENQUETES
  // ==========================================
  @Post('votacoes/insert')
  @HttpCode(200)
  insertVotacao(@Body() body: { id_condominio: string | number; votacao: any }, @ReqUser() payload: JwtPayload) {
    return this.service.insertVotacao(body.votacao, Number(body.id_condominio), payload);
  }

  @Post('votacoes/remove')
  @HttpCode(200)
  removeVotacao(@Body() body: { id: string | number }, @ReqUser() payload: JwtPayload) {
    return this.service.removeVotacao(Number(body.id), payload);
  }

  @Post('votacoes/finish')
  @HttpCode(200)
  finishVotacao(@Body() body: { id: string | number }, @ReqUser() payload: JwtPayload) {
    return this.service.finishVotacao(Number(body.id), payload);
  }

  @Post('votacoes/voto/insert')
  @HttpCode(200)
  registerVoto(
    @Body() body: { voto?: { votacao_id?: string | number; opcao_id?: string | number } },
    @ReqUser() payload: JwtPayload,
  ) {
    const userId = exigirUsuario(payload);
    const voto = body?.voto;
    if (!voto || voto.votacao_id == null || voto.opcao_id == null) {
      throw new BadRequestException('Payload inválido: { voto: { votacao_id, opcao_id } } é obrigatório.');
    }
    return this.service.registerVoto(
      Number(voto.votacao_id),
      Number(voto.opcao_id),
      Number(userId),
      payload,
    );
  }

  @Get('votacoes/enquetes/get-all')
  enqueteGetAll(@Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    return this.service.enqueteGetAll(Number(idCondominio), payload);
  }

  @Get('votacoes/enquetes/get')
  enqueteGetDetails(@Query('id') id: string, @ReqUser() payload: JwtPayload) {
    const userId = exigirUsuario(payload);
    return this.service.enqueteGetDetails(Number(id), Number(userId), payload);
  }
}
