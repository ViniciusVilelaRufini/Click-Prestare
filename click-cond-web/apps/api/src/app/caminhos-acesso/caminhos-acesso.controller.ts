import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  CaminhosAcessoService,
  CreateCaminhoDto,
} from './caminhos-acesso.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Quem pode montar o caminho: operador do console (porteiro/síndico logado na
 * portaria-web, cujo token carrega id_condominio) ou staff vindo do app.
 * Morador não — o caminho define o que abre cada portão.
 *
 * Não dá para usar o assertStaff daqui: o token emitido pelo login da
 * portaria-web não carrega typeAccess, e ele barraria justamente quem usa
 * esta tela.
 */
function assertOperador(user: JwtPayload | undefined, contexto: string) {
  const tipo = (user?.typeAccess ?? user?.user?.typeAccess ?? '')
    .toString()
    .toLowerCase();
  const ehConsole = !!user?.id_condominio;
  const ehStaffApp = tipo === 'sindico' || tipo === 'funcionario';
  if (!ehConsole && !ehStaffApp) {
    throw new ForbiddenException(
      `Acesso negado: ${contexto} exige operador da portaria ou síndico.`,
    );
  }
}

/**
 * Caminho de leitores: a sequência de etapas que a pessoa percorre para entrar.
 *
 * A rota traz :idCondominio, então o TenantGuard global já barra acesso a
 * condomínio alheio.
 */
@Controller('condominios/:idCondominio/caminhos-acesso')
export class CaminhosAcessoController {
  constructor(private readonly service: CaminhosAcessoService) {}

  @Get()
  list(@Param('idCondominio', ParseIntPipe) idCondominio: number) {
    return this.service.findAll(idCondominio);
  }

  @Get(':id')
  get(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(id, idCondominio);
  }

  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() dto: CreateCaminhoDto,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'criar caminho de leitores');
    return this.service.create(idCondominio, dto, user);
  }

  @Put(':id')
  update(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateCaminhoDto>,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'editar caminho de leitores');
    return this.service.update(id, idCondominio, dto, user);
  }

  @Delete(':id')
  remove(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'remover caminho de leitores');
    return this.service.remove(id, idCondominio, user);
  }
}
