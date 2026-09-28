import { Injectable, Logger } from '@nestjs/common';
import type { LinhaAnuncio } from './marketing-ads.service';

const BASE = 'https://api.ads.openai.com/v1';

/**
 * Leitura da OpenAI Ads API (developers.openai.com/ads). Chave criada em
 * Ads Manager → Configurações; fica em OPENAI_ADS_API_KEY.
 * Insights: GET /ad_account/insights (impressões, cliques, gasto por campanha/dia).
 * Conversões: POST /conversions/insights.
 */
@Injectable()
export class OpenAiAdsClient {
  private readonly logger = new Logger(OpenAiAdsClient.name);

  estaConfigurado(): boolean {
    return !!process.env.OPENAI_ADS_API_KEY;
  }

  private headers() {
    return { Authorization: `Bearer ${process.env.OPENAI_ADS_API_KEY}`, 'Content-Type': 'application/json' };
  }

  async buscarDiario(de: string, ate: string): Promise<LinhaAnuncio[]> {
    const range = JSON.stringify({ since: de, until: ate });
    const qs = new URLSearchParams();
    qs.set('aggregation_level', 'campaign');
    qs.set('time_granularity', 'daily');
    qs.append('time_ranges[]', range);
    for (const f of ['campaign_id', 'campaign_name', 'impressions', 'clicks', 'spend']) qs.append('fields[]', f);
    qs.set('limit', '2000');

    const r = await fetch(`${BASE}/ad_account/insights?${qs}`, { headers: this.headers() });
    if (!r.ok) throw new Error(`OpenAI Ads insights ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const insights: any = await r.json();

    const c = await fetch(`${BASE}/conversions/insights`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ aggregation_level: 'campaign', time_ranges: [{ since: de, until: ate }], time_granularity: 'daily', group_by_entity: false }),
    });
    const conv: any = c.ok ? await c.json() : { data: [] };
    if (!c.ok) this.logger.warn(`OpenAI Ads conversões ${c.status}; seguindo sem conversões`);

    const convPor = new Map<string, number>();
    for (const row of conv.data ?? []) {
      const k = `${row.campaign_id ?? row.entity_id ?? ''}|${String(row.date ?? row.date_start ?? '').slice(0, 10)}`;
      convPor.set(k, Number(row.conversions ?? 0));
    }

    return (insights.data ?? []).map((row: any) => {
      const dia = String(row.date ?? row.date_start ?? '').slice(0, 10);
      const id = String(row.campaign_id ?? row.id ?? '');
      return {
        campanha_id: id,
        campanha_nome: String(row.campaign_name ?? row.name ?? id),
        dia,
        impressoes: Number(row.impressions ?? 0),
        cliques: Number(row.clicks ?? 0),
        gasto: Number(row.spend ?? 0),
        conversoes: convPor.get(`${id}|${dia}`) ?? 0,
      };
    });
  }
}
