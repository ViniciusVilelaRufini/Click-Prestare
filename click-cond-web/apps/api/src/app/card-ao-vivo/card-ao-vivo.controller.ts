import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { idUsuarioDoToken } from '../auth/usuario-do-token.util';
import { CardAoVivoService } from './card-ao-vivo.service';

/**
 * Rotas do app para o card ao vivo. O iPhone chama direto do Swift (sessão
 * guardada no keychain pela ponte), o Android do handler de segundo plano.
 */
@Controller('card-ao-vivo')
export class CardAoVivoController {
  constructor(private readonly service: CardAoVivoService) {}

  /** O aparelho confirma que o card abriu; sem isto, a reserva manda o push comum. */
  @Post('confirmar')
  @HttpCode(200)
  confirmar(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id_cartao?: number | string; token_atualizacao?: string },
  ) {
    const idUser = idUsuarioDoToken(payload);
    if (!idUser) return { ok: false };
    return this.service.confirmar(idUser, Number(body?.id_cartao), body?.token_atualizacao ?? null);
  }
}
