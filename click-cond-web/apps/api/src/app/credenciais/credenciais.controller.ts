import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UsuarioAppGuard } from '../auth/usuario-app.guard';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { Public } from '../auth/public.decorator';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { CredenciaisService } from './credenciais.service';

/**
 * Credencial de acesso por QR dinâmico.
 *
 * Rotas do app (UsuarioAppGuard: o `sub` só é Users.id em token do app) e a
 * opção do condomínio, que a portaria-web também lê e o síndico altera.
 */
@Controller('credenciais')
export class CredenciaisController {
  constructor(private readonly service: CredenciaisService) {}

  /**
   * Emite ou reemite a credencial do morador logado no condomínio pedido.
   * Sem auditoria automática: o app chama a cada abertura da tela "Meu
   * acesso", e o corpo não diz nada além do condomínio.
   */
  @UseGuards(UsuarioAppGuard)
  @SkipAudit()
  @Post('minha')
  @HttpCode(200)
  minha(@Body() body: { id_condominio: number; renovar?: boolean }, @ReqUser() user: JwtPayload) {
    return this.service.minha(user, body ?? ({} as any));
  }

  /** Link do passe do visitante/prestador; `:id` é o mesmo da lista do app. */
  @UseGuards(UsuarioAppGuard)
  @Post('visita/:id/link')
  @HttpCode(200)
  linkVisita(@Param('id') id: string, @ReqUser() user: JwtPayload) {
    return this.service.linkVisita(Number(id), user);
  }

  @UseGuards(UsuarioAppGuard)
  @Post('visita/:id/invalidar-link')
  @HttpCode(200)
  invalidarLink(@Param('id') id: string, @ReqUser() user: JwtPayload) {
    return this.service.invalidarLink(Number(id), user);
  }

  @Get('condominio/:idCondominio/opcao')
  lerOpcao(@Param('idCondominio') idCondominio: string, @ReqUser() user: JwtPayload) {
    return this.service.lerOpcao(Number(idCondominio), user);
  }

  @Patch('condominio/:idCondominio/opcao')
  definirOpcao(
    @Param('idCondominio') idCondominio: string,
    @Body() body: { qr_app_habilitado: boolean },
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.definirOpcao(Number(idCondominio), body?.qr_app_habilitado, user);
  }
}

/**
 * Página pública do passe do visitante. A trava é o token (HMAC da chave do
 * servidor), que muda quando o morador invalida o link. @SkipAudit pelo mesmo
 * motivo do convite: sem usuário, o interceptor não tem onde gravar.
 */
@Controller('passes')
export class PassesPublicosController {
  constructor(private readonly service: CredenciaisService) {}

  @SkipAudit()
  @Public()
  @Throttle({ medium: { limit: 30, ttl: 60_000 } })
  @Get('publico/:token')
  ler(@Param('token') token: string) {
    return this.service.lerPassePublico(token);
  }
}
