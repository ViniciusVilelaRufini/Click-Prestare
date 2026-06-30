import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { PrestadoresService } from './prestadores.service';

@Controller('prestadores')
export class PrestadoresMobileController {
  constructor(private readonly service: PrestadoresService) {}

  @Get('get-all')
  getAll(@Query('id_condominio') idCondominio: string) {
    return this.service.findAll(Number(idCondominio));
  }

  @Get('get')
  async getOne(@Query('id') id: string) {
    const p: any = await this.service.findOne(Number(id));
    // Achata o apartamento em apto_bloco/apto para o app pré-preencher a unidade na edição.
    if (p && p.apartamento) {
      p.apto_bloco = p.apartamento.bloco ?? null;
      p.apto = p.apartamento.apto ?? null;
    }
    return p;
  }

  @Post('insert')
  @HttpCode(200)
  create(@Body() body: any) {
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
    });
  }

  @Post('update')
  @HttpCode(200)
  update(@Body() body: any) {
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
    });
  }

  @Post('remove')
  @HttpCode(200)
  remove(@Body() body: { id: string | number }) {
    return this.service.remove(Number(body.id));
  }
}
