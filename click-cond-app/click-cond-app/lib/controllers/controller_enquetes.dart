import 'dart:convert';

import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';


apiFinishEnquete(String id) async {
  try{
    var url = ApiConfig.buildUri('/assembleias/votacoes/finish');
    Map data = {'id': id};
    var body = json.encode(data);
    var response = await ApiClient.post(url,body: body,);
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

