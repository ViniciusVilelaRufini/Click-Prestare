/**
 * Prestare — envia os números das campanhas para o CRM (aba Marketing).
 * Instalar em Google Ads → Ferramentas → Ações em massa → Scripts → +,
 * colar este arquivo, preencher TOKEN, autorizar e agendar "Diariamente".
 * Envia os últimos 7 dias (o upsert no CRM torna o reenvio inofensivo).
 */
var URL = 'https://api.prestarecondominios.com.br/api/public/ads/google';
var TOKEN = 'COLE_AQUI_O_ADS_INGEST_TOKEN';

function main() {
  var query =
    'SELECT campaign.id, campaign.name, segments.date, metrics.impressions, ' +
    'metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    'FROM campaign WHERE segments.date DURING LAST_7_DAYS';
  var rows = [];
  var it = AdsApp.search(query);
  while (it.hasNext()) {
    var r = it.next();
    rows.push({
      campanha_id: String(r.campaign.id),
      campanha_nome: r.campaign.name,
      dia: r.segments.date,
      impressoes: Number(r.metrics.impressions || 0),
      cliques: Number(r.metrics.clicks || 0),
      gasto: Number(r.metrics.costMicros || 0) / 1e6,
      conversoes: Number(r.metrics.conversions || 0),
    });
  }
  var resp = UrlFetchApp.fetch(URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Ingest-Token': TOKEN },
    payload: JSON.stringify({ rows: rows }),
    muteHttpExceptions: true,
  });
  Logger.log('CRM respondeu ' + resp.getResponseCode() + ': ' + resp.getContentText());
}
