import 'dart:convert';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/local_storage.dart';
import 'package:http/http.dart' as http;

import 'package:click/utils/api_config.dart';


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
      var response = await http.get(
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
    final response = await http.post(
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
