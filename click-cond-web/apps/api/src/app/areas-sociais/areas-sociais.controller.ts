import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Controller(['areasSociais', 'areas-sociais'])
export class AreasSociaisController {
  constructor(private readonly service: AreasSociaisService) {}

  // ==========================================
  // ÁREAS SOCIAIS
  // ==========================================
  @Post('insert')
  @HttpCode(200)
  insert(@Body() body: { id_condominio: string | number; areaSocial: any }, @ReqUser() payload: JwtPayload) {
    return this.service.insert(Number(body.id_condominio), body.areaSocial, payload);
  }

  @Post('update')
  @HttpCode(200)
  update(@Body() body: { id_condominio: string | number; areaSocial: any }, @ReqUser() payload: JwtPayload) {
    return this.service.update(Number(body.id_condominio), body.areaSocial, payload);
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
  get(@Query('id_condominio') idCondominio: string, @Query('id') id: string, @ReqUser() payload: JwtPayload) {
    return this.service.get(Number(idCondominio), Number(id), payload);
  }

  // ==========================================
  // AGENDAMENTOS E RESERVAS
  // ==========================================
  @Post('agendamento/insert')
  @HttpCode(200)
  insertAgendamento(
    @Body() body: { agendamento: any },
    @ReqUser() payload: JwtPayload,
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    const typeAccess = payload.typeAccess ?? payload.user?.typeAccess ?? 'Morador';
    return this.service.insertAgendamento(body.agendamento, Number(idUser), typeAccess, payload);
  }

  @Post('agendamento/remove')
  @HttpCode(200)
  removeAgendamento(
    @Body() body: { id: string | number },
    @ReqUser() payload: JwtPayload,
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    const typeAccess = payload.typeAccess ?? payload.user?.typeAccess ?? 'Morador';
    return this.service.removeAgendamento(Number(body.id), Number(idUser), typeAccess, payload);
  }

  @Post('agendamento/confirmar')
  @HttpCode(200)
  confirmarAgendamento(
    @Body() body: { id: string | number },
    @ReqUser() payload: JwtPayload,
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    const typeAccess = payload.typeAccess ?? payload.user?.typeAccess ?? 'Morador';
    return this.service.confirmarAgendamento(Number(body.id), Number(idUser), typeAccess, payload);
  }

  @Get('agendamentos/get-all')
  getAllAgendamentos(@Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    return this.service.getAllAgendamentos(Number(idCondominio), payload);
  }

  @Get('meus-agendamentos/get-all')
  getAllMeusAgendamentos(
    @Query('id_condominio') idCondominio: string,
    @Query('id_apto') idApto?: string,
    @ReqUser() payload?: JwtPayload,
  ) {
    // Sem `?? 1`: o fallback fazia a rota devolver as reservas do usuário 1
    // caso o payload viesse sem id. Não acontece hoje (o JwtAuthGuard é
    // global), mas é um default que falha ABERTO — entrega dado de outra
    // pessoa em vez de recusar.
    const idUser = payload?.user?.id ?? payload?.sub;
    if (!idUser) {
      throw new ForbiddenException('Sessão sem usuário válido.');
    }
    const aptoIdNum = idApto && idApto !== 'null' && idApto !== 'undefined' ? Number(idApto) : undefined;
    return this.service.getAllMeusAgendamentos(Number(idCondominio), Number(idUser), aptoIdNum, payload);
  }

  @Post('agendamento/update-status')
  @HttpCode(200)
  updateStatusAgendamento(
    @Body() body: {
      id: string | number;
      isAccept?: boolean;
      status?: string;
      motivo_recusa?: string;
      agendamento?: { status?: string; motivo?: string };
    },
    @ReqUser() payload: JwtPayload,
  ) {
    const statusVal = body.isAccept ?? body.status ?? body.agendamento?.status ?? 'pendente';
    const motivoVal = body.motivo_recusa ?? body.agendamento?.motivo ?? '';
    return this.service.updateStatusAgendamento(Number(body.id), statusVal, motivoVal, payload);
  }

  // ==========================================
  // MANUTENÇÕES
  // ==========================================
  @Post('manutencao/insert')
  @HttpCode(200)
  insertManutencao(@Body() body: { manutencao: any }, @ReqUser() payload: JwtPayload) {
    return this.service.insertManutencao(body.manutencao, payload);
  }

  @Post('manutencao/update')
  @HttpCode(200)
  updateManutencao(@Body() body: { manutencao: any }, @ReqUser() payload: JwtPayload) {
    return this.service.updateManutencao(body.manutencao, payload);
  }

  @Post('manutencao/remove')
  @HttpCode(200)
  removeManutencao(@Body() body: { id: string | number }, @ReqUser() payload: JwtPayload) {
    return this.service.removeManutencao(Number(body.id), payload);
  }
}
