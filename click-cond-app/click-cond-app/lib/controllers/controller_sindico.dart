import 'dart:convert';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/local_storage.dart';
import 'package:http/http.dart' as http;
import 'package:click/utils/api_client.dart';

final _kTimeout = ApiConfig.timeout;

Uri _buildUri(String path) => ApiConfig.buildUri(path);

Map<String, String> _authHeaders({bool withContentType = false}) {
  final headers = <String, String>{"Authorization": getToken()};
  if (withContentType) headers["Content-Type"] = "application/json";
  return headers;
}

loginSindico(String login, String password) async {
  try {
    final url = _buildUri('/sindico/login');
    final body = json.encode({'login': login, 'password': password});
    final response = await http
        .post(url,
            headers: {"Content-Type": "application/json"}, body: body)
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
    final response = await http
        .post(url,
            headers: {"Content-Type": "application/json"}, body: body)
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
    final response = await http
        .post(url,
            headers: {"Content-Type": "application/json"}, body: body)
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
        .post(url, headers: _authHeaders(withContentType: true), body: body)
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

updatePasswordSindicoApi(String senha) async {
  final url = _buildUri('/sindico/new-password');
  final body = json.encode({"senha": senha});
  try {
    final response = await ApiClient
        .post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      // Corrigido: era storageMorador() por engano — sindico usa storageLogin()
      storageLogin(parsed);
      return "";
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    throw "Houve um erro, tente novamente!";
  }
}

// Vincula o próprio síndico logado como morador de um apartamento.
// Retorna o Map {id_condominio, apto_id, apto, apto_bloco, apto_tipo} em sucesso,
// ou lança a mensagem de erro do backend.
apiLinkSindicoMorador(dynamic idApartamento, String tipo) async {
  final url = _buildUri('/sindico/link-morador');
  final body = json.encode({'id_apartamento': idApartamento.toString(), 'tipo': tipo});
  try {
    final response = await ApiClient
        .post(url, headers: _authHeaders(withContentType: true), body: body)
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
