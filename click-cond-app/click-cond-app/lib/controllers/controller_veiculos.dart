import 'dart:convert';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';

Map<String, String> _headers({bool withContentType = false}) {
  final h = <String, String>{"Authorization": getToken()};
  if (withContentType) h["Content-Type"] = "application/json; charset=utf-8";
  return h;
}

/// Lista os veículos do morador logado no condomínio atual.
apiGetAllVeiculos() async {
  final url = ApiConfig.buildUri('/veiculos/get-all', {
    'id_condominio': Singleton.instance.id_condominio.toString(),
  });
  try {
    final response = await ApiClient.get(url, headers: _headers())
        .timeout(ApiConfig.timeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return (parsed == null || parsed == "") ? [] : parsed;
    }
    return [];
  } catch (e) {
    print('[apiGetAllVeiculos] Erro: $e');
    return [];
  }
}

/// Cadastra/edita um veículo. [obj] deve ter placa/cor/marca_modelo (+id se edição).
/// Retorna "" em sucesso, ou uma mensagem de erro.
Future<String> apiSaveVeiculo(Map<String, dynamic> obj, bool isEdit) async {
  final url = ApiConfig.buildUri('/veiculos/${isEdit ? 'update' : 'insert'}');
  final body = jsonEncode({
    'id_condominio': Singleton.instance.id_condominio.toString(),
    'veiculo': obj,
  });
  try {
    final response = await ApiClient.post(url,
            headers: _headers(withContentType: true), body: body, encoding: utf8)
        .timeout(ApiConfig.timeout);
    if (response.statusCode >= 200 && response.statusCode < 300) return "";
    try {
      final parsed = jsonDecode(response.body);
      return parsed['message']?.toString() ?? 'Não foi possível salvar o veículo.';
    } catch (_) {
      return 'Não foi possível salvar o veículo.';
    }
  } catch (e) {
    print('[apiSaveVeiculo] Erro: $e');
    return 'Falha de comunicação com o servidor. Verifique sua conexão.';
  }
}

apiRemoverVeiculo(int id) async {
  final url = ApiConfig.buildUri('/veiculos/remove');
  final body = jsonEncode({
    'id': id,
    'id_condominio': Singleton.instance.id_condominio.toString(),
  });
  try {
    final response = await ApiClient.post(url,
            headers: _headers(withContentType: true), body: body)
        .timeout(ApiConfig.timeout);
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch (e) {
    print('[apiRemoverVeiculo] Erro: $e');
    return false;
  }
}
