import 'dart:convert';

/// Trocar o e-mail de acesso da própria conta exige a senha atual na API
/// (`sindico/update`, `funcionarios/update-infos`, `moradores/update`): o JWT
/// dura 365 dias e, sem essa prova, um celular destravado bastaria para
/// redirecionar o "esqueci a senha" para outro e-mail e tomar a conta.
///
/// A API normaliza com trim + minúsculas antes de comparar; o app faz o mesmo
/// para não pedir senha quando o usuário só mudou a caixa ou deixou espaço.
String normalizarEmail(String? valor) => (valor ?? '').trim().toLowerCase();

/// `true` quando o e-mail digitado é outro em relação ao carregado na tela.
bool emailDeAcessoMudou(String? carregado, String? digitado) =>
    normalizarEmail(carregado) != normalizarEmail(digitado);

/// Cópia do objeto do perfil (Map ou model com `toJson`) com `senha_atual`
/// junto do e-mail novo. Sem senha, devolve só a cópia.
Map<String, dynamic> comSenhaAtual(dynamic objeto, String? senhaAtual) {
  final copia = Map<String, dynamic>.from(jsonDecode(jsonEncode(objeto)) as Map);
  if (senhaAtual != null && senhaAtual.isNotEmpty) {
    copia['senha_atual'] = senhaAtual;
  }
  return copia;
}
