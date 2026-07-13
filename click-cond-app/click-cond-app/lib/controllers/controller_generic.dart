import 'dart:convert';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:http/http.dart' as http;

final _kTimeout = ApiConfig.timeout;

Uri _buildUri(String path, [Map<String, String>? params]) =>
    ApiConfig.buildUri(path, params);

Map<String, String> _authHeaders({bool withContentType = false}) {
  final headers = <String, String>{"Authorization": getToken()};
  if (withContentType) headers["Content-Type"] = "application/json; charset=utf-8";
  return headers;
}

apiSaveObject(String route, String nameObj, dynamic obj, bool isEdit) async {
  http.Response? response;
  try {
    final endUri = isEdit ? 'update' : 'insert';
    final url = _buildUri('/$route/$endUri');

    // Serializa o objeto: prefere obj.toJson() se existir, senão usa direto
    final Map<String, dynamic> payload = {};
    payload['id_condominio'] = Singleton.instance.id_condominio.toString();
    try {
      payload[nameObj] = obj is Map ? obj : obj.toJson();
    } catch (_) {
      payload[nameObj] = obj;
    }
    final body = json.encode(payload);

    response = await ApiClient.post(
          url,
          headers: _authHeaders(withContentType: true),
          body: body,
          encoding: utf8,
        ).timeout(_kTimeout);
  } catch (e) {
    // Falha de rede / timeout / serialização — devolve mensagem amigável
    return "Falha de comunicação com o servidor. Verifique sua conexão.";
  }

  // Sucesso
  if (response.statusCode >= 200 && response.statusCode < 300) return "";

  // Erro — tenta extrair message do body
  // ignore: avoid_print
  print('[apiSaveObject] HTTP ${response.statusCode} body=${response.body}');
  // Bodyzinho cru pra debug visivel ao usuario quando algo eh estranho
  // (vai pra dialog quando dev mode).
  final shortBody = response.body.length > 200
      ? '${response.body.substring(0, 200)}...'
      : response.body;
  try {
    final parsed = jsonDecode(response.body);
    if (parsed is Map && parsed["message"] != null) {
      final msg = parsed["message"];
      String msgStr;
      if (msg is List) {
        msgStr = msg.join(', ');
      } else {
        msgStr = msg.toString();
      }
      // Sanitiza: se a mensagem contem padroes de erro JS interno
      // (dart2js / runtime), substitui por mensagem generica.
      // 'Must call super constructor' eh um TypeError do JS engine.
      if (msgStr.contains('super constructor') ||
          msgStr.contains('Cannot read prop') ||
          msgStr.startsWith('TypeError:') ||
          msgStr.startsWith('RangeError:')) {
        // ignore: avoid_print
        print('[apiSaveObject] backend devolveu erro JS interno: $msgStr');
        // Inclui inicio do body no proprio erro pra dar pista ao usuario,
        // que vai poder mandar print pra mim em vez de precisar de F12.
        return 'Erro interno no servidor (HTTP ${response.statusCode}). Detalhes: $shortBody';
      }
      return msgStr;
    }
  } catch (_) {}
  return "Erro HTTP ${response.statusCode}: $shortBody";
}

apiDeleteObject(String route, int idObj) async {
  final url = _buildUri('/$route/remove');
  final body = json.encode({"id": idObj});
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

apiGetAll(String route) async {
  final url = _buildUri('/$route/get-all', {
    'id_condominio': Singleton.instance.id_condominio.toString(),
    'offset': '0',
    'id_apto': Singleton.instance.getIdApartamento(),
  });
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return (parsed == null || parsed == "") ? [] : parsed;
    }
    return [];
  } catch (e) {
    print('[apiGetAll] Erro: $e');
    return [];
  }
}

apiGetDetails(String route, int idItem) async {
  final url = _buildUri('/$route/get', {
    'id_condominio': Singleton.instance.id_condominio.toString(),
    'id': idItem.toString(),
  });
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    return null;
  } catch (e) {
    return null;
  }
}

apiGetAllDocs(String route, int isAta) async {
  final url = _buildUri('/$route/get-all', {
    'id_condominio': Singleton.instance.id_condominio.toString(),
    'is_ata': isAta.toString(),
  });
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return (parsed == null || parsed == "") ? [] : parsed;
    }
    return [];
  } catch (e) {
    print('[apiGetAllDocs] Erro: $e');
    return [];
  }
}

apiUpdateStatus(String route, int idItem, bool status, String motivo) async {
  final url = _buildUri('/$route/update-status');
  final body = json.encode({
    "id": idItem,
    "isAccept": status,
    "motivo_recusa": motivo,
    "id_condominio": Singleton.instance.id_condominio.toString(),
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) return "";
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Erro desconhecido";
  } catch (e) {
    throw e;
  }
}

apiUpdateStatusOcorrManut(String route, int idItem, String status) async {
  final url = _buildUri('/$route/update-status');
  final body = json.encode({
    "id": idItem,
    "status": status,
    "id_condominio": Singleton.instance.id_condominio.toString(),
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) return "";
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Erro desconhecido";
  } catch (e) {
    throw e;
  }
}

apiGetOcorrenciaMessages(int idOcorrencia) async {
  final url = _buildUri('/ocorrencias/mensagens/get-all', {
    'id': idOcorrencia.toString(),
  });
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return (parsed == null || parsed == "") ? [] : parsed;
    }
    return [];
  } catch (e) {
    print('[apiGetOcorrenciaMessages] Erro: $e');
    return [];
  }
}

apiSendOcorrenciaMessage(int idOcorrencia, String mensagem) async {
  final url = _buildUri('/ocorrencias/mensagens/enviar');
  final body = json.encode({
    "id_ocorrencia": idOcorrencia,
    "mensagem": mensagem,
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    return null;
  } catch (e) {
    print('[apiSendOcorrenciaMessage] Erro: $e');
    return null;
  }
}

/// Envia uma pergunta ao Assistente IA (RAG) e devolve a resposta em texto.
/// O escopo dos dados (síndico vê tudo, morador só o próprio) é aplicado no
/// backend a partir do JWT; o histórico da conversa também é mantido lá.
/// Retorna a string da resposta, ou uma mensagem de erro amigável.
Future<String> apiPerguntarChatIa(String pergunta) async {
  final url = _buildUri('/chat-ia/perguntar');
  final body = json.encode({
    "id_condominio": Singleton.instance.id_condominio.toString(),
    "pergunta": pergunta,
  });
  try {
    final response = await ApiClient.post(
      url,
      headers: _authHeaders(withContentType: true),
      body: body,
    ).timeout(const Duration(seconds: 60));
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return (parsed["resposta"] ?? "").toString();
    }
    try {
      final parsed = jsonDecode(response.body);
      return parsed["message"]?.toString() ??
          "Não consegui responder agora. Tente novamente.";
    } catch (_) {
      return "Não consegui responder agora. Tente novamente.";
    }
  } catch (e) {
    print('[apiPerguntarChatIa] Erro: $e');
    return "Falha de comunicação com o servidor. Verifique sua conexão.";
  }
}
