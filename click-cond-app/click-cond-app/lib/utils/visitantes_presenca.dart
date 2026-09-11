/// Quem está DENTRO do prédio e quem apenas está AUTORIZADO a entrar.
///
/// São coisas diferentes, e juntá-las produzia uma leitura perigosa: como
/// todo visitante nasce com `liberado = 1` (default da tabela, necessário
/// para o PIN funcionar), a regra de autorização capturava quase todo mundo
/// que ainda não tinha saído. A aba do app dizia "No Local" e listava gente
/// que nunca chegou.
///
/// Numa evacuação, essa é a lista que alguém consulta para saber quem está no
/// prédio. Ela precisa significar exatamente o que diz.
///
/// A portaria-web já separava assim ("Ativos no local" x "Liberados
/// aguardando"). Estas funções existem para as duas superfícies contarem
/// igual — e por serem puras, a regra pode ser testada.

/// Fisicamente dentro: registrou entrada e não registrou saída.
///
/// Sem inferência a partir de autorização: presença é fato registrado na
/// portaria, não consequência de ter permissão.
bool estaNoLocal(Map<dynamic, dynamic> item) {
  return item['data_entrada'] != null && item['data_saida'] == null;
}

/// Autorizado a entrar, mas ainda não chegou.
///
/// [agora] é injetável porque a regra depende de "hoje" — sem isso, o teste
/// da liberação agendada dependeria da data em que roda.
bool aguardandoChegada(Map<dynamic, dynamic> item, DateTime agora) {
  // Quem já entrou (ou já saiu) não está aguardando.
  if (item['data_entrada'] != null || item['data_saida'] != null) return false;

  final liberado =
      item['liberado'] == 1 || item['liberado'] == '1' || item['vaga'] != null;
  if (liberado) return true;

  // Liberação agendada para hoje, ou período que engloba agora.
  final inicioStr = item['data_hora_inicio'];
  if (inicioStr != null) {
    final inicio = DateTime.tryParse(inicioStr.toString());
    if (inicio != null) {
      final fimStr = item['data_hora_termino'];
      final fim = fimStr != null ? DateTime.tryParse(fimStr.toString()) : null;
      final ehHoje = inicio.year == agora.year &&
          inicio.month == agora.month &&
          inicio.day == agora.day;
      if (ehHoje && (fim == null || agora.isBefore(fim))) return true;
      if (fim != null && agora.isAfter(inicio) && agora.isBefore(fim)) return true;
    }
  }
  return false;
}
