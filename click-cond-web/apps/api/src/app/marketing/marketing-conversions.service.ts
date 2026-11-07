import { Injectable, Logger } from '@nestjs/common';
import type { Crm_Leads } from '../prisma/generated';
import { MarketingSegredosService } from './marketing-segredos.service';

export interface LeadWhatsAppConfirmado {
  wamid: string;
  em: Date;
  lead: Pick<Crm_Leads, 'origem' | 'oppref' | 'gclid' | 'pagina'>;
}

const OPENAI_EVENTS_URL = 'https://bzr.openai.com/v1/events';

@Injectable()
export class MarketingConversionsService {
  private readonly logger = new Logger(MarketingConversionsService.name);

  constructor(private readonly segredos: MarketingSegredosService) {}

  async confirmarLeadWhatsApp(input: LeadWhatsAppConfirmado): Promise<void> {
    if (input.lead.origem === 'openai') await this.enviarOpenAi(input);
    if (input.lead.origem === 'google') this.registrarGoogleViaScript();
  }

  private async enviarOpenAi({ wamid, em, lead }: LeadWhatsAppConfirmado): Promise<void> {
    const pixelId = (await this.segredos.obter('OPENAI_ADS_PIXEL_ID'))?.trim();
    const apiKey = (await this.segredos.obter('OPENAI_ADS_CONVERSIONS_API_KEY'))?.trim();
    const oppref = lead.oppref?.trim();
    if (!pixelId || !apiKey || !oppref) return;

    try {
      const resposta = await fetch(`${OPENAI_EVENTS_URL}?pid=${encodeURIComponent(pixelId)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          events: [{ id: wamid, type: 'lead_created', timestamp_ms: em.getTime(), oppref, action_source: 'offline', data: { type: 'customer_action' } }],
        }),
      });
      if (!resposta.ok) this.logger.warn(`OpenAI Ads conversão rejeitada (${resposta.status})`);
    } catch (e: any) {
      this.logger.error(`OpenAI Ads conversão falhou (${wamid}): ${e?.message ?? e}`);
    }
  }

  private registrarGoogleViaScript(): void {
    this.logger.log('Conversão Google confirmada; o Google Ads Script envia como conversão offline.');
  }
}
