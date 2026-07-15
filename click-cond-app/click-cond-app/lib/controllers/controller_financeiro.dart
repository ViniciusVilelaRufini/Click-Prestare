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

apiUpdateFinanceiroStatus(int id, int status) async {
  var url = ApiConfig.buildUri('/financeiro/update-status');
  try {
    var response = await ApiClient.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({ "id": id, "status": status })
    );
    return response.statusCode == 200;
  } catch(e) {
    return false;
  }
}

/// Salva um lançamento financeiro e devolve também o id criado pelo backend —
/// necessário para anexar boleto/comprovante logo após o insert
/// (o /financeiro/upload-shared-file exige o id do lançamento).
/// Retorna {'ok': bool, 'message': String, 'id': int?}.
apiSaveFinanceiroComId(dynamic financeiro, bool isEdit) async {
  var url = ApiConfig.buildUri(isEdit ? '/financeiro/update' : '/financeiro/insert');
  try {
    var response = await ApiClient.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json; charset=utf-8" },
      body: jsonEncode({
        "id_condominio": Singleton.instance.id_condominio.toString(),
        "financeiro": financeiro is Map ? financeiro : financeiro.toJson(),
      }),
      encoding: utf8,
    );
    if (response.statusCode >= 200 && response.statusCode < 300) {
      int? idCriado;
      try {
        final parsed = jsonDecode(response.body);
        if (parsed is Map && parsed['id'] != null) {
          idCriado = int.tryParse(parsed['id'].toString());
        }
      } catch (_) {}
      return { 'ok': true, 'message': '', 'id': idCriado };
    }
    String msg = 'Erro HTTP ${response.statusCode}';
    try {
      final parsed = jsonDecode(response.body);
      if (parsed is Map && parsed['message'] != null) {
        msg = parsed['message'] is List
            ? (parsed['message'] as List).join(', ')
            : parsed['message'].toString();
      }
    } catch (_) {}
    return { 'ok': false, 'message': msg, 'id': null };
  } catch (e) {
    return { 'ok': false, 'message': 'Falha de comunicação com o servidor. Verifique sua conexão.', 'id': null };
  }
}

apiUploadBoleto(int id, String fileBase64) async {
  var url = ApiConfig.buildUri('/financeiro/upload-shared-file');
  try {
    var response = await ApiClient.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({ "id": id, "file": fileBase64, "type": "boleto" })
    );
    return response.statusCode == 200;
  } catch(e) {
    return false;
  }
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

/// Anexa o código escaneado (linha digitável e/ou PIX copia-e-cola) à conta do
/// próprio morador, para facilitar o pagamento depois.
Future<bool> apiAnexarCodigoBoleto(int id, {String? linhaDigitavel, String? pixCopiaCola}) async {
  var url = ApiConfig.buildUri('/financeiro/morador/anexar-codigo');
  try {
    var response = await ApiClient.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({
        "id_condominio": Singleton.instance.id_condominio.toString(),
        "id": id,
        "linha_digitavel": linhaDigitavel,
        "pix_copia_cola": pixCopiaCola,
      }),
    );
    return response.statusCode == 200;
  } catch (e) {
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

apiGetConfigAuto() async {
  var url = ApiConfig.buildUri('/financeiro/config-auto',
      {'id_condominio': Singleton.instance.id_condominio.toString()});
  dynamic response;
  try {
    response = await ApiClient.get(url, headers: { "Authorization": getToken() });
  } catch (e) {
    throw Exception('Falha de comunicação com o servidor. Verifique sua conexão.');
  }
  if (response.statusCode == 200) return jsonDecode(response.body);
  _throwHttpError(response);
}

apiUpdateConfigAuto(Map<String, dynamic> config) =>
    _postFinanceiro('/financeiro/config-auto', {
      "id_condominio": Singleton.instance.id_condominio.toString(),
      "config": config,
    });

apiGetApartamentosConfig() async {
  var url = ApiConfig.buildUri('/financeiro/apartamentos-config',
      {'id_condominio': Singleton.instance.id_condominio.toString()});
  dynamic response;
  try {
    response = await ApiClient.get(url, headers: { "Authorization": getToken() });
  } catch (e) {
    throw Exception('Falha de comunicação com o servidor. Verifique sua conexão.');
  }
  if (response.statusCode == 200) return jsonDecode(response.body);
  _throwHttpError(response);
}

apiUpdateApartamentoRecorrencia(int aptoId, bool ignorar) =>
    _postFinanceiro('/financeiro/apartamento-recorrencia', {
      "id_condominio": Singleton.instance.id_condominio.toString(),
      "aptoId": aptoId,
      "ignorar": ignorar,
    });

apiCreateRateio(Map<String, dynamic> rateioData) =>
    _postFinanceiro('/financeiro/rateio', {
      "id_condominio": Singleton.instance.id_condominio.toString(),
      "rateioData": rateioData,
    });

apiCreateAcordoInadimplente(Map<String, dynamic> acordoData) =>
    _postFinanceiro('/financeiro/inadimplente/acordo', {
      "id_condominio": Singleton.instance.id_condominio.toString(),
      "acordoData": acordoData,
    });

apiListarFechamentos() async {
  var url = ApiConfig.buildUri('/financeiro/fechamentos',
      {'id_condominio': Singleton.instance.id_condominio.toString()});
  dynamic response;
  try {
    response = await ApiClient.get(url, headers: { "Authorization": getToken() });
  } catch (e) {
    throw Exception('Falha de comunicação com o servidor. Verifique sua conexão.');
  }
  if (response.statusCode == 200) return jsonDecode(response.body);
  _throwHttpError(response);
}

apiFecharMes(int mes, int ano, String? observacao) =>
    _postFinanceiro('/financeiro/fechamentos/fechar', {
      "id_condominio": Singleton.instance.id_condominio.toString(),
      "mes": mes,
      "ano": ano,
      "observacao": observacao,
    });

apiReabrirMes(int mes, int ano, String motivo) =>
    _postFinanceiro('/financeiro/fechamentos/reabrir', {
      "id_condominio": Singleton.instance.id_condominio.toString(),
      "mes": mes,
      "ano": ano,
      "motivo": motivo,
    });

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

