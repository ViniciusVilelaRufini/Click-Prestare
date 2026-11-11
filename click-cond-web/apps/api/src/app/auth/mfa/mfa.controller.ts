import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MfaService } from './mfa.service';
import { Public } from '../public.decorator';
import { extractClientIp } from '../../common/context/request-context';

@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  // 10 por 10 minutos por IP: o código tem 6 dígitos, o limite por desafio sozinho não basta.
  @Throttle({ medium: { limit: 10, ttl: 10 * 60_000 } })
  @Public()
  @Post('verify')
  @HttpCode(200)
  async verify(
    @Body() body: { mfa_token: string; code: string; remember_device?: boolean },
    @Req() req: any,
  ) {
    const userAgent = req.headers?.['user-agent'];
    const ip = extractClientIp(req) || req.ip;

    return this.mfaService.verifyChallenge(
      body.mfa_token,
      body.code,
      body.remember_device ?? false,
      { userAgent, ip },
    );
  }

  @Throttle({ medium: { limit: 10, ttl: 10 * 60_000 } })
  @Public()
  @Post('resend')
  @HttpCode(200)
  async resend(@Body() body: { mfa_token: string }) {
    return this.mfaService.resendChallenge(body.mfa_token);
  }

  // Não é pública (pentest 04/11): cada chamada abre uma conexão SMTP (transporter.verify) e, em
  // falha, devolvia a mensagem crua do servidor de e-mail. Nenhum front-end a usa.
  @Get('health')
  async health() {
    return this.mfaService.checkMailHealth();
  }
}
