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
/// autorizar=true, darEntrada=false → POST /visitantes/:id/autorizar (libera acesso e facial)
/// autorizar=true, darEntrada=true  → POST /visitantes/:id/autorizar { darEntrada: true } (libera e já registra entrada)
/// autorizar=false                  → POST /visitantes/:id/negar
/// Retorna {} em sucesso ou a mensagem de erro.
apiResponderAutorizacao(int idVisitante, bool autorizar, {bool darEntrada = false}) async {
  final acao = autorizar ? 'autorizar' : 'negar';
  final url = ApiConfig.buildUri('/visitantes/$idVisitante/$acao');
  final headers = {
    "Authorization": getToken(),
    "Content-Type": "application/json; charset=utf-8"
  };
  try {
    final body = autorizar ? {'darEntrada': darEntrada} : {};
    final response = await ApiClient.post(
      url,
      headers: headers,
      body: json.encode(body),
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

// ===================== Convite de visita por link =====================
//
// O morador gera um link, manda pelo WhatsApp, e o visitante preenche nome,
// CPF e foto pelo próprio celular. O que volta é um RASCUNHO: nada entra na
// portaria antes de o morador confirmar.

/// Gera o convite. O backend decide condomínio e apartamento pelo vínculo do
/// morador — o app não manda (nem poderia: aceitaria convidar para a unidade
/// dos outros).
apiGerarConvite({bool isPrestador = false}) async {
  var url = ApiConfig.buildUri('/convites');
  try {
    var response = await ApiClient.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({ "is_prestador": isPrestador }),
    );
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    return _mensagemDeErro(response, 'Não foi possível gerar o convite.');
  } catch (e) {
    return { "erro": "Falha de comunicação." };
  }
}

/// Convites já preenchidos, esperando a decisão deste morador.
apiGetConvitesPendentes() async {
  var url = ApiConfig.buildUri('/convites/pendentes');
  try {
    var response = await ApiClient.get(url, headers: { "Authorization": getToken() });
    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body);
      return parsed is List ? parsed : [];
    }
    return [];
  } catch (e) {
    return [];
  }
}

apiResponderConvite(int id, {required bool confirmar}) async {
  final acao = confirmar ? 'confirmar' : 'recusar';
  var url = ApiConfig.buildUri('/convites/$id/$acao');
  try {
    var response = await ApiClient.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({}),
    );
    if (response.statusCode == 200) return { "ok": true };
    return _mensagemDeErro(response, 'Não foi possível responder ao convite.');
  } catch (e) {
    return { "erro": "Falha de comunicação." };
  }
}

/// Extrai a mensagem que o NestJS manda em `message`. O servidor explica
/// melhor que um texto genérico — ele sabe se o teto de convites estourou ou
/// se a unidade não está vinculada.
Map<String, dynamic> _mensagemDeErro(dynamic response, String padrao) {
  try {
    final body = jsonDecode(response.body);
    final msg = body is Map ? body['message'] : null;
    if (msg != null && msg.toString().trim().isNotEmpty) {
      return { "erro": msg is List ? msg.join(', ') : msg.toString() };
    }
  } catch (_) {}
  return { "erro": padrao };
}
