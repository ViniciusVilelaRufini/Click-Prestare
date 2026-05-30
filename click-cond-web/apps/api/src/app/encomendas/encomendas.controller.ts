import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query,
} from '@nestjs/common';
import { CreateEncomendaDto, EncomendasService } from './encomendas.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';

@Controller('condominios/:idCondominio/encomendas')
export class EncomendasController {
  constructor(private readonly service: EncomendasService) {}

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

  @SkipAudit()
  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreateEncomendaDto, 'id_condominio'>,
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.create({ ...body, id_condominio: idCondominio }, user);
  }

  @SkipAudit()
  @Patch(':id/retirar')
  retirar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      retirado_por: string;
      retirado_doc?: string;
      retirado_assinatura?: string;
      retirado_foto?: string;
    },
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.retirar(
      id,
      body.retirado_por,
      body.retirado_doc,
      body.retirado_assinatura,
      body.retirado_foto,
      user,
    );
  }

  @SkipAudit()
  @Patch(':id/notificar')
  notificar(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.service.notificar(id, user);
  }

  @SkipAudit()
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    await this.service.remove(id, user);
    return { ok: true };
  }
}
