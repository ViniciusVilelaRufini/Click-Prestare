import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ComunicadosService } from './comunicados.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { formatarDataHoraBrasilia } from '../common/hora-brasilia.util';

// Horário de Brasília: o servidor roda em UTC e o app mostra a string como está.
function formatCreatedAt(date: Date | string | null | undefined): string {
  if (!date) return '';
  return formatarDataHoraBrasilia(new Date(date));
}

@Controller('comunicados')
export class ComunicadosMobileController {
  constructor(private readonly service: ComunicadosService) {}

  @Get('get-all')
  async getAll(@Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    const list = await this.service.findAll(Number(idCondominio), payload);
    return list.map(c => ({
      id: c.id,
      titulo: c.titulo,
      descricao: c.descricao ?? '',
      created_at: formatCreatedAt(c.created_at),
    }));
  }

  @Get('get')
  async getOne(@Query('id') id: string, @ReqUser() payload: JwtPayload) {
    const c = await this.service.findOne(Number(id), payload);
    return {
      id: c.id,
      titulo: c.titulo,
      descricao: c.descricao ?? '',
      created_at: formatCreatedAt(c.created_at),
    };
  }

  @Post('insert')
  @HttpCode(200)
  create(@Body() body: any, @ReqUser() payload: JwtPayload) {
    const idCondominio = Number(body.id_condominio);
    const data = body.comunicado || {};
    return this.service.create({
      id_condominio: idCondominio,
      titulo: data.titulo,
      descricao: data.descricao,
    }, payload);
  }

  @Post('update')
  @HttpCode(200)
  update(@Body() body: any, @ReqUser() payload: JwtPayload) {
    const data = body.comunicado || {};
    const id = Number(data.id);
    return this.service.update(id, {
      titulo: data.titulo,
      descricao: data.descricao,
    }, payload);
  }

  @Post('remove')
  @HttpCode(200)
  async remove(@Body() body: { id: string | number }, @ReqUser() payload: JwtPayload) {
    await this.service.remove(Number(body.id), payload);
    return { ok: true };
  }
}
