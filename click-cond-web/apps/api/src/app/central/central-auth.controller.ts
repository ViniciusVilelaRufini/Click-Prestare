import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { CentralAuthService } from './central-auth.service';

/**
 * Login do operador da central (`/central/login` no console): senha, depois código por e-mail.
 * Fora do log automático de auditoria: o corpo é senha e código.
 */
@Controller('central/auth')
export class CentralAuthController {
  constructor(private readonly auth: CentralAuthService) {}

  @Public()
  @SkipAudit()
  // Mesmo limite do login do console: 5 tentativas / minuto / IP.
  @Throttle({ medium: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email?: string; senha?: string }) {
    return this.auth.login(body?.email, body?.senha);
  }

  @Public()
  @SkipAudit()
  // Mesmo limite da 2ª etapa do login do síndico no console.
  @Throttle({ medium: { limit: 10, ttl: 10 * 60_000 } })
  @Post('verificar')
  @HttpCode(200)
  verificar(@Body() body: { desafio?: string; codigo?: string }) {
    return this.auth.verificar(body?.desafio, body?.codigo);
  }

  @SkipAudit()
  @Throttle({ medium: { limit: 10, ttl: 60_000 } })
  @Post('senha')
  @HttpCode(200)
  trocarSenha(@Body() body: { senha_atual?: string; senha_nova?: string }, @ReqUser() user: JwtPayload) {
    return this.auth.trocarSenha(user, body?.senha_atual, body?.senha_nova);
  }
}
