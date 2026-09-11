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
/// aguardando"). Esta função existe para as duas superfícies contarem igual
/// — e por ser pura, a regra pode ser testada.
///
/// Quem está autorizado e ainda não chegou aparece na aba "Cadastrados" do
/// app; não há contador próprio para isso.

/// Fisicamente dentro: registrou entrada e não registrou saída.
///
/// Sem inferência a partir de autorização: presença é fato registrado na
/// portaria, não consequência de ter permissão.
bool estaNoLocal(Map<dynamic, dynamic> item) {
  return item['data_entrada'] != null && item['data_saida'] == null;
}
