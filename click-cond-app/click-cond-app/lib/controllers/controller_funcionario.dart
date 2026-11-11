import 'package:click/utils/log.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:click/utils/local_storage.dart';

import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/troca_email.dart';


loginFuncionario(String login, String password) async {  
  try{
    var url = ApiConfig.buildUri('/funcionarios/login');
    Map data = {'login': login, 'password': password};
    var body = json.encode(data);
    var response = await ApiClient.post(url,headers: {"Content-Type": "application/json"},body: body, skip401Handling: true);
    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body) as Map<String, dynamic>;
      storageFuncionario(parsed);
      return "";
    } else {
      var parsed = jsonDecode(response.body) as Map<String, dynamic>;
      return parsed["message"];
    }
  }catch(e){
    logDebug(e);
    return "Houve um erro, tente novamente!";
  }
}

getCondominiosFuncionario() async {
  var url = ApiConfig.buildUri('/funcionarios/list-condominios');
  try{
      var response = await ApiClient.get(
        url,
      );

    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body);
      return parsed;
    } else {
      return [];
    }
  }catch(e){
    logDebug(e);
    return "Houve um erro, tente novamente!";
  }
}

/// [senhaAtual] vai junto do e-mail quando o funcionário troca o próprio
/// e-mail de acesso — a API recusa a troca sem ela.
updateFuncionarioApi(dynamic funcionario, {String? senhaAtual}) async {
  var url = ApiConfig.buildUri('/funcionarios/update-infos');
  Map data = {
    "funcionario": comSenhaAtual(funcionario, senhaAtual),
  };
  var body = json.encode(data);
  http.Response response;
  try {
    response = await ApiClient.post(url, body: body);
  } catch (e) {
    logDebug(e);
    throw "Houve um erro, tente novamente!";
  }
  if (response.statusCode == 200) {
    var parsed = jsonDecode(response.body) as Map<String, dynamic>;
    storageFuncionario(parsed);
    return "";
  }
  // Antes a mensagem da API era engolida e virava "Houve um erro": o
  // funcionário não via "informe sua senha atual" nem "e-mail em uso".
  throw mensagemDeErroApi(response.body);
}

updatePasswordFuncionarioApi(String senhaAtual, String senha) async {
  var url = ApiConfig.buildUri('/funcionarios/new-password');
  var body = json.encode({"senha_atual": senhaAtual, "senha": senha});
  http.Response response;
  try {
    response = await ApiClient.post(
      url,
      body: body,
    ).timeout(ApiConfig.timeout);
  } catch (e) {
    throw "Houve um erro, tente novamente!";
  }
  if (response.statusCode == 200) {
    var parsed = jsonDecode(response.body) as Map<String, dynamic>;
    // Era storageMorador(): gravava loginType='morador' e apagava as 8 flags
    // de permissão — o porteiro perdia a portaria ao trocar a própria senha.
    atualizarTokenSessao(parsed);
    return "";
  }
  throw mensagemDeErroApi(response.body);
}
