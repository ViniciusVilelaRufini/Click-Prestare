import { Injectable, Logger } from '@nestjs/common';
import type { Crm_Leads } from '../prisma/generated';

export interface LeadWhatsAppConfirmado {
  wamid: string;
  em: Date;
  lead: Pick<Crm_Leads, 'origem' | 'oppref' | 'gclid' | 'pagina'>;
}

const OPENAI_EVENTS_URL = 'https://bzr.openai.com/v1/events';
const GOOGLE_CONFIGURACAO = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_CONVERSION_ACTION',
] as const;

@Injectable()
export class MarketingConversionsService {
  private readonly logger = new Logger(MarketingConversionsService.name);

  async confirmarLeadWhatsApp(input: LeadWhatsAppConfirmado): Promise<void> {
    if (input.lead.origem === 'openai') await this.enviarOpenAi(input);
    if (input.lead.origem === 'google') this.registrarGoogleDesabilitado();
  }

  private async enviarOpenAi({ wamid, em, lead }: LeadWhatsAppConfirmado): Promise<void> {
    const pixelId = process.env.OPENAI_ADS_PIXEL_ID?.trim();
    const apiKey = process.env.OPENAI_ADS_CONVERSIONS_API_KEY?.trim();
    const oppref = lead.oppref?.trim();
    if (!pixelId || !apiKey || !oppref) return;

    try {
      const resposta = await fetch(OPENAI_EVENTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-OpenAI-Ads-Pixel-Id': pixelId,
        },
        body: JSON.stringify({
          events: [{ event_id: wamid, type: 'lead_created', timestamp_ms: em.getTime(), oppref, action_source: 'offline' }],
        }),
      });
      if (!resposta.ok) this.logger.warn(`OpenAI Ads conversão rejeitada (${resposta.status})`);
    } catch (e: any) {
      this.logger.error(`OpenAI Ads conversão falhou (${wamid}): ${e?.message ?? e}`);
    }
  }

  private registrarGoogleDesabilitado(): void {
    const configurado = GOOGLE_CONFIGURACAO.every((nome) => Boolean(process.env[nome]?.trim()));
    this.logger.warn(configurado
      ? 'Conversão Google confirmada, mas upload offline permanece desabilitado.'
      : 'Conversão Google confirmada sem credenciais completas; upload offline não realizado.');
  }
}
