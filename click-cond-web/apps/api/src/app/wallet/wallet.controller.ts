import { Body, Controller, Get, HttpCode, Param, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { UsuarioAppGuard } from '../auth/usuario-app.guard';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { WalletService } from './wallet.service';

/**
 * Passe do morador na carteira do celular.
 *
 * Rotas do app (UsuarioAppGuard: o `sub` só é Users.id em token do app) e o
 * cancelamento pelo operador (portaria-web ou síndico). O serviço de
 * atualização que a própria Apple chama fica em AppleServicoController.
 */
@Controller('credenciais/wallet')
export class WalletController {
  constructor(private readonly service: WalletService) {}

  /** Diz ao app se mostra o botão: opção ligada, carteira disponível e passe ativo. */
  @UseGuards(UsuarioAppGuard)
  @SkipAudit()
  @Get('situacao')
  situacao(@Query('id_condominio') idCondominio: string, @ReqUser() user: JwtPayload) {
    return this.service.situacao(user, idCondominio);
  }

  /**
   * O arquivo .pkpass. Sem auditoria automática: a resposta é binária e o
   * corpo só diz o condomínio.
   */
  @UseGuards(UsuarioAppGuard)
  @SkipAudit()
  @Post('apple')
  @HttpCode(200)
  async apple(@Body() body: { id_condominio: number }, @ReqUser() user: JwtPayload) {
    const pkpass = await this.service.emitirApple(user, body ?? ({} as any));
    return new StreamableFile(pkpass, {
      type: 'application/vnd.apple.pkpass',
      disposition: 'attachment; filename="prestare.pkpass"',
      length: pkpass.length,
    });
  }

  @UseGuards(UsuarioAppGuard)
  @Post('cancelar')
  @HttpCode(200)
  cancelar(@Body() body: { id_condominio: number }, @ReqUser() user: JwtPayload) {
    return this.service.cancelarDoUsuario(user, body ?? ({} as any));
  }

  /** Celular perdido: o operador cancela. O serviço registra a auditoria. */
  @SkipAudit()
  @Post('morador/:idMorador/cancelar')
  @HttpCode(200)
  cancelarPeloOperador(@Param('idMorador') idMorador: string, @ReqUser() user: JwtPayload) {
    return this.service.cancelarPeloOperador(Number(idMorador), user);
  }
}
