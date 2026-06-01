import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/foundation.dart';
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
  if (withContentType) headers["Content-Type"] = "application/json";
  return headers;
}

apiSaveApto(String route, String nameObj, dynamic obj, bool isEdit) async {
  final endUri = isEdit ? 'update' : 'insert';
  final url = _buildUri('/$route/$endUri');
  final body = json.encode({
    "id_condominio": Singleton.instance.id_condominio.toString(),
    nameObj: obj,
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    throw e;
  }
}

apiGetAllMoradores(String tipo, String id_apto) async {
  final url = _buildUri('/apartamentos/get-moradores', {'id_apto': id_apto, 'tipo': tipo});
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return (parsed == null || parsed == "") ? [] : parsed;
    }
    return [];
  } catch (e) {
    return "Houve um erro, tente novamente!";
  }
}

loginMorador(String login, String password) async {
  try {
    final url = _buildUri('/moradores/login');
    final body = json.encode({'login': login, 'password': password});
    // skip401Handling: nesse endpoint, 401 = senha errada (não token expirado).
    // Sem isso, errar a senha mostraria snackbar "sessão expirou" pro usuário.
    final response = await ApiClient.post(url,
            headers: {"Content-Type": "application/json"},
            body: body,
            skip401Handling: true)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      storageMorador(parsed);
      return "";
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    return parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    return "Houve um erro, tente novamente!";
  }
}

getCondominiosMorador() async {
  final url = _buildUri('/moradores/list-condominios');
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    return [];
  } catch (e) {
    return "Houve um erro, tente novamente!";
  }
}

updateMoradorApi(dynamic morador) async {
  final url = _buildUri('/moradores/update');
  final body = json.encode({
    "id_condominio": Singleton.instance.id_condominio.toString(),
    "morador": morador,
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      storageMorador(parsed);
      return "";
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    return parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    rethrow;
  }
}

updatePasswordMoradorApi(String senha) async {
  final url = _buildUri('/moradores/new-password');
  final body = json.encode({"senha": senha});
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      storageMorador(parsed);
      return "";
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    throw "Houve um erro, tente novamente!";
  }
}

updateAsinaturaMoradorApi(
    String idCondominio, String plano, String codigo) async {
  final url = _buildUri('/moradores/update-assinatura');
  final body = json.encode({
    "assinatura": {
      "id_plano": plano,
      "codigo": codigo,
      "plataforma": kIsWeb ? "Web" : "Mobile",
    }
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      Singleton.instance.dias_restantes_morador = parsed["dias_restantes"] ?? 10;
      Singleton.instance.vencimento_morador = parsed["vencimento_formatado"] ?? "";
      return;
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    throw "Houve um erro, tente novamente!";
  }
}

apiGetAllMoradoresGeral(int idCondominio) async {
  final url = _buildUri('/moradores/get-all', {'id_condominio': idCondominio.toString()});
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return (parsed == null || parsed == "") ? [] : parsed;
    }
    return [];
  } catch (e) {
    return "Houve um erro, tente novamente!";
  }
}

apiSendCredentialsGeral(String email, String nome, String documento) async {
  final url = _buildUri('/moradores/send-credentials');
  final body = jsonEncode({
    'email': email,
    'nome': nome,
    'documento': documento,
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      return true;
    }
    throw 'Erro ao enviar credenciais';
  } catch (e) {
    throw 'Houve um erro, tente novamente!';
  }
}
