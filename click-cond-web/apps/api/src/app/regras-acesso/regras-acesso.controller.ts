import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { RegrasAcessoService } from './regras-acesso.service';
import type { CreateRegraAcessoDto } from './regras-acesso.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador } from '../auth/tenant.util';

/**
 * Regras de acesso: quem passa em qual leitor, em que dia e horário. É a
 * política de controle de acesso do prédio.
 *
 * O modulo inteiro estava sem checagem de papel — leitura E escrita. O
 * TenantGuard confere o condomínio da rota, mas morador pertence a ele, então
 * qualquer morador lia as regras e podia CRIAR uma nova, liberando a si mesmo
 * num leitor. As mutações até recebiam o usuário autenticado, mas ninguém o
 * usava: o service não tem nenhuma autorização.
 */
@Controller('condominios/:idCondominio/regras-acesso')
export class RegrasAcessoController {
  constructor(private readonly service: RegrasAcessoService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'consultar as regras de acesso');
    return this.service.findAll(idCondominio);
  }

  @Get(':id')
  get(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'consultar uma regra de acesso');
    return this.service.findOne(id, idCondominio);
  }

  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() dto: CreateRegraAcessoDto,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'criar regra de acesso');
    return this.service.create(idCondominio, dto, user);
  }

  @Put(':id')
  update(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateRegraAcessoDto>,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'editar regra de acesso');
    return this.service.update(id, dto, idCondominio, user);
  }

  @Delete(':id')
  remove(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'remover regra de acesso');
    return this.service.remove(id, idCondominio, user);
  }
}
