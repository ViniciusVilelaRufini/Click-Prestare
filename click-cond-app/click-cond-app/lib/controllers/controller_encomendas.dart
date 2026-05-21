import 'dart:convert';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/local_storage.dart';
import 'package:http/http.dart' as http;
import 'package:click/utils/api_config.dart';

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
    var response = await http.get(
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

apiRetirarEncomenda(int id, String retiradoPor) async {
  var url = ApiConfig.buildUri('/encomendas/retirar');
  try {
    var response = await http.post(
      url,
      headers: {
        "Authorization": getToken(),
        "Content-Type": "application/json"
      },
      body: jsonEncode({
        "id": id,
        "retirado_por": retiradoPor
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
    var response = await http.post(
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
