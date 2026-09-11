import 'dart:convert';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/foundation.dart' show debugPrint;

import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';

/// Extrai a mensagem de erro do body do NestJS e lança — as telas têm
/// try/catch e exibem via displayMessage. Antes o erro era engolido e a
/// UI ficava vazia sem explicação (rede caída parecia "sem lançamentos").
Never _throwHttpError(dynamic response) {
  String msg = 'Erro no servidor (HTTP ${response.statusCode}). Tente novamente.';
  try {
    final parsed = jsonDecode(response.body);
    if (parsed is Map && parsed['message'] != null) {
      msg = parsed['message'] is List
          ? (parsed['message'] as List).join(', ')
          : parsed['message'].toString();
    }
  } catch (_) {}
  throw Exception(msg);
}

apiGetAllFinanceiro(String route, String mes, String ano) async {
  var url = ApiConfig.buildUri('/'+route+'/get-all',{'id_condominio': Singleton.instance.id_condominio.toString(), 'mes':mes, 'ano':ano});
  dynamic response;
  try {
    response = await ApiClient.get(url, headers: { "Authorization": getToken() });
  } catch (e) {
    debugPrint('[apiGetAllFinanceiro] $e');
    throw Exception('Falha de comunicação com o servidor. Verifique sua conexão.');
  }
  if (response.statusCode == 200) {
    var parsed = jsonDecode(response.body);
    return parsed == "" ? {} : parsed;
  }
  _throwHttpError(response);
}

apiGetInadimplenciaDashboard(String mes, String ano) async {
  var url = ApiConfig.buildUri('/financeiro/inadimplencia/dashboard', {
    'id_condominio': Singleton.instance.id_condominio.toString(),
    'mes': mes,
    'ano': ano,
  });
  dynamic response;
  try {
    response = await ApiClient.get(url, headers: { "Authorization": getToken() });
  } catch (e) {
    debugPrint('[apiGetInadimplenciaDashboard] $e');
    throw Exception('Falha de comunicação com o servidor. Verifique sua conexão.');
  }
  if (response.statusCode == 200) {
    var parsed = jsonDecode(response.body);
    return parsed == "" ? {} : parsed;
  }
  _throwHttpError(response);
}

apiNotificarInadimplente(String bloco, String apto) async {
  var url = ApiConfig.buildUri('/financeiro/inadimplente/notificar');
  try {
    var response = await ApiClient.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({
        "id_condominio": Singleton.instance.id_condominio.toString(),
        "bloco": bloco,
        "apto": apto,
      }),
    );
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      return body is Map ? body : { "success": true };
    }
    // Não-200 (403 de permissão, 500) também traz {message} em português do
    // NestJS. Descartá-lo e mostrar "Falha ao notificar." apagava justamente
    // a explicação — a tela promete exibir o motivo que o servidor deu.
    try {
      final body = jsonDecode(response.body);
      final msg = body is Map ? body['message'] : null;
      if (msg != null && msg.toString().trim().isNotEmpty) {
        return { "success": false, "message": msg is List ? msg.join(', ') : msg.toString() };
      }
    } catch (_) {
      // Corpo não-JSON (HTML de proxy, resposta vazia): cai no texto genérico.
    }
    return { "success": false, "message": "Falha ao notificar." };
  } catch (e) {
    return { "success": false, "message": "Falha de comunicação." };
  }
}

apiGetDetailsInadimplente(String route, String bloco, String apto) async {
  var url = ApiConfig.buildUri('/'+route+'/get',{'id_condominio': Singleton.instance.id_condominio.toString(), 'bloco': bloco, 'apto': apto});
  dynamic response;
  try {
    response = await ApiClient.get(url, headers: { "Authorization": getToken() });
  } catch (e) {
    debugPrint('[apiGetDetailsInadimplente] $e');
    throw Exception('Falha de comunicação com o servidor. Verifique sua conexão.');
  }
  if (response.statusCode == 200) {
    return jsonDecode(response.body) as List<dynamic>;
  }
  _throwHttpError(response);
}

apiUploadComprovante(int id, String fileBase64) async {
  var url = ApiConfig.buildUri('/financeiro/upload-shared-file');
  try {
    var response = await ApiClient.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({ "id": id, "file": fileBase64, "type": "comprovante" })
    );
    return response.statusCode == 200;
  } catch(e) {
    return false;
  }
}

apiGetFinanceiroByUser() async {
  var url = ApiConfig.buildUri('/financeiro/get-by-user', {
    'id_condominio': Singleton.instance.id_condominio.toString(),
    'id_user': getUserId()
  });
  dynamic response;
  try {
    response = await ApiClient.get(url, headers: { "Authorization": getToken() });
  } catch (e) {
    debugPrint('[apiGetFinanceiroByUser] $e');
    throw Exception('Falha de comunicação com o servidor. Verifique sua conexão.');
  }
  if (response.statusCode == 200) {
    return jsonDecode(response.body);
  }
  _throwHttpError(response);
}

apiInsertMoradorFinanceiro(Map<String, dynamic> data) async {
  var url = ApiConfig.buildUri('/financeiro/morador/insert');
  try {
    var response = await ApiClient.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({
        "id_condominio": Singleton.instance.id_condominio.toString(),
        "data": data
      })
    );
    return response.statusCode == 200;
  } catch(e) {
    return false;
  }
}

apiUpdateMoradorFinanceiro(Map<String, dynamic> data) async {
  var url = ApiConfig.buildUri('/financeiro/morador/update');
  try {
    var response = await ApiClient.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({
        "id_condominio": Singleton.instance.id_condominio.toString(),
        "data": data
      })
    );
    return response.statusCode == 200;
  } catch(e) {
    return false;
  }
}

// ===== Recorrência / Rateio / Acordo / Fechamento (paridade com portaria-web) =====

Map<String, String> _jsonHeaders() =>
    { "Authorization": getToken(), "Content-Type": "application/json" };

/// POST simples com envelope {'ok','message'} — extrai a mensagem PT-BR do
/// NestJS em caso de erro (ex.: "Defina o valor da taxa condominial...").
Future<Map<String, dynamic>> _postFinanceiro(String path, Map<String, dynamic> body) async {
  var url = ApiConfig.buildUri(path);
  dynamic response;
  try {
    response = await ApiClient.post(url, headers: _jsonHeaders(), body: jsonEncode(body));
  } catch (e) {
    debugPrint('[$path] $e');
    return { 'ok': false, 'message': 'Falha de comunicação com o servidor. Verifique sua conexão.' };
  }
  if (response.statusCode >= 200 && response.statusCode < 300) {
    dynamic parsed;
    try { parsed = jsonDecode(response.body); } catch (_) {}
    return { 'ok': true, 'message': (parsed is Map ? parsed['message'] : null) ?? '', 'data': parsed };
  }
  String msg = 'Erro no servidor (HTTP ${response.statusCode}).';
  try {
    final parsed = jsonDecode(response.body);
    if (parsed is Map && parsed['message'] != null) {
      msg = parsed['message'] is List
          ? (parsed['message'] as List).join(', ')
          : parsed['message'].toString();
    }
  } catch (_) {}
  return { 'ok': false, 'message': msg };
}

/// Baixa o livro caixa CSV (bytes) — o caller salva em temp e abre.
apiExportLivroCaixaCsv(String mes, String ano) async {
  var url = ApiConfig.buildUri('/financeiro/export-csv', {
    'id_condominio': Singleton.instance.id_condominio.toString(),
    'mes': mes,
    'ano': ano,
  });
  dynamic response;
  try {
    response = await ApiClient.get(url, headers: { "Authorization": getToken() });
  } catch (e) {
    throw Exception('Falha de comunicação com o servidor. Verifique sua conexão.');
  }
  if (response.statusCode == 200) return response.bodyBytes;
  _throwHttpError(response);
}

apiRemoveMoradorFinanceiro(int id) async {
  var url = ApiConfig.buildUri('/financeiro/morador/remove');
  try {
    var response = await ApiClient.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({ "id": id })
    );
    return response.statusCode == 200;
  } catch(e) {
    return false;
  }
}

