import 'package:click/utils/log.dart';
import 'dart:convert';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';

apiGetAllEncomendas({String? status, bool allCondos = false}) async {
  return await apiGetAllEncomendasOuNull(status: status, allCondos: allCondos) ?? [];
}

/// Igual ao [apiGetAllEncomendas], mas devolve `null` quando a busca falha
/// (status diferente de 200, sem rede): a recarga automática mantém a lista.
Future<dynamic> apiGetAllEncomendasOuNull({String? status, bool allCondos = false}) async {
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
    );

    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body);
      return parsed ?? [];
    } else {
      return null;
    }
  } catch (e) {
    logDebug(e);
    return null;
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
  return (await apiInsertEncomendaResultado(obj)).ok;
}

/// Igual a [apiInsertEncomenda], com a recusa da API para a tela (ex.: 400
/// "Unidade não encontrada neste condomínio.").
Future<ResultadoApi> apiInsertEncomendaResultado(Map<String, dynamic> obj) async {
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
    return ResultadoApi.daResposta(response.statusCode, response.body);
  } catch (e) {
    return const ResultadoApi.falha();
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
    );
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return parsed is List ? parsed : [];
    }
  } catch (e) {
    logDebug(e);
  }
  return [];
}

apiUpdateEncomenda(int id, Map<String, dynamic> obj) async {
  return (await apiUpdateEncomendaResultado(id, obj)).ok;
}

/// Igual a [apiUpdateEncomenda], com a recusa da API para a tela (ex.: 409
/// "Só é possível corrigir a unidade de encomenda aguardando retirada.").
Future<ResultadoApi> apiUpdateEncomendaResultado(int id, Map<String, dynamic> obj) async {
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
    return ResultadoApi.daResposta(response.statusCode, response.body);
  } catch (e) {
    return const ResultadoApi.falha();
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
