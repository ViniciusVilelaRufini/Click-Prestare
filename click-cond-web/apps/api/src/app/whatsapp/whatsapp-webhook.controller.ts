import { Controller, Get, Header, Headers, HttpCode, Logger, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { MarketingSegredosService } from '../marketing/marketing-segredos.service';
import { WhatsappInboxService } from './whatsapp-inbox.service';
import { assinaturaValida, interpretarWebhook } from './whatsapp-puro';

@Controller('public/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(private readonly segredos: MarketingSegredosService, private readonly inbox: WhatsappInboxService) {}

  @Get('webhook')
  @Header('Content-Type', 'text/plain')
  async verificar(@Query('hub.mode') modo: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') desafio: string) {
    const esperado = await this.segredos.obter('WA_VERIFY_TOKEN');
    if (modo !== 'subscribe' || !esperado || token !== esperado) throw new UnauthorizedException();
    return desafio;
  }

  @Post('webhook')
  @HttpCode(200)
  async receber(@Req() req: { rawBody?: Buffer; body: unknown }, @Headers('x-hub-signature-256') assinatura: string) {
    if (!assinaturaValida(req.rawBody, assinatura, await this.segredos.obter('WA_APP_SECRET'))) throw new UnauthorizedException();
    const { mensagens, status } = interpretarWebhook(req.body);
    // Sempre 200 após assinatura válida: erro de processamento vai para o log,
    // senão o Meta reenvia em loop e acaba desativando o webhook.
    for (const m of mensagens) await this.inbox.registrarEntrada(m).catch((e) => this.logger.error(`entrada ${m.wamid}: ${e?.message}`));
    for (const s of status) await this.inbox.atualizarStatus(s).catch((e) => this.logger.error(`status ${s.wamid}: ${e?.message}`));
    return 'ok';
  }
}
