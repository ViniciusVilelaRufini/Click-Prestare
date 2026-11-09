/**
 * Prestare — relatório só de leitura das campanhas (rodar com "Visualizar").
 * Não altera nada. Período: desde o início das campanhas novas (07/11/2026).
 */
var DESDE = '2026-11-07';

function hoje() {
  return Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}

function rodar(titulo, gaql) {
  Logger.log('### ' + titulo);
  var rows = AdsApp.search(gaql);
  var n = 0;
  while (rows.hasNext()) {
    var r = rows.next();
    Logger.log(JSON.stringify(r));
    n++;
  }
  if (!n) Logger.log('(nada)');
}

function main() {
  var p = " segments.date BETWEEN '" + DESDE + "' AND '" + hoje() + "' ";
  rodar('Campanhas',
    'SELECT campaign.name, campaign.status, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
    'metrics.conversions, metrics.ctr, metrics.average_cpc, metrics.search_impression_share, ' +
    'metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share ' +
    'FROM campaign WHERE campaign.status != REMOVED AND' + p + 'AND metrics.impressions > 0');
  rodar('Por dia',
    'SELECT segments.date, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros FROM campaign WHERE' + p +
    'AND metrics.impressions > 0 ORDER BY segments.date');
  rodar('Grupos',
    'SELECT campaign.name, ad_group.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    'FROM ad_group WHERE' + p + 'AND metrics.impressions > 0');
  rodar('Palavras-chave (todas ativas, com nota de qualidade)',
    'SELECT campaign.name, ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ' +
    'ad_group_criterion.status, ad_group_criterion.system_serving_status, ad_group_criterion.approval_status, ' +
    'ad_group_criterion.quality_info.quality_score, ad_group_criterion.quality_info.search_predicted_ctr, ' +
    'ad_group_criterion.quality_info.creative_quality_score, ad_group_criterion.quality_info.post_click_quality_score, ' +
    'ad_group_criterion.position_estimates.first_page_cpc_micros, ad_group_criterion.effective_cpc_bid_micros, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros ' +
    'FROM keyword_view WHERE campaign.status = ENABLED AND ad_group_criterion.status = ENABLED AND' + p);
  rodar('Termos de pesquisa',
    'SELECT campaign.name, search_term_view.search_term, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    'FROM search_term_view WHERE' + p + 'ORDER BY metrics.impressions DESC LIMIT 60');
  rodar('Anúncios (aprovação)',
    'SELECT campaign.name, ad_group.name, ad_group_ad.status, ad_group_ad.policy_summary.approval_status, ' +
    'ad_group_ad.ad_strength, metrics.impressions, metrics.clicks ' +
    'FROM ad_group_ad WHERE campaign.status = ENABLED AND ad_group_ad.status != REMOVED AND' + p);
  rodar('Conversões por ação',
    'SELECT campaign.name, segments.conversion_action_name, metrics.all_conversions FROM campaign WHERE' + p + 'AND metrics.all_conversions > 0');
}
