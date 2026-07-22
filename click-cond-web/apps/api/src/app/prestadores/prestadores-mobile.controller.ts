import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { PrestadoresService } from './prestadores.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('prestadores')
export class PrestadoresMobileController {
  constructor(private readonly service: PrestadoresService) {}

  @Get('get-all')
  getAll(@Query('id_condominio') idCondominio: string, @ReqUser() payload: JwtPayload) {
    return this.service.findAll(Number(idCondominio), undefined, payload);
  }

  @Get('get')
  async getOne(@Query('id') id: string, @ReqUser() payload: JwtPayload) {
    const p: any = await this.service.findOne(Number(id), undefined, payload);
    // Achata o apartamento em apto_bloco/apto para o app pré-preencher a unidade na edição.
    if (p && p.apartamento) {
      p.apto_bloco = p.apartamento.bloco ?? null;
      p.apto = p.apartamento.apto ?? null;
    }
    return p;
  }

  @Post('insert')
  @HttpCode(200)
  create(@Body() body: any, @ReqUser() payload: JwtPayload) {
    const idCondominio = Number(body.id_condominio);
    const data = body.prestador || body.Prestador || body.prestadores || {};
    return this.service.create({
      id_condominio: idCondominio,
      nome: data.nome,
      telefone: data.telefone,
      categorias: data.categorias,
      id_apartamento: data.id_apartamento != null ? Number(data.id_apartamento) : undefined,
      foto_pessoa: data.foto_pessoa ?? data.photo,
      foto_documento: data.foto_documento,
      dias_semana: data.dias_semana,
    }, payload);
  }

  @Post('update')
  @HttpCode(200)
  update(@Body() body: any, @ReqUser() payload: JwtPayload) {
    const data = body.prestador || body.Prestador || body.prestadores || {};
    const id = Number(data.id);
    return this.service.update(id, {
      nome: data.nome,
      telefone: data.telefone,
      categorias: data.categorias,
      id_apartamento: data.id_apartamento != null ? Number(data.id_apartamento) : undefined,
      foto_pessoa: data.foto_pessoa ?? data.photo,
      foto_documento: data.foto_documento,
      dias_semana: data.dias_semana,
    }, undefined, payload);
  }

  @Post('remove')
  @HttpCode(200)
  remove(@Body() body: { id: string | number }, @ReqUser() payload: JwtPayload) {
    return this.service.remove(Number(body.id), undefined, payload);
  }
}
