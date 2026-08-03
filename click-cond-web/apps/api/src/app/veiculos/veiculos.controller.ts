import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put,
} from '@nestjs/common';
import { VeiculosService } from './veiculos.service';
import type { VeiculoDto } from './veiculos.service';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador } from '../auth/tenant.util';

// Rotas protegidas pelo TenantGuard global (valida acesso ao :idCondominio).
// assertOperador exige síndico/funcionário (app) ou operador logado na
// portaria-web — ver o mesmo padrão em TagsController.
@Controller('condominios/:idCondominio')
export class VeiculosController {
  constructor(private readonly service: VeiculosService) {}

  @Get('veiculos')
  listAll(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'listar os veículos do condomínio');
    return this.service.findAll(idCondominio);
  }

  @Get('moradores/:idMorador/veiculos')
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idMorador', ParseIntPipe) idMorador: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'listar os veículos do morador');
    return this.service.findByMorador(idCondominio, idMorador);
  }

  @SkipAudit()
  @Post('moradores/:idMorador/veiculos')
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idMorador', ParseIntPipe) idMorador: number,
    @Body() body: VeiculoDto,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'cadastrar veículo');
    return this.service.create(idCondominio, idMorador, body);
  }

  @SkipAudit()
  @Put('veiculos/:id')
  update(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: VeiculoDto,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'editar veículo');
    return this.service.update(idCondominio, id, body);
  }

  @SkipAudit()
  @Delete('veiculos/:id')
  remove(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'remover veículo');
    return this.service.remove(idCondominio, id);
  }
}
