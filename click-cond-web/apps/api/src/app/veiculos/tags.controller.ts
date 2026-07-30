import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { TagsService } from './tags.service';
import type { TagDto } from './tags.service';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador } from '../auth/tenant.util';

/**
 * Tags são credenciais físicas (RFID) do condomínio. O módulo não tinha
 * autorização nenhuma — nem no controller nem no service — só o TenantGuard
 * da rota, e morador pertence ao condomínio.
 *
 * Um morador conseguia listar TODOS os códigos de tag do prédio (com o
 * código, clona-se o cartão) e criar tags. Pior: o ramo `update` do upsert
 * faz `ativo: 1`, então repostar o código de uma tag revogada — um cartão
 * perdido ou roubado — a REATIVAVA.
 *
 * Só a portaria usa estas rotas; o app não as chama.
 */
@Controller('condominios/:idCondominio/tags')
export class TagsController {
  constructor(private readonly service: TagsService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
    @Query('livres') livres?: string,
  ) {
    assertOperador(user, 'listar as tags de acesso');
    return this.service.findAll(idCondominio, livres === 'true');
  }

  @SkipAudit()
  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: TagDto,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'cadastrar ou reativar tag de acesso');
    return this.service.upsert(idCondominio, body);
  }
}
