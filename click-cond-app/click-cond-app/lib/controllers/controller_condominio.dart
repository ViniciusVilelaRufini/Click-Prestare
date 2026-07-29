import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/foundation.dart';
import 'package:click/pages/sindico/signup/signup_%20condominium_1.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';

import '../pages/singleton.dart';

final _kTimeout = ApiConfig.timeout;

Uri _buildUri(String path, [Map<String, String>? params]) =>
    ApiConfig.buildUri(path, params);

Map<String, String> _authHeaders({bool withContentType = false}) {
  final headers = <String, String>{"Authorization": getToken()};
  if (withContentType) headers["Content-Type"] = "application/json";
  return headers;
}

registerCondominio(CondominioRegister condominio) async {
  final url = _buildUri('/condominio/register');
  final body = json.encode({
    "address": {
      "cep": condominio.cep,
      "rua": condominio.rua,
      "numero": condominio.numero,
      "complemento": condominio.complemento,
      "bairro": condominio.bairro,
      "cidade": condominio.cidade,
      "uf": condominio.uf,
      "pais": condominio.pais,
    },
    "condominio": {
      "nome": condominio.nome,
      "identificacao": condominio.documento,
      "subsindico_nome": condominio.subsindico,
      "inicio_mandato": condominio.inicioMandato,
      "termino_mandato": condominio.terminoMandato,
      "num_blocos": condominio.blocos,
      "num_aptos": condominio.aptos,
      "photo": condominio.photoBase64,
    }
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) return "";
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    return parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    return "Houve um erro, tente novamente!";
  }
}

getCondominios() async {
  final url = _buildUri('/sindico/list-condominios');
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    return [];
  } catch (e) {
    return "Houve um erro, tente novamente!";
  }
}

getCondominio(int id) async {
  final url = _buildUri('/condominio/get-condominio', {'id_condominio': id.toString()});
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    return null;
  } catch (e) {
    return "Houve um erro, tente novamente!";
  }
}

updateInfosCondominio(String nome, String documento, String subsindico,
    String dtIni, String dtFim, String? photo) async {
  final url = _buildUri('/condominio/update');
  final body = json.encode({
    "condominio": {
      "id": Singleton.instance.id_condominio.toString(),
      "nome": nome,
      "identificacao": documento,
      "subsindico_nome": subsindico,
      "inicio_mandato": dtIni,
      "termino_mandato": dtFim,
      'photo': photo,
    }
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) return;
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    throw "Houve um erro, tente novamente!";
  }
}

updateAddressCondominio(String cep, String rua, String numero,
    String complemento, String bairro, String cidade, String uf, String pais) async {
  final url = _buildUri('/condominio/update-address');
  final body = json.encode({
    "address": {
      "idCondominio": Singleton.instance.id_condominio.toString(),
      "cep": cep,
      "rua": rua,
      "numero": numero,
      "complemento": complemento,
      "bairro": bairro,
      "cidade": cidade,
      "uf": uf,
      "pais": pais,
    }
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) return;
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    throw "Houve um erro, tente novamente!";
  }
}

updateAsinaturaCondominioApi(
    String idCondominio, String plano, String codigo) async {
  final url = _buildUri('/condominio/update-assinatura');
  final body = json.encode({
    "assinatura": {
      "id_condominio": idCondominio,
      "id_plano": plano,
      "codigo": codigo,
      "plataforma": kIsWeb ? "Web" : "Mobile",
    }
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) return;
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    throw "Houve um erro, tente novamente!";
  }
}

updateMoedaCondominioApi(String idCondominio, String moeda) async {
  final url = _buildUri('/condominio/update-moeda');
  final body = json.encode({
    "condominio": {"id": idCondominio, "moeda": moeda}
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) return;
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    throw "Houve um erro, tente novamente!";
  }
}

// [idCondominio] opcional: quando informado, o resumo (visitas/encomendas) é
// filtrado por aquele condomínio (dashboard dentro de um condomínio). Sem ele,
// o backend agrega todos os condomínios do morador (tela "Resumo Geral").
/// Exclui a conta do usuário logado (requisito Play Store / LGPD).
/// Retorna true em sucesso.
Future<bool> apiDeleteAccount() async {
  final url = _buildUri('/users/delete-account');
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: '{}')
        .timeout(_kTimeout);
    return response.statusCode == 200;
  } catch (e) {
    print('[apiDeleteAccount] Error: $e');
    return false;
  }
}

getMeusEventos({int limit = 15}) async {
  final url = _buildUri('/dashboard/meus-eventos', {'limit': limit.toString()});
  try {
    final response = await ApiClient.get(url, headers: _authHeaders()).timeout(_kTimeout);
    if (response.statusCode == 200) {
      final decoded = jsonDecode(response.body);
      return decoded is List ? decoded : [];
    }
    return [];
  } catch (e) {
    print('[getMeusEventos] Error: $e');
    return [];
  }
}

getDashboardSummary([dynamic idCondominio]) async {
  final url = _buildUri('/dashboard/summary',
      (idCondominio != null && idCondominio.toString().isNotEmpty)
          ? {'id_condominio': idCondominio.toString()}
          : null);
  try {
    final response = await ApiClient.get(url, headers: _authHeaders()).timeout(_kTimeout);
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    return null;
  } catch (e) {
    print('[getDashboardSummary] Error: $e');
    return null;
  }
}
