import { Body, Controller, HttpCode, Post, Get, Param, ParseIntPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { ReqUser } from './req-user.decorator';
import type { JwtPayload } from './jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  // Throttle estrito no login: 5 tentativas / minuto / IP. Adicional ao
  // throttle global. Protege contra password spray e brute force básico.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
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