import 'dart:async';
import 'dart:convert';

import 'package:click/utils/api_client.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/log.dart';
import 'package:http/http.dart' as http;

// Passe do morador na carteira do celular (por enquanto só a Carteira da
// Apple). O arquivo .pkpass carrega o código do dia: o corpo nunca vai para
// log, só o status.

const _semConexao = 'Sem conexão com a internet.';

/// Diz se a tela mostra a carteira. Resposta da API:
/// `{habilitado, apple: {disponivel, ativo}, google: {disponivel, ativo}}`.
/// Em erro: `{erro}`.
Future<Map<String, dynamic>> apiWalletSituacao(int idCondominio) async {
  final url = ApiConfig.buildUri('/credenciais/wallet/situacao', {'id_condominio': '$idCondominio'});
  try {
    final response = await ApiClient.get(url);
    logDebug('[apiWalletSituacao] status ${response.statusCode}');
    if (response.statusCode == 200) return _mapa(response, 'Resposta inválida do servidor.');
    return _mensagemDeErro(response, 'Não foi possível consultar a carteira.');
  } catch (e) {
    return _falhaDeRede(e, 'apiWalletSituacao');
  }
}

/// O passe da Apple: `{bytes: List<int>}` com o .pkpass, ou `{erro}` com a
/// mensagem do servidor (400, 403, 503).
Future<Map<String, dynamic>> apiWalletPasseApple(int idCondominio) async {
  final url = ApiConfig.buildUri('/credenciais/wallet/apple');
  try {
    final response = await ApiClient.post(url, body: jsonEncode({'id_condominio': idCondominio}));
    logDebug('[apiWalletPasseApple] status ${response.statusCode}');
    if (response.statusCode == 200 && response.bodyBytes.isNotEmpty) {
      return {'bytes': response.bodyBytes};
    }
    return _mensagemDeErro(response, 'Não foi possível gerar o passe.');
  } catch (e) {
    return _falhaDeRede(e, 'apiWalletPasseApple');
  }
}

/// Cancela o passe do morador logado neste condomínio: `{ok: true}`.
Future<Map<String, dynamic>> apiWalletCancelar(int idCondominio) async {
  final url = ApiConfig.buildUri('/credenciais/wallet/cancelar');
  try {
    final response = await ApiClient.post(url, body: jsonEncode({'id_condominio': idCondominio}));
    logDebug('[apiWalletCancelar] status ${response.statusCode}');
    if (response.statusCode == 200) return _mapa(response, 'Resposta inválida do servidor.');
    return _mensagemDeErro(response, 'Não foi possível cancelar o passe.');
  } catch (e) {
    return _falhaDeRede(e, 'apiWalletCancelar');
  }
}

Map<String, dynamic> _mapa(http.Response response, String padrao) {
  try {
    final body = jsonDecode(response.body);
    if (body is Map) return Map<String, dynamic>.from(body);
  } catch (_) {}
  return {'erro': padrao};
}

/// Mesma regra das vizinhas: a mensagem do NestJS em `message` explica melhor.
Map<String, dynamic> _mensagemDeErro(http.Response response, String padrao) {
  try {
    final body = jsonDecode(response.body);
    final msg = body is Map ? body['message'] : null;
    if (msg != null && msg.toString().trim().isNotEmpty) {
      return {'erro': msg is List ? msg.join(', ') : msg.toString()};
    }
  } catch (_) {}
  return {'erro': padrao};
}

Map<String, dynamic> _falhaDeRede(Object e, String onde) {
  logDebug('[$onde] falha: ${e.runtimeType}');
  return {'erro': _semConexao, 'sem_conexao': true};
}
