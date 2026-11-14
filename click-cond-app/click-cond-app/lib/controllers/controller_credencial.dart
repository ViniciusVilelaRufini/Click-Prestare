import 'dart:async';
import 'dart:convert';

import 'package:click/utils/api_client.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/log.dart';
import 'package:http/http.dart' as http;

// Credencial de acesso (QR dinâmico) e passe do visitante.
//
// O corpo de `credenciais/minha` traz o SEGREDO da credencial e o do link traz
// a URL do passe (quem tem a URL abre o portão): nenhum dos dois vai para log.
// Só o status.

const _semConexao = 'Sem conexão com a internet.';

/// Emite (renovar: true) ou confere a credencial do morador logado no
/// condomínio. Resposta da API:
/// `{disponivel: true, id, segredo?, intervalo_s, agora_servidor}` ou
/// `{disponivel: false, motivo: 'opcao_desligada' | 'sem_morador'}`.
/// Sem rede: `{erro, sem_conexao: true}`.
Future<Map<String, dynamic>> apiCredencialMinha(int idCondominio, {bool renovar = false}) async {
  final url = ApiConfig.buildUri('/credenciais/minha');
  try {
    final response = await ApiClient.post(
      url,
      body: jsonEncode({'id_condominio': idCondominio, 'renovar': renovar}),
    );
    logDebug('[apiCredencialMinha] status ${response.statusCode}');
    if (response.statusCode == 200) return _mapa(response, 'Resposta inválida do servidor.');
    return _mensagemDeErro(response, 'Não foi possível preparar o QR de acesso.');
  } catch (e) {
    return _falhaDeRede(e, 'apiCredencialMinha');
  }
}

/// Link do passe do visitante (ou prestador): `{url, valido_ate}`.
Future<Map<String, dynamic>> apiLinkPasseVisita(int idVisita) async {
  final url = ApiConfig.buildUri('/credenciais/visita/$idVisita/link');
  try {
    final response = await ApiClient.post(url);
    logDebug('[apiLinkPasseVisita] status ${response.statusCode}');
    if (response.statusCode == 200) return _mapa(response, 'Resposta inválida do servidor.');
    return _mensagemDeErro(response, 'Não foi possível gerar o link do passe.');
  } catch (e) {
    return _falhaDeRede(e, 'apiLinkPasseVisita');
  }
}

/// Invalida o link já enviado: `{ok: true}`.
Future<Map<String, dynamic>> apiInvalidarLinkPasse(int idVisita) async {
  final url = ApiConfig.buildUri('/credenciais/visita/$idVisita/invalidar-link');
  try {
    final response = await ApiClient.post(url);
    logDebug('[apiInvalidarLinkPasse] status ${response.statusCode}');
    if (response.statusCode == 200) return _mapa(response, 'Resposta inválida do servidor.');
    return _mensagemDeErro(response, 'Não foi possível cancelar o link.');
  } catch (e) {
    return _falhaDeRede(e, 'apiInvalidarLinkPasse');
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

/// Exceção no request é falta de rede (sem conexão, DNS, timeout): a tela de
/// "Meu acesso" distingue isso de erro do servidor.
Map<String, dynamic> _falhaDeRede(Object e, String onde) {
  logDebug('[$onde] falha: ${e.runtimeType}');
  return {'erro': _semConexao, 'sem_conexao': true};
}
