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

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(idCondominio, status);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
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
  ) {
    return this.service.updateStatus(id, body.status);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    this.service.remove(id);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/mensagens')
  listMessages(@Param('id', ParseIntPipe) id: number) {
    return this.service.listMessages(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/mensagens')
  createMessage(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
    @Body() body: { mensagem: string },
  ) {
    const idUser = payload?.user?.id ?? payload?.sub ?? null;
    return this.service.createMessage(id, Number(idUser), body.mensagem);
  }
}
