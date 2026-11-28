import { BadRequestException, Body, Controller, Get, Header, Headers, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { InterfoneService } from './interfone.service';
import type { EventoServico } from './interfone.service';
import { assertVozToken } from './voz-token.util';

/**
 * Rotas do serviço de voz (Asterisk + ARI) → API. Sem JWT: autenticadas pelo
 * cabeçalho `x-voz-token` (VOZ_INTERNAL_TOKEN), que falha fechado. Sem
 * throttle (o serviço consulta a cada chamada e a cada 60 s) e sem auditoria
 * automática (o registro da chamada já é o histórico). `no-store` em todas:
 * `contas` devolve as senhas SIP.
 */
@Public()
@SkipThrottle({ short: true, medium: true })
@SkipAudit()
@Controller('interno/interfone')
export class InterfoneInternoController {
  constructor(private readonly interfone: InterfoneService) {}

  @Header('Cache-Control', 'no-store')
  @Get('contas')
  contas(@Headers('x-voz-token') token: string | undefined) {
    assertVozToken(token);
    return this.interfone.contas();
  }

  @Header('Cache-Control', 'no-store')
  @Post('chamadas')
  @HttpCode(200)
  novaChamada(@Headers('x-voz-token') token: string | undefined, @Body() body: { conta?: string; numero?: string }) {
    assertVozToken(token);
    if (typeof body?.conta !== 'string' || typeof body?.numero !== 'string') {
      throw new BadRequestException('conta e numero são obrigatórios.');
    }
    return this.interfone.novaChamadaFacial(body.conta, body.numero);
  }

  @Header('Cache-Control', 'no-store')
  @Get('chamadas/:id')
  chamada(@Headers('x-voz-token') token: string | undefined, @Param('id', ParseIntPipe) id: number) {
    assertVozToken(token);
    return this.interfone.dadosParaServico(id);
  }

  @Header('Cache-Control', 'no-store')
  @Post('chamadas/:id/evento')
  @HttpCode(200)
  evento(@Headers('x-voz-token') token: string | undefined, @Param('id', ParseIntPipe) id: number, @Body() body: EventoServico) {
    assertVozToken(token);
    return this.interfone.evento(id, body);
  }

  @Header('Cache-Control', 'no-store')
  @Post('registros')
  @HttpCode(200)
  registros(@Headers('x-voz-token') token: string | undefined, @Body() body: { contas?: { conta: string; registrado: boolean }[] }) {
    assertVozToken(token);
    return this.interfone.registros(body?.contas as any);
  }
}
