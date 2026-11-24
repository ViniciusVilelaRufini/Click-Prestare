import 'package:click/pages/singleton.dart';

/// Condomínio que veio no push (`id_condominio`, string no FCM), ou null.
///
/// A API manda o condomínio nos pushes 'financeiro' e 'autorizacao_visitante'
/// para o toque abrir a tela certa:
/// - autorização: os pendentes DAQUELE condomínio (quem tem vínculo em dois via
///   a lista do condomínio aberto no app — vazia). Passado à tela, sem trocar o
///   condomínio aberto;
/// - financeiro: com o app fechado não há condomínio aberto e a API dava 403;
///   ver [condominioParaAbrirFinanceiro].
int? condominioDoPush(Map<String, dynamic> data) {
  final id = int.tryParse('${data['id_condominio'] ?? ''}');
  return id != null && id > 0 ? id : null;
}

/// Toque no push 'financeiro': só define o condomínio quando NENHUM está
/// aberto (app aberto do zero pela notificação). Com um condomínio aberto, o
/// usuário fica nele — trocar só o id deixaria bloco/apto de outro condomínio.
void condominioParaAbrirFinanceiro(Map<String, dynamic> data) {
  final id = condominioDoPush(data);
  if (id == null) return;
  final aberto = int.tryParse('${Singleton.instance.id_condominio ?? ''}');
  if (aberto == null || aberto <= 0) Singleton.instance.id_condominio = id;
}
