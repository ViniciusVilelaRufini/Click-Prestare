import 'dart:convert';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';


apiGetAllVisitantes(String search, {bool allCondos = false}) async {
  final Map<String, String> params = {
    'offset': '0',
    'search': search,
  };
  if (!allCondos && Singleton.instance.id_condominio != 0) {
    params['id_condominio'] = Singleton.instance.id_condominio.toString();
    params['id_apto'] = Singleton.instance.getIdApartamento();
  }
  var url = ApiConfig.buildUri('/visitantes/get-all', params);
  try{
      print('[apiGetAllVisitantes] URL: $url, allCondos: $allCondos, id_condominio: ${Singleton.instance.id_condominio}');
      var response = await ApiClient.get(
        url,
        headers: { "Authorization": getToken() }
      );
      print('[apiGetAllVisitantes] Status: ${response.statusCode}, Body: ${response.body}');

    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body);
      return parsed == "" ? [] : parsed;
    } else {
      return [];
    }
  }catch(e){
    print('[apiGetAllVisitantes] Error: $e');
    return "Houve um erro, tente novamente!";
  }
}

apiSaveVisitante(dynamic obj, bool isEdit) async {
  final Map<String, String> headers = {
    "Authorization": getToken(),
    "Content-Type": "application/json; charset=utf-8"
  };
  final endUri = isEdit ? 'update' : 'insert';
  final url = ApiConfig.buildUri('/visitantes/$endUri');
  final body = json.encode({
    'id_condominio': Singleton.instance.id_condominio.toString(),
    'visitante': obj is Map ? obj : obj.toJson()
  });

  try {
    final response = await ApiClient.post(
      url,
      headers: headers,
      body: body,
      encoding: utf8,
    ).timeout(ApiConfig.timeout);

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (response.body.isNotEmpty) {
        return jsonDecode(response.body);
      }
      return {};
    }
    final parsed = jsonDecode(response.body);
    return parsed['message'] ?? "Erro ao salvar visitante";
  } catch (e) {
    return "Falha de comunicação com o servidor.";
  }
}

/// Portaria remota: lista as solicitações de autorização PENDENTES dos
/// apartamentos do morador logado. GET /visitantes/pendentes.
apiGetPendentes() async {
  final params = <String, String>{};
  if (Singleton.instance.id_condominio != 0) {
    params['id_condominio'] = Singleton.instance.id_condominio.toString();
  }
  final url = ApiConfig.buildUri('/visitantes/pendentes', params.isEmpty ? null : params);
  try {
    final response = await ApiClient.get(
      url,
      headers: {"Authorization": getToken()},
    ).timeout(ApiConfig.timeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return parsed is List ? parsed : [];
    }
    return [];
  } catch (e) {
    print('[apiGetPendentes] Error: $e');
    return [];
  }
}

/// Portaria remota: morador responde a uma solicitação.
/// autorizar=true → POST /visitantes/:id/autorizar; false → /negar.
/// Retorna {} em sucesso ou a mensagem de erro.
apiResponderAutorizacao(int idVisitante, bool autorizar) async {
  final acao = autorizar ? 'autorizar' : 'negar';
  final url = ApiConfig.buildUri('/visitantes/$idVisitante/$acao');
  final headers = {
    "Authorization": getToken(),
    "Content-Type": "application/json; charset=utf-8"
  };
  try {
    final response = await ApiClient.post(
      url,
      headers: headers,
      body: json.encode({}),
      encoding: utf8,
    ).timeout(ApiConfig.timeout);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return {};
    }
    final parsed = jsonDecode(response.body);
    return parsed['message'] ?? "Erro ao responder solicitação";
  } catch (e) {
    return "Falha de comunicação com o servidor.";
  }
}

/// Registra a entrada manual de um visitante (check-in pelo morador ou porteiro).
/// Chama POST /visitantes/check-in com o id do visitante.
apiCheckInVisitante(int idVisitante) async {
  final url = ApiConfig.buildUri('/visitantes/check-in');
  final headers = {
    "Authorization": getToken(),
    "Content-Type": "application/json; charset=utf-8"
  };
  final body = json.encode({'id': idVisitante});
  try {
    final response = await ApiClient.post(
      url,
      headers: headers,
      body: body,
      encoding: utf8,
    ).timeout(ApiConfig.timeout);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return {};
    }
    final parsed = jsonDecode(response.body);
    return parsed['message'] ?? "Erro ao registrar entrada";
  } catch (e) {
    return "Falha de comunicação com o servidor.";
  }
}

/// Registra a saída manual / dá baixa na visita (check-out pelo morador ou porteiro).
/// Chama POST /visitantes/check-out com o id do visitante.
apiCheckOutVisitante(int idVisitante) async {
  final url = ApiConfig.buildUri('/visitantes/check-out');
  final headers = {
    "Authorization": getToken(),
    "Content-Type": "application/json; charset=utf-8"
  };
  final body = json.encode({'id': idVisitante});
  try {
    final response = await ApiClient.post(
      url,
      headers: headers,
      body: body,
      encoding: utf8,
    ).timeout(ApiConfig.timeout);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return {};
    }
    final parsed = jsonDecode(response.body);
    return parsed['message'] ?? "Erro ao dar baixa na visita";
  } catch (e) {
    return "Falha de comunicação com o servidor.";
  }
}
