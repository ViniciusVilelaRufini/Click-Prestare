import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import { ApartamentosService, CreateApartamentoDto } from './apartamentos.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador } from '../auth/tenant.util';

@Controller('condominios/:idCondominio/apartamentos')
export class ApartamentosController {
  constructor(private readonly service: ApartamentosService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() payload: JwtPayload,
    @Query('search') search?: string,
  ) {
    // Console da portaria: lista as unidades do condomínio com a contagem de
    // moradores. O TenantGuard confere o condomínio, mas morador pertence a
    // ele — faltava a camada de papel, como no resto do console.
    assertOperador(payload, 'listar os apartamentos do condomínio');
    return this.service.findAll(idCondominio, search);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @ReqUser() payload: JwtPayload) {
    return this.service.findOne(id, payload);
  }

  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreateApartamentoDto, 'id_condominio'>,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.create({ ...body, id_condominio: idCondominio }, payload);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<CreateApartamentoDto>,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.update(id, body, payload);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @ReqUser() payload: JwtPayload) {
    // O `await` faltava: respondia { ok: true } antes de saber se apagou.
    // Numa exclusão que arrasta o histórico inteiro da unidade em cascata,
    // isso é o pior lugar possível para mentir — 403, falha de banco ou
    // apartamento inexistente viravam sucesso na tela, e a exceção virava
    // unhandled rejection no processo.
    return this.service.remove(id, payload);
  }

  @Post('import-bulk')
  importBulk(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: { linhas: any[] },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.importBulk(idCondominio, body.linhas, payload);
  }
}
