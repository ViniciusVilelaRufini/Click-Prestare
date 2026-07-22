import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { MudancasService } from './mudancas.service';

@UseGuards(JwtAuthGuard)
@Controller('mudancas')
export class MudancasController {
  constructor(private readonly service: MudancasService) {}

  // ──────────────────────────────────────────────────────
  // GET  /mudancas/get-all?id_condominio=&id_apto=&offset=
  // ──────────────────────────────────────────────────────
  @Get('get-all')
  getAll(
    @Query('id_condominio') idCondominio: string,
    @Query('id_apto') idApto: string | undefined,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.findAll(Number(idCondominio), idApto ? Number(idApto) : undefined, payload);
  }

  // ──────────────────────────────────────────────────────
  // GET  /mudancas/get?id=
  // ──────────────────────────────────────────────────────
  @Get('get')
  getOne(@Query('id') id: string, @ReqUser() payload: JwtPayload) {
    return this.service.findOne(Number(id), payload);
  }

  // ──────────────────────────────────────────────────────
  // POST /mudancas/insert
  // Body: { id_condominio, mudanca: { data, hora_inicio, id_apartamento } }
  // ──────────────────────────────────────────────────────
  @Post('insert')
  @HttpCode(200)
  async insert(@Body() body: any, @ReqUser() payload: JwtPayload) {
    const idUser = payload?.user?.id ?? payload?.sub ?? null;
    const data = body.mudanca ?? body.Mudanca ?? {};
    const idCondominio = Number(body.id_condominio);
    return this.service.create({
      data: data.data ?? null,
      hora_inicio: data.hora_inicio ?? null,
      id_apartamento: Number(data.id_apartamento),
      id_condominio: idCondominio,
      user: idUser ? Number(idUser) : null,
    }, payload);
  }

  // ──────────────────────────────────────────────────────
  // POST /mudancas/update
  // Body: { mudanca: { id, data, hora_inicio, id_apartamento } }
  // ──────────────────────────────────────────────────────
  @Post('update')
  @HttpCode(200)
  async update(@Body() body: any, @ReqUser() payload: JwtPayload) {
    const data = body.mudanca ?? body.Mudanca ?? {};
    const id = Number(data.id);
    return this.service.update(id, {
      data: data.data ?? undefined,
      hora_inicio: data.hora_inicio ?? undefined,
      id_apartamento: data.id_apartamento ? Number(data.id_apartamento) : undefined,
    }, payload);
  }

  // ──────────────────────────────────────────────────────
  // POST /mudancas/update-status
  // Body: { id, isAccept, motivo_recusa, id_condominio }
  // ──────────────────────────────────────────────────────
  @Post('update-status')
  @HttpCode(200)
  async updateStatus(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.updateStatus(
      Number(body.id),
      Boolean(body.isAccept),
      body.motivo_recusa ?? '',
      payload,
    );
  }

  // ──────────────────────────────────────────────────────
  // POST /mudancas/remove
  // Body: { id }
  // ──────────────────────────────────────────────────────
  @Post('remove')
  @HttpCode(200)
  async remove(@Body() body: { id: string | number }, @ReqUser() payload: JwtPayload) {
    await this.service.remove(Number(body.id), payload);
    return { ok: true };
  }
}
