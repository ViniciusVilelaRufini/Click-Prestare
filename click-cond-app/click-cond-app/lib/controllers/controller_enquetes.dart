import 'dart:convert';
import 'package:click/utils/local_storage.dart';
import 'package:http/http.dart' as http;

import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';


apiFinishEnquete(String id) async {
  try{
    var url = ApiConfig.buildUri('/assembleias/votacoes/finish');
    Map data = {'id': id};
    var body = json.encode(data);
    var response = await ApiClient.post(url,headers: {"Content-Type": "application/json", "Authorization": getToken()},body: body,);
    if (response.statusCode == 200) {
      return;
    } else {
      var parsed = jsonDecode(response.body) as Map<String, dynamic>;
      throw(parsed["message"]);
    }
  }catch(e){
    throw("Houve um erro, tente novamente!");
  }
}

