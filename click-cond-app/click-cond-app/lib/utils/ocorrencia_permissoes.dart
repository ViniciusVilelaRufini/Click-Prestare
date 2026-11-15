/// Quem vê o lápis de editar (e, dentro dele, o Excluir) na ocorrência: só o
/// autor (Users.id, o mesmo que a API confere em `ehAutor`), só enquanto
/// Pendente e só enquanto a equipe não falou — sem resposta pública da
/// administração (`resposta_at`) e sem mensagem da equipe no chat
/// ([mensagens], a lista de `ocorrencias/mensagens/get-all`). É o filtro
/// `semRespostaDaEquipe` da API, que recusa editar/excluir nesses casos.
/// Status nulo conta como Pendente e a caixa não importa, igual ao
/// `estaPendente` da API.
///
/// Sem [mensagens] (não carregou), decide só pelo resto; se a equipe tiver
/// escrito no chat, a recusa da API aparece na tela ao salvar ou excluir.
bool podeEditarOcorrencia(Map? obj, String userId, {List? mensagens}) {
  if (obj == null || userId.isEmpty) return false;
  if (obj['user']?.toString() != userId) return false;
  final status = (obj['status']?.toString() ?? 'Pendente').trim().toLowerCase();
  if (status != 'pendente') return false;
  if (temRespostaDaAdministracao(obj)) return false;
  if (equipeJaFalouNoChat(mensagens, obj['user'])) return false;
  return true;
}

/// A administração já respondeu publicamente. Decide por `resposta_at`, como
/// `equipeJaRespondeu`/`semRespostaDaEquipe` da API: ela grava a data ao
/// responder (mesmo com o texto vazio). Registro antigo com texto em
/// `resposta` e sem data a API deixa editar — o app também.
bool temRespostaDaAdministracao(Map obj) {
  final em = obj['resposta_at'];
  return em != null && em.toString().trim().isNotEmpty;
}

/// Alguém além do autor escreveu no chat. Mensagem sem `id_usuario` é do
/// porteiro do console (ou do sistema) — a API também conta como da equipe.
bool equipeJaFalouNoChat(List? mensagens, dynamic idAutor) {
  if (mensagens == null || mensagens.isEmpty) return false;
  final autor = idAutor?.toString();
  for (final m in mensagens) {
    if (m is! Map) continue;
    final id = m['id_usuario'];
    if (id == null || id.toString() != autor) return true;
  }
  return false;
}
