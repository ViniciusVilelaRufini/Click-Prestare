import 'dart:convert';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/local_storage.dart';
import 'package:http/http.dart' as http;

import 'package:click/utils/api_config.dart';


apiGetAllFinanceiro(String route, String mes, String ano) async {
  var url = ApiConfig.buildUri('/'+route+'/get-all',{'id_condominio': Singleton.instance.id_condominio.toString(), 'mes':mes, 'ano':ano});
  try{
      var response = await http.get(
        url,
        headers: { "Authorization": getToken() }
      );

    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body);
      return parsed == "" ? {} : parsed;
    } else {
      var parsed = jsonDecode(response.body) as Map<String, dynamic>;
      return [];
    }
  }catch(e){
    print(e);
    return "Houve um erro, tente novamente!";
  }
}

apiGetDetailsInadimplente(String route, String bloco, String apto) async {
  var url = ApiConfig.buildUri('/'+route+'/get',{'id_condominio': Singleton.instance.id_condominio.toString(), 'bloco': bloco, 'apto': apto});
  try{
      var response = await http.get(
        url,
        headers: { "Authorization": getToken() }
      );

    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body) as List<dynamic>;
      return parsed;
    } else {
      return null;
    }
  }catch(e){
    return null;
  }
}

apiUpdateFinanceiroStatus(int id, int status) async {
  var url = ApiConfig.buildUri('/financeiro/update-status');
  try {
    var response = await http.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({ "id": id, "status": status })
    );
    return response.statusCode == 200;
  } catch(e) {
    return false;
  }
}

apiUploadBoleto(int id, String fileBase64) async {
  var url = ApiConfig.buildUri('/financeiro/upload-shared-file');
  try {
    var response = await http.post(
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
    var response = await http.post(
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
  try {
    var response = await http.get(url, headers: { "Authorization": getToken() });
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    return [];
  } catch(e) {
    return [];
  }
}

apiInsertMoradorFinanceiro(Map<String, dynamic> data) async {
  var url = ApiConfig.buildUri('/financeiro/morador/insert');
  try {
    var response = await http.post(
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
    var response = await http.post(
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

apiRemoveMoradorFinanceiro(int id) async {
  var url = ApiConfig.buildUri('/financeiro/morador/remove');
  try {
    var response = await http.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({ "id": id })
    );
    return response.statusCode == 200;
  } catch(e) {
    return false;
  }
}

