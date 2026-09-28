import { Injectable, Logger } from '@nestjs/common';
import type { LinhaAnuncio } from './marketing-ads.service';
import { diaBrt } from './datas-brt';
import { MarketingSegredosService } from './marketing-segredos.service';

const BASE = 'https://api.ads.openai.com/v1';
const HORA = 3600;
const BRT = 3 * HORA; // conta de anúncios em America/Sao_Paulo (UTC-3, sem horário de verão)

export interface JanelasOpenAi {
  /** Insights: horas cheias, do início do primeiro dia até a última hora cheia. */
  insights: { start: number; end: number };
  /** Conversões diárias: só aceitam meias-noites locais — vai até a meia-noite de hoje. */
  conversoes: { start: number; end: number };
}

/**
 * Formato confirmado na API real (28/09/2026): time_ranges é `unix_range` com
 * start/end em segundos, sempre em hora cheia, e end não pode estar no futuro.
 * As conversões diárias exigem limites na meia-noite local da conta.
 */
export function janelasOpenAi(agora: Date, dias: number): JanelasOpenAi {
  const s = Math.floor(agora.getTime() / 1000);
  const horaCheia = Math.floor(s / HORA) * HORA;
  const meiaNoiteHoje = Math.floor((s - BRT) / 86400) * 86400 + BRT;
  const inicio = meiaNoiteHoje - dias * 86400;
  return { insights: { start: inicio, end: horaCheia }, conversoes: { start: inicio, end: meiaNoiteHoje } };
}

const faixa = (j: { start: number; end: number }) =>
  JSON.stringify({ type: 'unix_range', start: String(j.start), end: String(j.end) });

/**
 * Leitura da OpenAI Ads API (developers.openai.com/ads). Chave criada em
 * Ads Manager → Configurações; fica em OPENAI_ADS_API_KEY.
 * Insights: GET /ad_account/insights — linhas com start_time, campaign_id,
 * campaign_name, impressions, clicks, spend.
 * Conversões: POST /conversions/insights — linhas com date (YYYY-MM-DD),
 * entity_id (id da campanha) e conversions.
 */
@Injectable()
export class OpenAiAdsClient {
  private readonly logger = new Logger(OpenAiAdsClient.name);

  constructor(private readonly segredos: MarketingSegredosService) {}

  async estaConfigurado(): Promise<boolean> {
    return !!(await this.segredos.obter('OPENAI_ADS_API_KEY'));
  }

  private async headers() {
    const chave = await this.segredos.obter('OPENAI_ADS_API_KEY');
    return { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' };
  }

  async buscarDiario(dias: number, agora = new Date()): Promise<LinhaAnuncio[]> {
    const janelas = janelasOpenAi(agora, dias);
    const qs = new URLSearchParams();
    qs.set('aggregation_level', 'campaign');
    qs.set('time_granularity', 'daily');
    qs.append('time_ranges[]', faixa(janelas.insights));
    for (const f of ['campaign.id', 'campaign.name', 'impressions', 'clicks', 'spend']) qs.append('fields[]', f);
    qs.set('limit', '2000');

    const r = await fetch(`${BASE}/ad_account/insights?${qs}`, { headers: await this.headers() });
    if (!r.ok) throw new Error(`OpenAI Ads insights ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const insights: any = await r.json();
    const linhas: any[] = insights.data ?? [];

    const convPor = new Map<string, number>();
    const campanhas = [...new Set(linhas.map((l) => String(l.campaign_id ?? '')).filter(Boolean))];
    if (campanhas.length && janelas.conversoes.end > janelas.conversoes.start) {
      const c = await fetch(`${BASE}/conversions/insights`, {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({
          aggregation_level: 'campaign',
          time_ranges: [faixa(janelas.conversoes)],
          time_granularity: 'daily',
          group_by_entity: true,
          entity_ids: campanhas,
        }),
      });
      if (c.ok) {
        const conv: any = await c.json();
        for (const row of conv.data ?? []) convPor.set(`${row.entity_id}|${row.date}`, Number(row.conversions ?? 0));
      } else {
        this.logger.warn(`OpenAI Ads conversões ${c.status}: ${(await c.text()).slice(0, 200)}`);
      }
    }

    return linhas.map((row) => {
      const dia = diaBrt(new Date(Number(row.start_time) * 1000));
      const id = String(row.campaign_id ?? '');
      return {
        campanha_id: id,
        campanha_nome: String(row.campaign_name ?? id),
        dia,
        impressoes: Number(row.impressions ?? 0),
        cliques: Number(row.clicks ?? 0),
        gasto: Number(row.spend ?? 0),
        conversoes: convPor.get(`${id}|${dia}`) ?? 0,
      };
    });
  }
}
