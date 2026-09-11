import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ConsentimentosService } from './consentimentos.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('consentimentos')
export class ConsentimentosController {
  constructor(private readonly service: ConsentimentosService) {}

  /** O app consulta no login e no bootstrap. */
  @Get('pendentes')
  pendentes(@ReqUser() user: JwtPayload) {
    return this.service.pendentes(user);
  }

  @Post()
  @HttpCode(200)
  registrar(
    @Body() body: { privacidade?: boolean; biometria?: boolean },
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.registrar(user, {
      privacidade: body?.privacidade === true,
      biometria: body?.biometria === true,
    });
  }
}
