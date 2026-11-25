import 'package:click/utils/log.dart';
import 'dart:convert';

import 'package:click/utils/api_client.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/local_storage.dart';
import 'package:localstorage/localstorage.dart';

final _storage = LocalStorage('user_data');

/// Momento em que o usuário viu a central pela última vez. O backend monta o
/// feed por agregação e não guarda "lido", então esse marcador local é o que
/// permite contar as não lidas para o selo do sino.
const _kUltimaVisita = 'notif_ultima_visita';

/// Feed unificado de notificações do usuário logado. Em falha, `[]` (selo
/// do sino); a central usa [apiGetNotificacoesOuNull].
Future<List<dynamic>> apiGetNotificacoes() async => await apiGetNotificacoesOuNull() ?? [];

/// Igual a [apiGetNotificacoes], mas `null` quando a busca falha (status
/// diferente de 200, sem rede, tempo esgotado): a central mostra erro em vez
/// de "nenhuma notificação" e não marca nada como visto.
Future<List<dynamic>?> apiGetNotificacoesOuNull() async {
  final url = ApiConfig.buildUri('/notificacoes/get-all');
  try {
    final response = await ApiClient.get(
      url,
    ).timeout(ApiConfig.timeout);

    if (response.statusCode == 200) {
      final decoded = jsonDecode(response.body);
      return decoded is List ? decoded : null;
    }
    return null;
  } catch (e) {
    logDebug('[apiGetNotificacoes] Erro: $e');
    return null;
  }
}

DateTime? getUltimaVisitaNotificacoes() {
  final raw = _storage.getItem(_kUltimaVisita);
  if (raw == null) return null;
  return DateTime.tryParse(raw.toString());
}

void marcarNotificacoesComoVistas() {
  _storage.setItem(_kUltimaVisita, DateTime.now().toIso8601String());
}

/// Pede ao servidor um push de teste para o próprio usuário logado.
///
/// Devolve o que o FCM respondeu por aparelho. Serve para separar "o aparelho
/// nunca se registrou" de "registrou, mas a entrega falha" — as duas coisas
/// parecem iguais de fora: nada chega.
Future<Map<String, dynamic>> apiTestarPush() async {
  final url = ApiConfig.buildUri('/users/push-teste');
  try {
    final response = await ApiClient.post(
      url,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getToken(),
      },
    ).timeout(ApiConfig.timeout);

    if (response.statusCode == 200) {
      final decoded = jsonDecode(response.body);
      return decoded is Map<String, dynamic> ? decoded : {};
    }
    return {'erro': 'O servidor respondeu ${response.statusCode}.'};
  } catch (e) {
    return {'erro': 'Não foi possível falar com o servidor: $e'};
  }
}

/// Ação do próprio usuário ("Você entrou no condomínio"): não é aviso para
/// ele (F18). A API marca com `categoria: 'voce'`; enquanto o item do feed
/// não leva a categoria, vale o texto que a API monta para o próprio acesso.
bool _doProprioUsuario(Map n) {
  if (n['categoria']?.toString() == 'voce') return true;
  final descricao = n['descricao']?.toString().trimLeft() ?? '';
  return n['tipo'] == 'acesso' && descricao.startsWith('Você ');
}

/// A notificação conta como nova (selo do sino e "NOVA" na central)?
///
/// - chegou depois da última visita à central (sem visita: todas);
/// - timestamp no futuro não conta: a API usa o VENCIMENTO da conta a
///   vencer, sempre "depois da visita", e o sino nunca zerava (F6);
/// - ação do próprio usuário não conta (F18).
bool notificacaoEhNova(dynamic n, DateTime? ultimaVisita, {DateTime? agora}) {
  if (n is! Map) return false;
  if (_doProprioUsuario(n)) return false;
  final ts = DateTime.tryParse(n['timestamp']?.toString() ?? '');
  if (ts != null && ts.isAfter(agora ?? DateTime.now())) return false;
  if (ultimaVisita == null) return true;
  return ts != null && ts.isAfter(ultimaVisita);
}

/// Quantas notificações chegaram depois da última visita à central.
int contarNaoLidas(List<dynamic> itens) {
  final ultima = getUltimaVisitaNotificacoes();
  final agora = DateTime.now();
  return itens.where((n) => notificacaoEhNova(n, ultima, agora: agora)).length;
}
