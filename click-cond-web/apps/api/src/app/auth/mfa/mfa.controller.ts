import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { MfaService } from './mfa.service';
import { Public } from '../public.decorator';
import { extractClientIp } from '../../common/context/request-context';

@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

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

  @Public()
  @Post('resend')
  @HttpCode(200)
  async resend(@Body() body: { mfa_token: string }) {
    return this.mfaService.resendChallenge(body.mfa_token);
  }

  @Public()
  @Get('health')
  async health() {
    return this.mfaService.checkMailHealth();
  }
}
