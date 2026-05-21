import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import {
  CreateVisitanteDto, UpdateVisitanteDto, VisitantesService,
} from './visitantes.service';

@Controller('condominios/:idCondominio/visitantes')
export class VisitantesController {
  constructor(private readonly service: VisitantesService) {}

  /** Achata a relação `apartamento` em `apto` / `apto_bloco` (compatível com o frontend antigo). */
  private flatten<T extends { apartamento?: { bloco: string | null; apto: string | null } | null }>(v: T) {
    const { apartamento, ...rest } = v;
    return {
      ...rest,
      apto: apartamento?.apto ?? null,
      apto_bloco: apartamento?.bloco ?? null,
    };
  }

  @Get()
  async list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('search') search?: string,
  ) {
    const list = await this.service.findAll(idCondominio, search);
    return list.map((v) => this.flatten(v));
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.flatten(await this.service.findOne(id));
  }

  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreateVisitanteDto, 'id_condominio'>,
  ) {
    return this.service.create({ ...body, id_condominio: idCondominio });
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Omit<UpdateVisitanteDto, 'id'>,
  ) {
    return this.service.update({ ...body, id });
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    return { ok: true };
  }
}

@Controller('visitantes')
export class VisitantesGlobalController {
  constructor(private readonly service: VisitantesService) {}

  private flatten<T extends { apartamento?: { bloco: string | null; apto: string | null } | null }>(v: T) {
    const { apartamento, ...rest } = v;
    return {
      ...rest,
      apto: apartamento?.apto ?? null,
      apto_bloco: apartamento?.bloco ?? null,
    };
  }

  @Get('validar/:codigo')
  async validarCodigo(
    @Param('codigo') codigo: string,
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
  ) {
    return this.service.validarCodigo(idCondominio, codigo);
  }

  @Post('check-in')
  async checkIn(@Body('id', ParseIntPipe) id: number) {
    return this.service.checkIn(id);
  }

  @Post('check-out')
  async checkOut(@Body('id', ParseIntPipe) id: number) {
    return this.service.checkOut(id);
  }

  @Get('get')
  async getDetails(
    @Query('id', ParseIntPipe) id: number,
  ) {
    const v = await this.service.findOne(id);
    return this.flatten(v);
  }

  @Get('get-all')
  async getAll(
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @Query('id_apto') idApto?: string,
    @Query('search') search?: string,
    @Query('offset') offset?: string,
  ) {
    const list = await this.service.findAllMobile(
      idCondominio,
      idApto ? Number(idApto) : undefined,
      search,
      offset ? Number(offset) : 0,
    );
    return list.map((v) => this.flatten(v));
  }

  @Post('insert')
  async insert(@Body() body: { id_condominio: string; visitante: any }) {
    const idCondominio = Number(body.id_condominio);
    const vis = body.visitante;
    
    const saved = await this.service.create({
      nome: vis.nome,
      doc_identificacao: vis.doc_identificacao,
      data_hora_inicio: vis.data_inicio || vis.data_hora_inicio,
      data_hora_termino: vis.data_termino || vis.data_hora_termino,
      is_visitante: vis.is_visitante !== undefined ? Number(vis.is_visitante) : 1,
      is_prestador: vis.is_prestador !== undefined ? Number(vis.is_prestador) : 0,
      id_apartamento: Number(vis.id_apartamento),
      id_condominio: idCondominio,
      foto_documento: vis.foto_documento,
      foto_pessoa: vis.foto_pessoa,
    });
    
    return saved;
  }

  @Post('update')
  async update(@Body() body: { id_condominio: string; visitante: any }) {
    const vis = body.visitante;
    
    return this.service.update({
      id: Number(vis.id),
      nome: vis.nome,
      doc_identificacao: vis.doc_identificacao,
      data_hora_inicio: vis.data_inicio || vis.data_hora_inicio,
      data_hora_termino: vis.data_termino || vis.data_hora_termino,
      is_visitante: vis.is_visitante !== undefined ? Number(vis.is_visitante) : undefined,
      is_prestador: vis.is_prestador !== undefined ? Number(vis.is_prestador) : undefined,
      id_apartamento: vis.id_apartamento ? Number(vis.id_apartamento) : undefined,
      foto_documento: vis.foto_documento,
      foto_pessoa: vis.foto_pessoa,
    });
  }
}