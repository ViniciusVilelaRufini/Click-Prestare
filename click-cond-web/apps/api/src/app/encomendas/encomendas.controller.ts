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
    // Recarga do console: sem assinatura/foto da retirada e só as retiradas
    // dos últimos N dias (1–365); sem os parâmetros, a lista de sempre.
    @Query('leve') leve?: string,
    @Query('retiradas_dias') retiradasDias?: string,
  ) {
    assertOperador(user, 'listar as encomendas do condomínio');
    const dias = Number(retiradasDias);
    const retiradasDesde = Number.isInteger(dias) && dias >= 1 && dias <= 365
      ? new Date(Date.now() - dias * 86_400_000)
      : undefined;
    return this.service.findAll(idCondominio, status, user, { leve: leve === '1' || leve === 'true', retiradasDesde });
  }

  @SkipAudit()
  @Post('ler-etiqueta')
  lerEtiqueta(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: { imagem?: string },
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'ler etiqueta de encomenda');
    return this.service.lerEtiqueta(idCondominio, user, body?.imagem ?? '');
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

  // Porteiro corrige a unidade de uma encomenda que ainda aguarda retirada
  // (apartamento errado no recebimento); a nova unidade é avisada.
  @SkipAudit()
  @Patch(':id')
  corrigirUnidade(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { destinatario_apto?: string; destinatario_bloco?: string | null },
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'corrigir a unidade da encomenda');
    return this.service.corrigirUnidade(
      idCondominio,
      id,
      { destinatario_apto: body?.destinatario_apto, destinatario_bloco: body?.destinatario_bloco },
      user,
    );
  }

  @SkipAudit()
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    assertOperador(user, 'excluir encomenda');
    await this.service.remove(id, user);
    return { ok: true };
  }
}
