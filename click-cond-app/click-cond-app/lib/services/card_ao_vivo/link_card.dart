/// Toque no card ao vivo do iPhone: o widget abre o app por
/// `clickprestare://solicitacoes` (portaria remota) ou
/// `clickprestare://delivery`. Devolve o tipo de tela que
/// `FirebaseService.abrirTela` entende, ou null se o link não é do card.
String? telaDoLinkCard(Uri uri) {
  if (uri.scheme != 'clickprestare') return null;
  switch (uri.host) {
    case 'solicitacoes':
      return 'autorizacao_visitante';
    case 'delivery':
      return 'delivery';
    default:
      return null;
  }
}
