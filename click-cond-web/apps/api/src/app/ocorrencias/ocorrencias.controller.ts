import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import {
  CreateOcorrenciaDto,
  OcorrenciaStatus,
  OcorrenciasService,
} from './ocorrencias.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('condominios/:idCondominio/ocorrencias')
export class OcorrenciasController {
  constructor(private readonly service: OcorrenciasService) {}

  @Get('categorias')
  categorias() {
    return this.service.listCategorias();
  }

  @Post('categorias')
  createCategoria(
    @Body() body: { nome: string; prioridade?: number; sla_horas?: number | null },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.createCategoria(body, payload);
  }

  @Patch('categorias/:catId')
  updateCategoria(
    @Param('catId', ParseIntPipe) catId: number,
    @Body() body: { nome?: string; prioridade?: number; sla_horas?: number | null },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.updateCategoria(catId, body, payload);
  }

  @Delete('categorias/:catId')
  removeCategoria(@Param('catId', ParseIntPipe) catId: number, @ReqUser() payload: JwtPayload) {
    this.service.removeCategoria(catId, payload);
    return { ok: true };
  }

  @Get('funcionarios')
  funcionarios(@Param('idCondominio', ParseIntPipe) idCondominio: number) {
    return this.service.listFuncionariosAtribuiveis(idCondominio);
  }

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() payload: JwtPayload,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(idCondominio, status, payload);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @ReqUser() payload: JwtPayload) {
    return this.service.findOne(id, payload);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() payload: JwtPayload,
    @Body() body: Omit<CreateOcorrenciaDto, 'id_condominio'>,
  ) {
    const idUser = payload?.user?.id ?? payload?.sub ?? null;
    return this.service.create({
      ...body,
      id_condominio: idCondominio,
      user: idUser ? Number(idUser) : undefined,
    });
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: OcorrenciaStatus },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.updateStatus(id, body.status, payload);
  }

  @Patch(':id/publica')
  updatePublica(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { publica: boolean },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.updatePublica(id, body.publica, payload);
  }

  @Patch(':id/resposta')
  updateResposta(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { resposta: string },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.updateResposta(id, body.resposta, payload);
  }

  @Patch(':id/responsavel')
  atribuir(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { id_responsavel: number | null },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.atribuir(id, body.id_responsavel ?? null, payload);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @ReqUser() payload: JwtPayload) {
    this.service.remove(id, payload);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/mensagens')
  listMessages(@Param('id', ParseIntPipe) id: number, @ReqUser() payload: JwtPayload) {
    return this.service.listMessages(id, payload);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/mensagens')
  createMessage(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
    @Body() body: { mensagem: string },
  ) {
    const idUser = payload?.user?.id ?? payload?.sub ?? null;
    return this.service.createMessage(id, Number(idUser), body.mensagem, payload);
  }
}
