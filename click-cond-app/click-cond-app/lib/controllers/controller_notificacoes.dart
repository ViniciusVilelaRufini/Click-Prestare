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

/// Feed unificado de notificações do usuário logado.
Future<List<dynamic>> apiGetNotificacoes() async {
  final url = ApiConfig.buildUri('/notificacoes/get-all');
  try {
    final response = await ApiClient.get(
      url,
      headers: {'Authorization': getToken()},
    ).timeout(ApiConfig.timeout);

    if (response.statusCode == 200) {
      final decoded = jsonDecode(response.body);
      return decoded is List ? decoded : [];
    }
    return [];
  } catch (e) {
    print('[apiGetNotificacoes] Erro: $e');
    return [];
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

/// Quantas notificações chegaram depois da última visita à central.
int contarNaoLidas(List<dynamic> itens) {
  final ultima = getUltimaVisitaNotificacoes();
  if (ultima == null) return itens.length;
  return itens.where((n) {
    final ts = DateTime.tryParse(n['timestamp']?.toString() ?? '');
    return ts != null && ts.isAfter(ultima);
  }).length;
}
