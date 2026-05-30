import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import {
  CreateVisitanteDto, VisitantesService,
} from './visitantes.service';

import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';

@Controller('condominios/:idCondominio/visitantes')
export class VisitantesController {
  constructor(private readonly service: VisitantesService) {}

  /** Achata a relação `apartamento` em `apto` / `apto_bloco` (compatível com o frontend antigo). */
  private flatten<T extends { apartamento?: { bloco: string | null; apto: string | null } | null }>(v: T) {
    const { apartamento, ...rest } = v;
    const formatDateTime = (date: any) => {
      if (!date) return null;
      const d = new Date(date);
      const pad = (n: number) => String(n).padStart(2, '0');
      const day = pad(d.getDate());
      const month = pad(d.getMonth() + 1);
      const year = d.getFullYear();
      const hours = pad(d.getHours());
      const minutes = pad(d.getMinutes());
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    };
    return {
      ...rest,
      apto: apartamento?.apto ?? null,
      apto_bloco: apartamento?.bloco ?? null,
      photo: (v as any).foto_pessoa ?? null,
      data_inicio: (v as any).data_hora_inicio ? formatDateTime((v as any).data_hora_inicio) : null,
      data_termino: (v as any).data_hora_termino ? formatDateTime((v as any).data_hora_termino) : null,
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

  /**
   * Lista pessoas únicas (agrupadas por documento/nome). Cada item
   * representa 1 pessoa, com agregados de todas as visitas. É a fonte
   * principal da página /visitantes.
   */
  @Get('pessoas')
  pessoas(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('search') search?: string,
  ) {
    return this.service.listarPessoas(idCondominio, search);
  }

  @Get(':id/detalhes')
  detalhes(@Param('id', ParseIntPipe) id: number) {
    return this.service.detalhes(id);
  }

  @Get('buscar/pessoa')
  buscarPessoa(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('doc') doc?: string,
    @Query('nome') nome?: string,
  ) {
    return this.service.buscarPessoa(idCondominio, doc, nome);
  }

  /**
   * Cria uma nova visita para uma pessoa já cadastrada. Só pede apto +
   * validade — nome, foto, doc e face_id são copiados do registro de
   * referência. Endpoint do botão "Nova Visita" na lista.
   */
  @Post('pessoa/:idRef/nova-visita')
  novaVisitaPessoa(
    @Param('idRef', ParseIntPipe) idRef: number,
    @Body() body: {
      id_apartamento: number;
      data_hora_inicio?: string;
      data_hora_termino?: string;
    },
  ) {
    return this.service.novaVisitaParaPessoa(idRef, body);
  }

  /**
   * Atualiza dados de IDENTIDADE da pessoa em todos os seus registros
   * (nome, doc, fotos). Apartamento e datas pertencem a cada visita
   * individual e são editados por outro fluxo.
   */
  @SkipAudit()
  @Put('pessoa/:idRef')
  atualizarPessoa(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idRef', ParseIntPipe) idRef: number,
    @Body() body: {
      nome?: string;
      doc_identificacao?: string;
      foto_pessoa?: string;
      foto_documento?: string;
      is_visitante?: number;
      is_prestador?: number;
    },
  ) {
    return this.service.atualizarPessoa(idCondominio, idRef, body);
  }

  /**
   * Remove TODAS as visitas dessa pessoa no condomínio + desinscreve do
   * terminal facial. Endpoint do botão "Remover" da lista.
   */
  @SkipAudit()
  @Delete('pessoa/:idRef')
  removerPessoa(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idRef', ParseIntPipe) idRef: number,
  ) {
    return this.service.removerPessoa(idCondominio, idRef);
  }

  @SkipAudit()
  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreateVisitanteDto, 'id_condominio'>,
  ) {
    return this.service.create({ ...body, id_condominio: idCondominio });
  }

  // PUT /:id e DELETE /:id foram removidos. Para atualizar identidade de
  // uma pessoa em todas as suas visitas, use PUT /pessoa/:idRef. Para
  // remover, use DELETE /pessoa/:idRef. Atualizações específicas de uma
  // visita ainda podem ser feitas via POST /visitantes/update (legacy,
  // usado pelo app Flutter).
}

@Controller('visitantes')
export class VisitantesGlobalController {
  constructor(private readonly service: VisitantesService) {}

  private flatten<T extends { apartamento?: { bloco: string | null; apto: string | null } | null }>(v: T) {
    const { apartamento, ...rest } = v;
    const formatDateTime = (date: any) => {
      if (!date) return null;
      const d = new Date(date);
      const pad = (n: number) => String(n).padStart(2, '0');
      const day = pad(d.getDate());
      const month = pad(d.getMonth() + 1);
      const year = d.getFullYear();
      const hours = pad(d.getHours());
      const minutes = pad(d.getMinutes());
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    };
    return {
      ...rest,
      apto: apartamento?.apto ?? null,
      apto_bloco: apartamento?.bloco ?? null,
      photo: (v as any).foto_pessoa ?? null,
      data_inicio: (v as any).data_hora_inicio ? formatDateTime((v as any).data_hora_inicio) : null,
      data_termino: (v as any).data_hora_termino ? formatDateTime((v as any).data_hora_termino) : null,
    };
  }

  @Get('validar/:codigo')
  async validarCodigo(
    @Param('codigo') codigo: string,
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
  ) {
    return this.service.validarCodigo(idCondominio, codigo);
  }

  @SkipAudit()
  @Post('check-in')
  async checkIn(@Body('id', ParseIntPipe) id: number) {
    return this.service.checkIn(id);
  }

  @SkipAudit()
  @Post('liberar')
  async liberarAcesso(@Body('id', ParseIntPipe) id: number) {
    return this.service.liberarAcesso(id);
  }

  @SkipAudit()
  @Post('check-out')
  async checkOut(@Body('id', ParseIntPipe) id: number) {
    return this.service.checkOut(id);
  }

  @Get('get')
  async getOne(@Query('id') id: string) {
    const v = await this.service.findOne(Number(id));
    return this.flatten(v);
  }

  @Get('get-all')
  async getAll(
    @Query('id_condominio') idCondominioStr: string | undefined,
    @Query('id_apto') idAptoStr: string | undefined,
    @Query('search') search: string | undefined,
    @Query('offset') offsetStr: string | undefined,
    @ReqUser() payload: JwtPayload,
  ) {
    const idCondominio = (idCondominioStr && idCondominioStr !== 'null' && idCondominioStr !== 'undefined')
      ? Number(idCondominioStr)
      : undefined;
    const idApto = idAptoStr ? Number(idAptoStr) : undefined;
    const offset = offsetStr ? Number(offsetStr) : 0;
    const userId = payload?.user?.id ?? payload?.sub;
    const userType = payload?.typeAccess ?? payload?.user?.typeAccess;

    const list = await this.service.findAllMobile(
      idCondominio,
      idApto,
      search,
      offset,
      userId ? Number(userId) : undefined,
      userType,
    );
    return list.map((v) => this.flatten(v));
  }

  @SkipAudit()
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
      foto_pessoa: vis.foto_pessoa || vis.photo,
    });
    
    return saved;
  }

  @SkipAudit()
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
      foto_pessoa: vis.foto_pessoa || vis.photo,
    });
  }
}