/**
 * Prestare — envia os números das campanhas para o CRM (aba Marketing).
 * Instalar em Google Ads → Ferramentas → Ações em massa → Scripts → +,
 * colar este arquivo, preencher TOKEN, autorizar e agendar "Diariamente".
 * Envia os últimos 7 dias (o upsert no CRM torna o reenvio inofensivo).
 *
 * Também sobe como conversão offline os leads do Google que confirmaram no
 * WhatsApp (últimos 30 dias). A ação de conversão NOME_CONVERSAO precisa
 * existir na conta, do tipo "Importação → cliques". O reenvio diário dos
 * mesmos leads usa a mesma hora e o Google descarta como duplicata.
 */
var URL = 'https://api.prestarecondominios.com.br/api/public/ads/google';
var TOKEN = 'COLE_AQUI_O_ADS_INGEST_TOKEN';
var NOME_CONVERSAO = 'Lead WhatsApp confirmado';

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
  enviarConversoes();
}

function enviarConversoes() {
  try {
    var resp = UrlFetchApp.fetch(URL + '/conversoes', {
      method: 'get',
      headers: { 'X-Ingest-Token': TOKEN },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log('Conversões: CRM respondeu ' + resp.getResponseCode() + ': ' + resp.getContentText());
      return;
    }
    var conversoes = JSON.parse(resp.getContentText());
    if (!conversoes.length) {
      Logger.log('Conversões: 0');
      return;
    }
    var upload = AdsApp.bulkUploads()
      .newCsvUpload(['Google Click ID', 'Conversion Name', 'Conversion Time'], { moneyInMicros: false })
      .forOfflineConversions()
      .setFileName('crm-prestare-' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd'));
    conversoes.forEach(function (c) {
      upload.append({ 'Google Click ID': c.gclid, 'Conversion Name': NOME_CONVERSAO, 'Conversion Time': c.conversao_em });
    });
    upload.apply();
    Logger.log('Conversões: ' + conversoes.length + ' enviadas para "' + NOME_CONVERSAO + '"');
  } catch (e) {
    Logger.log('Conversões: falhou — ' + e);
  }
}
