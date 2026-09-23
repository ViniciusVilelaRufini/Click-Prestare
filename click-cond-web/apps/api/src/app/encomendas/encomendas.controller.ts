import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query,
} from '@nestjs/common';
import { CreateEncomendaDto, EncomendasService } from './encomendas.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { assertOperador } from '../auth/tenant.util';

/**
 * Superfície da PORTARIA-WEB. O TenantGuard só confere o vínculo com o
 * condomínio — e morador tem vínculo: sem checagem de papel, qualquer morador
 * listava as encomendas do prédio inteiro e dava baixa ou apagava a de outro
 * apartamento. O app do morador usa /encomendas/* (mobile-auth).
 */
@Controller('condominios/:idCondominio/encomendas')
export class EncomendasController {
  constructor(private readonly service: EncomendasService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('status') status?: string,
    @ReqUser() user?: JwtPayload,
  ) {
    assertOperador(user, 'listar as encomendas do condomínio');
    return this.service.findAll(idCondominio, status, user);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    assertOperador(user, 'abrir uma encomenda');
    return this.service.findOne(id, user);
  }

  @SkipAudit()
  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreateEncomendaDto, 'id_condominio'>,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'registrar encomenda');
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
    assertOperador(user, 'dar baixa em encomenda');
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
    assertOperador(user, 'notificar encomenda');
    return this.service.notificar(id, user);
  }

  // Porteiro confirma o recebimento de uma encomenda pré-registrada pelo morador
  // (status 'Esperando' -> 'Aguardando') e notifica o morador.
  @SkipAudit()
  @Patch(':id/receber')
  receber(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    assertOperador(user, 'confirmar recebimento de encomenda');
    return this.service.receber(id, user);
  }

  @SkipAudit()
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    assertOperador(user, 'excluir encomenda');
    await this.service.remove(id, user);
    return { ok: true };
  }
}
