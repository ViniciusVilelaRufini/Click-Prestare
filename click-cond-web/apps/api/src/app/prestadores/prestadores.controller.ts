import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query,
} from '@nestjs/common';
import { CreatePrestadorDto, PrestadoresService } from './prestadores.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador } from '../auth/tenant.util';

/**
 * Superfície do CONSOLE (portaria-web). O app tem a sua própria, em
 * `PrestadoresMobileController` (/prestadores/*), e é ela que o morador usa.
 *
 * O service valida o tenant, mas morador pertence ao condomínio — sozinho
 * isso não impedia um morador de editar ou apagar prestadores pelo console.
 */
@Controller('condominios/:idCondominio/prestadores')
export class PrestadoresController {
  constructor(private readonly service: PrestadoresService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('search') search: string | undefined,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.findAll(idCondominio, search, payload);
  }

  @Get(':id')
  get(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.findOne(id, idCondominio, payload);
  }

  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreatePrestadorDto, 'id_condominio'>,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.create({ ...body, id_condominio: idCondominio }, payload);
  }

  @Put(':id')
  update(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<CreatePrestadorDto>,
    @ReqUser() payload: JwtPayload,
  ) {
    assertOperador(payload, 'editar prestador pelo console');
    return this.service.update(id, body, idCondominio, payload);
  }

  @Patch(':id/foto')
  clearFoto(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { campo: 'pessoa' | 'documento' },
    @ReqUser() payload: JwtPayload,
  ) {
    assertOperador(payload, 'remover a foto de um prestador');
    return this.service.clearFoto(id, body.campo, idCondominio, payload);
  }

  @Delete(':id')
  async remove(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
  ) {
    assertOperador(payload, 'remover prestador pelo console');
    // O `await` faltava: a resposta era `{ ok: true }` imediata, antes de
    // saber se a exclusão tinha acontecido. Qualquer falha — 403 de tenant,
    // restrição de chave estrangeira, banco fora — virava sucesso na tela e o
    // prestador continuava lá depois do refresh. Também engolia a exceção,
    // que virava unhandled rejection no processo.
    await this.service.remove(id, idCondominio, payload);
    return { ok: true };
  }
}
