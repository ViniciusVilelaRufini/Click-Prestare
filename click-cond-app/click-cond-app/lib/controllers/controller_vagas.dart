import 'package:click/utils/log.dart';
import 'dart:convert';
import 'package:click/models/vaga_model.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';

Map<String, String> _headers({bool withContentType = false}) {
  final h = <String, String>{"Authorization": getToken()};
  if (withContentType) h["Content-Type"] = "application/json; charset=utf-8";
  return h;
}

/// Unidade aberta no app, para a API operar ESTA unidade (e não a primeira
/// da conta, como acontecia com quem tem duas). Síndico sem apto (-1), sem
/// unidade aberta ou unidade de outro condomínio não manda nada — a API usa
/// o vínculo mais antigo.
Map<String, String> unidadeAberta() {
  final id = Singleton.instance.unidadeDoCondominioAberto();
  return id.isEmpty ? {} : {'id_apartamento': id};
}

/// Vagas do apartamento do morador logado (total + ocupadas).
Future<VagasResumo> apiGetVagas() async {
  return await apiGetVagasOuNull() ?? VagasResumo.empty();
}

/// Igual a [apiGetVagas], mas devolve `null` quando a busca falha (status
/// diferente de 200, resposta sem o formato, sem rede). A tela de vagas usa
/// esta: em falha fica o resumo que já estava, em vez de um falso "sem vagas"
/// que também escondia o botão "Liberar vaga".
Future<VagasResumo?> apiGetVagasOuNull() async {
  final url = ApiConfig.buildUri('/vagas/get-all', {
    'id_condominio': Singleton.instance.id_condominio.toString(),
    ...unidadeAberta(),
  });
  try {
    final response =
        await ApiClient.get(url, headers: _headers()).timeout(ApiConfig.timeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      if (parsed is Map<String, dynamic>) return VagasResumo.fromJson(parsed);
    }
    return null;
  } catch (e) {
    logDebug('[apiGetVagas] Erro: $e');
    return null;
  }
}

/// Visitantes + inquilinos do apto, para escolher quem recebe a vaga.
Future<Map<String, List<BeneficiarioItem>>> apiGetBeneficiarios() async {
  final url = ApiConfig.buildUri('/vagas/beneficiarios', {
    'id_condominio': Singleton.instance.id_condominio.toString(),
    ...unidadeAberta(),
  });
  try {
    final response =
        await ApiClient.get(url, headers: _headers()).timeout(ApiConfig.timeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      List<BeneficiarioItem> mapList(dynamic v) => ((v as List?) ?? [])
          .map((e) => BeneficiarioItem.fromJson(e as Map<String, dynamic>))
          .toList();
      return {
        'visitantes': mapList(parsed['visitantes']),
        'inquilinos': mapList(parsed['inquilinos']),
      };
    }
    return {'visitantes': [], 'inquilinos': []};
  } catch (e) {
    logDebug('[apiGetBeneficiarios] Erro: $e');
    return {'visitantes': [], 'inquilinos': []};
  }
}

/// Libera uma vaga para visitante/inquilino. Retorna "" em sucesso ou a mensagem de erro.
Future<String> apiLiberarVaga({
  required String tipo, // 'visitante' | 'inquilino'
  int? idVisitante,
  int? idMoradorBeneficiario,
  int? idVeiculo,
  String? placa,
  DateTime? inicio,
  DateTime? fim,
}) async {
  final url = ApiConfig.buildUri('/vagas/liberar');
  final body = jsonEncode({
    'id_condominio': Singleton.instance.id_condominio.toString(),
    ...unidadeAberta(),
    'tipo': tipo,
    if (idVisitante != null) 'id_visitante': idVisitante,
    if (idMoradorBeneficiario != null) 'id_morador_beneficiario': idMoradorBeneficiario,
    if (idVeiculo != null) 'id_veiculo': idVeiculo,
    if (placa != null && placa.isNotEmpty) 'placa': placa,
    if (inicio != null) 'inicio': inicio.toIso8601String(),
    if (fim != null) 'fim': fim.toIso8601String(),
  });
  try {
    final response = await ApiClient.post(url,
            headers: _headers(withContentType: true), body: body, encoding: utf8)
        .timeout(ApiConfig.timeout);
    if (response.statusCode >= 200 && response.statusCode < 300) return "";
    try {
      final parsed = jsonDecode(response.body);
      return parsed['message']?.toString() ?? 'Não foi possível liberar a vaga.';
    } catch (_) {
      return 'Não foi possível liberar a vaga.';
    }
  } catch (e) {
    logDebug('[apiLiberarVaga] Erro: $e');
    return 'Falha de comunicação com o servidor. Verifique sua conexão.';
  }
}

/// Revoga uma vaga liberada. Retorna true em sucesso.
Future<bool> apiRevogarVaga(int id) async {
  final url = ApiConfig.buildUri('/vagas/revogar');
  final body = jsonEncode({
    'id': id,
    'id_condominio': Singleton.instance.id_condominio.toString(),
    ...unidadeAberta(),
  });
  try {
    final response = await ApiClient.post(url,
            headers: _headers(withContentType: true), body: body)
        .timeout(ApiConfig.timeout);
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch (e) {
    logDebug('[apiRevogarVaga] Erro: $e');
    return false;
  }
}
