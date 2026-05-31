import 'dart:convert';
import 'package:click/utils/local_storage.dart';
import 'package:http/http.dart' as http;

import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';


loginFuncionario(String login, String password) async {  
  try{
    var url = ApiConfig.buildUri('/funcionarios/login');
    Map data = {'login': login, 'password': password};
    var body = json.encode(data);
    var response = await http.post(url,headers: {"Content-Type": "application/json"},body: body,);
    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body) as Map<String, dynamic>;
      storageFuncionario(parsed);
      return "";
    } else {
      var parsed = jsonDecode(response.body) as Map<String, dynamic>;
      return parsed["message"];
    }
  }catch(e){
    print(e);
    return "Houve um erro, tente novamente!";
  }
}

getCondominiosFuncionario() async {
  var url = ApiConfig.buildUri('/funcionarios/list-condominios');
  try{
      var response = await ApiClient.get(
        url,
        headers: { "Authorization": getToken() }
      );

    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body);
      return parsed;
    } else {
      return [];
    }
  }catch(e){
    print(e);
    return "Houve um erro, tente novamente!";
  }
}

updateFuncionarioApi(dynamic funcionario) async {
  var url = ApiConfig.buildUri('/funcionarios/update-infos');
  Map data = {
    "funcionario": funcionario
  };
  var body = json.encode(data);
  try{
    var response = await ApiClient.post(url,headers: {"Content-Type": "application/json", "Authorization": getToken()},body: body,);
    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body) as Map<String, dynamic>;
      storageFuncionario(parsed);
      return "";
    } else {
      var parsed = jsonDecode(response.body) as Map<String, dynamic>;
      throw(parsed["message"]);
    }
  }catch(e){
    throw("Houve um erro, tente novamente!");
  }
}

updatePasswordFuncionarioApi(String senha) async {
  var url = ApiConfig.buildUri('/funcionarios/new-password');
  Map data = {
    "senha": senha,
  };
  var body = json.encode(data);
  try{
    var response = await ApiClient.post(url,headers: {"Content-Type": "application/json", "Authorization": getToken()},body: body,);
    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body) as Map<String, dynamic>;
      storageMorador(parsed);
      return "";
    } else {
      var parsed = jsonDecode(response.body) as Map<String, dynamic>;
      throw(parsed["message"]);
    }
  }catch(e){
    throw("Houve um erro, tente novamente!");
  }
}
