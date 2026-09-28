import { Body, Controller, ForbiddenException, Headers, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { MarketingAdsService } from './marketing-ads.service';
import { MarketingLeadsService } from './marketing-leads.service';
import { origemPermitida } from './origem-permitida';

/**
 * Entradas públicas de marketing. Sem login: o formulário da landing (/sobre)
 * e o Google Ads Script chamam de fora. O lead tem throttle; o ingest de
 * anúncios (Task 4) exige token.
 */
@Controller('public')
export class MarketingPublicController {
  constructor(private readonly leads: MarketingLeadsService, private readonly ads: MarketingAdsService) {}

  @Public()
  @Throttle({ medium: { limit: 5, ttl: 60_000 } })
  @Post('leads')
  @HttpCode(204)
  async criarLead(@Headers('origin') origin: string | undefined, @Body() body: unknown): Promise<void> {
    if (!origemPermitida(origin)) throw new ForbiddenException();
    await this.leads.criar(body);
  }

  @Public()
  @Throttle({ medium: { limit: 10, ttl: 60_000 } })
  @Post('ads/google')
  ingestGoogle(@Headers('x-ingest-token') token: string | undefined, @Body() body: unknown) {
    return this.ads.ingestGoogle(token, body);
  }
}
