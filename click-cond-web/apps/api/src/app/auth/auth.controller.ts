import { Body, Controller, HttpCode, Post, Get, Param, ParseIntPipe, Optional, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { MobileAuthService } from './mobile-auth.service';
import { Public } from './public.decorator';
import { ReqUser } from './req-user.decorator';
import type { JwtPayload } from './jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Optional() private readonly mobileAuthService?: MobileAuthService,
  ) {}

  @Public()
  @Throttle({ medium: { limit: 10, ttl: 60_000 } })
  @Post('solicitar-codigo-redefinicao')
  @HttpCode(200)
  solicitarCodigoRedefinicao(@Body() body: { email: string; papel?: string; login_type?: string }, @Req() req: any) {
    const ip = req?.ip || req?.headers?.['x-forwarded-for'];
    const papel = body.papel || body.login_type || 'morador';
    return this.mobileAuthService?.solicitarCodigoRedefinicao(body.email, papel, ip);
  }

  @Public()
  @Throttle({ medium: { limit: 10, ttl: 60_000 } })
  @Post('validar-codigo-redefinicao')
  @HttpCode(200)
  validarCodigoRedefinicao(@Body() body: { ticket_id?: string; ticketId?: string; codigo?: string; code?: string }) {
    const ticketId = body.ticket_id ?? body.ticketId ?? '';
    const codigo = body.codigo ?? body.code ?? '';
    return this.mobileAuthService?.validarCodigoRedefinicao(ticketId, codigo);
  }

  @Public()
  @Throttle({ medium: { limit: 10, ttl: 60_000 } })
  @Post('redefinir-senha')
  @HttpCode(200)
  redefinirSenha(@Body() body: { token: string; novaSenha?: string; nova_senha?: string }) {
    const novaSenha = body.novaSenha ?? body.nova_senha ?? '';
    return this.mobileAuthService?.confirmarRedefinicaoSenha(body.token, novaSenha);
  }

  @Public()
  // Throttle estrito no login: 5 tentativas / minuto / IP. Adicional ao
  // throttle global. Protege contra password spray e brute force básico.
  @Throttle({ medium: { limit: 5, ttl: 60_000 } })
  @Post('login-portaria')
  @HttpCode(200)
  login(@Body() body: { login: string; senha: string }) {
    return this.authService.loginPortaria(body.login, body.senha);
  }

  @Public()
  @Get('condominio/:id')
  async getCondominio(@Param('id', ParseIntPipe) id: number) {
    return this.authService.getCondominioNome(id);
  }

  // Síndico com mais de um condomínio escolhe em qual entrar (ou troca depois).
  // Autenticado: o vínculo é conferido contra o síndico do JWT.
  @Post('selecionar-condominio')
  @HttpCode(200)
  selecionarCondominio(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id_condominio: number },
  ) {
    return this.authService.selecionarCondominio(payload, Number(body.id_condominio));
  }

  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @ReqUser() payload: JwtPayload,
    @Body() body: { senhaAtual: string; novaSenha: string },
  ) {
    // O id do funcionário vem SEMPRE do JWT, nunca do body. Antes o id era
    // aceito do corpo, permitindo que qualquer autenticado trocasse a senha
    // de outro porteiro chutando o id (e conhecendo a senha atual dele).
    return this.authService.changePassword(payload.sub, body.senhaAtual, body.novaSenha, payload.typeAccess);
  }

  @Public()
  @Post('qr/session')
  @HttpCode(200)
  createQrSession() {
    return this.authService.createQrSession();
  }

  @Public()
  @Get('qr/status/:qrToken')
  getQrStatus(@Param('qrToken') qrToken: string) {
    return this.authService.getQrStatus(qrToken);
  }

  @Post('qr/authorize')
  @HttpCode(200)
  authorizeQrSession(
    @ReqUser() payload: JwtPayload,
    @Body() body: { qrToken: string; id_condominio: number }
  ) {
    return this.authService.authorizeQrSession(payload, body.qrToken, Number(body.id_condominio));
  }
}