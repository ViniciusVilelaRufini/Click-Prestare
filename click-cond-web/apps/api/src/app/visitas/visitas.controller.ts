import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { VisitasService } from './visitas.service';
import { CriarVisitaDto } from './dto/criar-visita.dto';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador } from '../auth/tenant.util';

/**
 * Como em `visitantes.controller.ts`: o TenantGuard só confere o
 * `:idCondominio` da rota, e um morador legitimamente pertence ao
 * condomínio dele — então o guard sozinho não impede um morador autenticado
 * de listar presença/visitas do condomínio inteiro ou registrar
 * entrada/saída de qualquer visita. `assertOperador` é quem fecha isso.
 */
@Controller('condominios/:idCondominio/visitas')
export class VisitasController {
  constructor(private readonly service: VisitasService) {}

  @Get('presenca')
  async listarPresenca(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() payload: JwtPayload,
  ) {
    assertOperador(payload, 'ver quem está presente no condomínio');
    return this.service.listarPresenca(idCondominio);
  }

  @Get()
  async listar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() payload: JwtPayload,
  ) {
    assertOperador(payload, 'listar as visitas do condomínio');
    return this.service.listarVisitasCondominio(idCondominio);
  }

  @Post()
  async criar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() dto: CriarVisitaDto,
    @ReqUser() payload: JwtPayload,
  ) {
    assertOperador(payload, 'criar uma visita');
    return this.service.criarVisita({ ...dto, id_condominio: idCondominio });
  }

  @Put(':idVisita/entrada')
  async registrarEntrada(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idVisita', ParseIntPipe) idVisita: number,
    @ReqUser() payload: JwtPayload,
  ) {
    assertOperador(payload, 'registrar entrada de uma visita');
    // O service confere que a visita carregada pertence a idCondominio
    // (IDOR cross-tenant fechado na camada de dados, não só aqui).
    return this.service.registrarEntrada(idVisita, idCondominio);
  }

  @Put(':idVisita/saida')
  async registrarSaida(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idVisita', ParseIntPipe) idVisita: number,
    @ReqUser() payload: JwtPayload,
  ) {
    assertOperador(payload, 'registrar saída de uma visita');
    return this.service.registrarSaida(idVisita, idCondominio);
  }
}
