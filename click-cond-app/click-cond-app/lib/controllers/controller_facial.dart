import 'dart:convert';
import 'package:click/utils/local_storage.dart';
import 'package:http/http.dart' as http;
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';

/// Retorna o histÃ³rico de acessos faciais de um visitante.
/// Lista vazia se a integraÃ§Ã£o nÃ£o estiver ativa ou o visitante nÃ£o tiver
/// passado por nenhum terminal ainda.
Future<List<dynamic>> apiGetAcessosVisitante(int idVisitante, {int limit = 30}) async {
  final url = ApiConfig.buildUri(
    '/facial/acessos/visitante/$idVisitante',
    {'limit': limit.toString()},
  );
  try {
    final response = await ApiClient.get(
      url,
      headers: {'Authorization': getToken()},
    ).timeout(ApiConfig.timeout);

    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      if (parsed is List) return parsed;
      return [];
    }
    return [];
  } catch (e) {
    print('[apiGetAcessosVisitante] Error: $e');
    return [];
  }
}

/// Retorna o histÃ³rico de acessos faciais de um morador.
Future<List<dynamic>> apiGetAcessosMorador(int idMorador, {int limit = 30}) async {
  final url = ApiConfig.buildUri(
    '/facial/acessos/morador/$idMorador',
    {'limit': limit.toString()},
  );
  try {
    final response = await ApiClient.get(
      url,
      headers: {'Authorization': getToken()},
    ).timeout(ApiConfig.timeout);

    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      if (parsed is List) return parsed;
      return [];
    }
    return [];
  } catch (e) {
    print('[apiGetAcessosMorador] Error: $e');
    return [];
  }
}
