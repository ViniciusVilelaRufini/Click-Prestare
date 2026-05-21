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
      var response = await http.get(
        url,
        headers: { "Authorization": getToken() }
      );

    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body);
      return parsed == "" ? [] : parsed;
    } else {
      return [];
    }
  }catch(e){
    return "Houve um erro, tente novamente!";
  }
}
