/// Condomínio que veio no push (`id_condominio`, string no FCM), ou null.
///
/// A API manda o condomínio nos pushes 'financeiro' e 'autorizacao_visitante'
/// para o toque abrir a tela certa:
/// - autorização: os pendentes DAQUELE condomínio (quem tem vínculo em dois via
///   a lista do condomínio aberto no app — vazia). Passado à tela, sem trocar o
///   condomínio aberto;
/// - financeiro: com o app fechado não há condomínio aberto e a API dava 403.
///   Também passado à tela (`MoradorFinanceiroView(idCondominio:)`), sem
///   trocar o condomínio aberto.
int? condominioDoPush(Map<String, dynamic> data) {
  final id = int.tryParse('${data['id_condominio'] ?? ''}');
  return id != null && id > 0 ? id : null;
}
