import { Body, Controller, HttpCode, Post, Get, Param, ParseIntPipe, Optional, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { MobileAuthService } from './mobile-auth.service';
import { Public } from './public.decorator';
import { ReqUser } from './req-user.decorator';
import type { JwtPayload } from './jwt-payload.interface';
import { extractClientIp } from '../common/context/request-context';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';

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
  login(@Body() body: { login: string; senha: string; device_token?: string }, @Req() req: any) {
    const deviceToken = (req?.headers?.['x-device-token'] as string) || body.device_token;
    return this.authService.loginPortaria(body.login, body.senha, deviceToken);
  }

  // 2ª etapa do login de síndico no console (código enviado por e-mail).
  @Public()
  @Throttle({ medium: { limit: 10, ttl: 10 * 60_000 } })
  @Post('login-portaria/mfa')
  @HttpCode(200)
  verificarMfaPortaria(
    @Body() body: { mfa_token: string; code: string; remember_device?: boolean },
    @Req() req: any,
  ) {
    return this.authService.verificarMfaPortaria(body.mfa_token, body.code, body.remember_device ?? false, {
      userAgent: req?.headers?.['user-agent'],
      ip: extractClientIp(req) || req?.ip,
    });
  }

  // Só a portaria-web já logada usa (recupera o nome do próprio condomínio).
  @Get('condominio/:id')
  async getCondominio(@Param('id', ParseIntPipe) id: number, @ReqUser() payload: JwtPayload) {
    return this.authService.getCondominioNome(id, payload);
  }

  // Síndico com mais de um condomínio escolhe em qual entrar (ou troca depois).
  // Autenticado: o vínculo é conferido contra o síndico do JWT.
  // O service grava a linha de LOGIN no condomínio escolhido; o log automático seria uma segunda
  // linha genérica ("Criação em Autenticação") no condomínio de origem.
  @SkipAudit()
  @Post('selecionar-condominio')
  @HttpCode(200)
  selecionarCondominio(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id_condominio: number },
  ) {
    return this.authService.selecionarCondominio(payload, Number(body.id_condominio));
  }

  // Confere a senha atual: sem limite próprio, uma sessão aberta testava senhas no ritmo do throttle global.
  @Throttle({ medium: { limit: 10, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @ReqUser() payload: JwtPayload,
    @Body() body: { senhaAtual: string; novaSenha: string },
  ) {
    // O id do funcionário vem SEMPRE do JWT, nunca do body. Antes o id era
    // aceito do corpo, permitindo que qualquer autenticado trocasse a senha
    // de outro porteiro chutando o id (e conhecendo a senha atual dele).
    return this.authService.changePassword(payload.sub, body.senhaAtual, body.novaSenha, payload.typeAccess, payload);
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

  // Idem: o service grava a linha de LOGIN (método qr) quando a sessão é confirmada.
  @SkipAudit()
  @Post('qr/authorize')
  @HttpCode(200)
  authorizeQrSession(
    @ReqUser() payload: JwtPayload,
    @Body() body: { qrToken: string; id_condominio: number }
  ) {
    return this.authService.authorizeQrSession(payload, body.qrToken, Number(body.id_condominio));
  }
}