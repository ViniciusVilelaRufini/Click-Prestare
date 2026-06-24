import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { CrmAuthService } from './crm-auth.service';

@Controller('crm/auth')
export class CrmAuthController {
  constructor(private readonly authService: CrmAuthService) {}

  @Public()
  // Mesmo throttle estrito do login da portaria: 5 tentativas/min/IP.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { login: string; senha: string }) {
    return this.authService.login(body.login, body.senha);
  }
}
