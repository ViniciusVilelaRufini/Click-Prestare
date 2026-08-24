import 'dart:convert';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/local_storage.dart';
import 'package:http/http.dart' as http;
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';

apiGetAllEncomendas({String? status, bool allCondos = false}) async {
  final Map<String, String> params = {};
  if (!allCondos && Singleton.instance.id_condominio != 0) {
    params['id_condominio'] = Singleton.instance.id_condominio.toString();
  }
  if (status != null) {
    params['status'] = status;
  }

  var url = ApiConfig.buildUri('/encomendas/get-all', params);
  try {
    var response = await ApiClient.get(
      url,
      headers: {"Authorization": getToken()}
    );

    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body);
      return parsed ?? [];
    } else {
      return [];
    }
  } catch (e) {
    print(e);
    return [];
  }
}

apiRetirarEncomenda(int id, String retiradoPor, {String? retiradoFoto}) async {
  var url = ApiConfig.buildUri('/encomendas/retirar');
  try {
    var response = await ApiClient.post(
      url,
      headers: {
        "Authorization": getToken(),
        "Content-Type": "application/json"
      },
      body: jsonEncode({
        "id": id,
        "retirado_por": retiradoPor,
        if (retiradoFoto != null) "retirado_foto": retiradoFoto,
      })
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

apiInsertEncomenda(Map<String, dynamic> obj) async {
  var url = ApiConfig.buildUri('/encomendas/insert');
  try {
    var response = await ApiClient.post(
      url,
      headers: {
        "Authorization": getToken(),
        "Content-Type": "application/json"
      },
      body: jsonEncode({
        "encomenda": obj,
        "id_condominio": Singleton.instance.id_condominio
      })
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

apiGetApartamentosEncomendas({int? idCondominio}) async {
  final condId = idCondominio ?? Singleton.instance.id_condominio;
  final url = ApiConfig.buildUri('/apartamentos/get-all', {
    if (condId != 0) 'id_condominio': condId.toString(),
  });
  try {
    final response = await ApiClient.get(
      url,
      headers: {"Authorization": getToken()},
    );
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return parsed is List ? parsed : [];
    }
  } catch (e) {
    print(e);
  }
  return [];
}

apiUpdateEncomenda(int id, Map<String, dynamic> obj) async {
  var url = ApiConfig.buildUri('/encomendas/update');
  try {
    var response = await ApiClient.post(
      url,
      headers: {
        "Authorization": getToken(),
        "Content-Type": "application/json",
      },
      body: jsonEncode({
        "id": id,
        "encomenda": obj,
      }),
    );
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch (e) {
    return false;
  }
}

apiRemoveEncomenda(int id) async {
  var url = ApiConfig.buildUri('/encomendas/remove');
  try {
    var response = await ApiClient.post(
      url,
      headers: {
        "Authorization": getToken(),
        "Content-Type": "application/json",
      },
      body: jsonEncode({"id": id}),
    );
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch (e) {
    return false;
  }
}

/// Pré-registro pelo morador de uma encomenda que vai chegar (ex.: iFood).
/// [codigoRastreio] é para transportadoras (rastreio); [codigoValidacao] é o
/// código que o entregador pede (iFood) — ambos opcionais.
apiCadastrarRastreio(
  String descricao,
  String recebidoDe, {
  String? codigoRastreio,
  String? codigoValidacao,
}) async {
  var url = ApiConfig.buildUri('/encomendas/cadastrar');
  try {
    var response = await ApiClient.post(
      url,
      headers: {
        "Authorization": getToken(),
        "Content-Type": "application/json"
      },
      body: jsonEncode({
        "descricao": descricao,
        "recebido_de": recebidoDe,
        "id_condominio": Singleton.instance.id_condominio,
        "destinatario_apto": Singleton.instance.apartamento,
        "destinatario_bloco": Singleton.instance.bloco,
        "codigo_rastreio": codigoRastreio,
        "codigo_validacao": codigoValidacao,
      })
    );
    return response.statusCode == 201 || response.statusCode == 200;
  } catch (e) {
    return false;
  }
}
