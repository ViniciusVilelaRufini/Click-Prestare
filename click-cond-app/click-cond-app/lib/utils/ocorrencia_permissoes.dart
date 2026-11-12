/// Quem vê o lápis de editar na ocorrência: só o autor (Users.id, o mesmo que a
/// API confere em `ehAutor`) e só enquanto Pendente. Status nulo conta como
/// Pendente e a caixa não importa, igual ao `estaPendente` da API.
bool podeEditarOcorrencia(Map? obj, String userId) {
  if (obj == null || userId.isEmpty) return false;
  if (obj['user']?.toString() != userId) return false;
  final status = (obj['status']?.toString() ?? 'Pendente').trim().toLowerCase();
  return status == 'pendente';
}
