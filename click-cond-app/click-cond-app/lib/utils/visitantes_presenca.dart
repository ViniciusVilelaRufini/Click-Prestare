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

/// Resultado da validação campo a campo do cadastro de visitante/prestador.
class ValidacaoVisitanteResult {
  final String? erroNome;
  final String? erroInicio;
  final String? erroTermino;

  const ValidacaoVisitanteResult({
    this.erroNome,
    this.erroInicio,
    this.erroTermino,
  });

  bool get isValid =>
      erroNome == null && erroInicio == null && erroTermino == null;

  /// Retorna a primeira chave de erro na ordem prioritária.
  String? get primeiroErro => erroNome ?? erroInicio ?? erroTermino;
}

/// Valida os campos do cadastro de visitante identificando individualmente os erros de cada campo.
ValidacaoVisitanteResult validarCamposVisitanteDetalhado({
  required String nome,
  required DateTime? inicio,
  required DateTime? termino,
}) {
  String? erroNome;
  String? erroInicio;
  String? erroTermino;

  if (nome.trim().isEmpty) erroNome = 'visitante_nome_obrigatorio';
  if (inicio == null) erroInicio = 'visitante_inicio_obrigatorio';
  if (termino == null) {
    erroTermino = 'visitante_termino_obrigatorio';
  } else if (inicio != null && termino.isBefore(inicio)) {
    erroTermino = 'visitante_periodo_invalido';
  }

  return ValidacaoVisitanteResult(
    erroNome: erroNome,
    erroInicio: erroInicio,
    erroTermino: erroTermino,
  );
}

/// Valida o cadastro de visitante/prestador antes de ir à rede.
///
/// Devolve a CHAVE da mensagem de erro (para o getText da tela), ou null se
/// está tudo certo.
///
/// A janela de validade é obrigatória de propósito: sem `data_termino` o
/// `isExpired` da lista nunca vira true, e o QR/PIN da portaria continua
/// válido para sempre — um crachá permanente criado sem querer. Nome também
/// é obrigatório: é o que o porteiro confere na entrada.
String? validarCadastroVisitante({
  required String nome,
  required DateTime? inicio,
  required DateTime? termino,
}) {
  return validarCamposVisitanteDetalhado(
    nome: nome,
    inicio: inicio,
    termino: termino,
  ).primeiroErro;
}

/// Define se o usuário tem permissão para editar um cadastro existente de visitante.
/// Porteiros/funcionários NÃO podem editar cadastros feitos por moradores; apenas
/// moradores e síndicos têm permissão de edição.
bool podeEditarVisitante({
  required String userType,
  required bool canManage,
}) {
  if (userType == 'funcionario') return false;
  return canManage;
}

/// Define se o porteiro ou usuário pode registrar entrada/saída do visitante.
/// O porteiro tem permissão plena para controlar fluxo de entrada e baixa de visitas.
bool podeRegistrarEntradaSaidaVisitante({
  required bool canManage,
}) {
  return canManage;
}

