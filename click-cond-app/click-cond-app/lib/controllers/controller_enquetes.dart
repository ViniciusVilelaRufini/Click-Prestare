import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';


/// Encerra a votação. Em recusa, lança a `message` da API quando ela serve
/// para a tela (`mensagemCurtaDaApi`); sem ela, ou sem conexão, o genérico.
apiFinishEnquete(String id) async {
  const generico = "Houve um erro, tente novamente!";
  final http.Response response;
  try {
    var url = ApiConfig.buildUri('/assembleias/votacoes/finish');
    var body = json.encode({'id': id});
    response = await ApiClient.post(url, body: body);
  } catch (e) {
    throw generico;
  }
  // O NestJS responde 201 nas rotas POST sem @HttpCode(200).
  if (response.statusCode >= 200 && response.statusCode < 300) return;
  throw mensagemCurtaDaApi(response.body) ?? generico;
}

