import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:click/utils/api_config.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/api_client.dart';

final _kTimeout = ApiConfig.timeout;

Uri _buildUri(String path) => ApiConfig.buildUri(path);

loginSindico(String login, String password) async {
  try {
    final url = _buildUri('/sindico/login');
    final body = json.encode({'login': login, 'password': password});
    final response = await ApiClient
        .post(url,
            headers: {"Content-Type": "application/json"}, body: body,
            skip401Handling: true)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      storageLogin(parsed);
      return "";
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    return parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    return "Houve um erro, tente novamente!";
  }
}

passRecoveryApi(String email, String loginType) async {
  final url = ApiConfig.buildUri('/$loginType/recovery-password');
  final body = json.encode({'email': email});
  try {
    final response = await ApiClient
        .post(url,
            headers: {"Content-Type": "application/json"}, body: body,
            skip401Handling: true)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      return parsed["message"] ?? parsed["msg"] ?? "E-mail de recuperação enviado com sucesso!";
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? parsed["msg"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    throw e;
  }
}

signupSindico(String nome, String documento, String dn, String email,
    String telefone, String senha, String? photo) async {
  final url = _buildUri('/sindico/signup');
  final body = json.encode({
    "nome": nome,
    "email": email,
    "password": senha,
    "date_birth": dn,
    "phone": telefone,
    "doc_identification": documento,
    'photo': photo,
  });
  try {
    final response = await ApiClient
        .post(url,
            headers: {"Content-Type": "application/json"}, body: body,
            skip401Handling: true)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      storageLogin(parsed);
      return "";
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    return parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    return "Houve um erro, tente novamente!";
  }
}

updateSindico(String nome, String documento, String dn, String email,
    String telefone, String? photo) async {
  final url = _buildUri('/sindico/update');
  final body = json.encode({
    "nome": nome,
    "email": email,
    "date_birth": dn,
    "phone": telefone,
    "doc_identification": documento,
    'photo': photo,
  });
  try {
    final response = await ApiClient
        .post(url, body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      storageLogin(parsed);
      return;
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    throw e;
  }
}

updatePasswordSindicoApi(String senhaAtual, String senha) async {
  final url = _buildUri('/sindico/new-password');
  final body = json.encode({"senha_atual": senhaAtual, "senha": senha});
  http.Response response;
  try {
    response = await ApiClient
        .post(url, body: body)
        .timeout(_kTimeout);
  } catch (e) {
    throw "Houve um erro, tente novamente!";
  }
  if (response.statusCode == 200) {
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    // Só o token é renovado: a resposta de /new-password não tem o mesmo
    // formato do login (ver atualizarTokenSessao em local_storage.dart).
    atualizarTokenSessao(parsed);
    return "";
  }
  // A mensagem do servidor precisa chegar na tela — "Senha atual incorreta."
  // não pode virar "houve um erro".
  throw mensagemDeErroApi(response.body);
}

// Vincula o próprio síndico logado como morador de um apartamento.
// Retorna o Map {id_condominio, apto_id, apto, apto_bloco, apto_tipo} em sucesso,
// ou lança a mensagem de erro do backend.
apiLinkSindicoMorador(dynamic idApartamento, String tipo) async {
  final url = _buildUri('/sindico/link-morador');
  final body = json.encode({'id_apartamento': idApartamento.toString(), 'tipo': tipo});
  try {
    final response = await ApiClient
        .post(url, body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    throw e is String ? e : "Houve um erro, tente novamente!";
  }
}
