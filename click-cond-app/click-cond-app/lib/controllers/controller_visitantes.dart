import 'package:click/utils/log.dart';
import 'dart:convert';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';


/// Visitas por página de `GET /visitantes/get-all` (`take: 30` na API).
/// Página cheia = pode haver mais: a tela oferece "carregar mais".
const int visitantesPorPagina = 30;

/// [offset] pula as visitas já carregadas (a API pagina de 30 em 30).
/// Em falha devolve `[]`; as telas usam [apiGetAllVisitantesOuNull].
apiGetAllVisitantes(String search, {bool allCondos = false, int offset = 0}) async {
  return await apiGetAllVisitantesOuNull(search, allCondos: allCondos, offset: offset) ?? [];
}

/// Igual a [apiGetAllVisitantes], mas devolve `null` quando a busca falha
/// (status diferente de 200, sem rede, tempo esgotado, corpo inválido): a
/// recarga depois de check-in/baixa ou o puxar-para-atualizar mantém a lista
/// que está na tela em vez de esvaziá-la (A2).
Future<List<dynamic>?> apiGetAllVisitantesOuNull(String search, {bool allCondos = false, int offset = 0}) async {
  final Map<String, String> params = {
    'offset': '$offset',
    'search': search,
  };
  if (!allCondos && Singleton.instance.id_condominio != 0) {
    params['id_condominio'] = Singleton.instance.id_condominio.toString();
    params['id_apto'] = Singleton.instance.getIdApartamento();
  }
  var url = ApiConfig.buildUri('/visitantes/get-all', params);
  try {
    logDebug('[apiGetAllVisitantes] allCondos: $allCondos');
    var response = await ApiClient.get(
      url,
    );
    // O body traz CPF, PIN de portaria e foto de rosto: nunca logar.
    logDebug('[apiGetAllVisitantes] status ${response.statusCode}');

    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      if (parsed == null || parsed == "") return [];
      return parsed is List ? parsed : null;
    }
    return null;
  } catch (e) {
    logDebug('[apiGetAllVisitantes] Error: $e');
    return null;
  }
}

apiSaveVisitante(dynamic obj, bool isEdit) async {
  final Map<String, String> headers = {
    "Authorization": getToken(),
    "Content-Type": "application/json; charset=utf-8"
  };
  final endUri = isEdit ? 'update' : 'insert';
  final url = ApiConfig.buildUri('/visitantes/$endUri');
  final body = json.encode({
    'id_condominio': Singleton.instance.id_condominio.toString(),
    'visitante': obj is Map ? obj : obj.toJson()
  });

  try {
    final response = await ApiClient.post(
      url,
      headers: headers,
      body: body,
      encoding: utf8,
    ).timeout(ApiConfig.timeout);

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (response.body.isNotEmpty) {
        return jsonDecode(response.body);
      }
      return {};
    }
    final parsed = jsonDecode(response.body);
    return parsed['message'] ?? "Erro ao salvar visitante";
  } catch (e) {
    return "Falha de comunicação com o servidor.";
  }
}

/// Portaria remota: lista as solicitações de autorização PENDENTES dos
/// apartamentos do morador logado. GET /visitantes/pendentes.
/// [idCondominio] (o do push tocado) tem precedência sobre o condomínio aberto.
///
/// Em falha devolve `[]` (contadores). A tela de pendentes usa
/// [apiGetPendentesOuNull] para não apagar os cards por uma falha de rede.
apiGetPendentes({int? idCondominio}) async {
  return await apiGetPendentesOuNull(idCondominio: idCondominio) ?? [];
}

/// Igual a [apiGetPendentes], mas devolve `null` quando a busca falha (status
/// diferente de 200, sem rede, tempo esgotado): quem chama mantém o que já
/// mostra em vez de um falso "nenhuma solicitação".
Future<List<dynamic>?> apiGetPendentesOuNull({int? idCondominio}) async {
  final params = <String, String>{};
  final cond = idCondominio ?? Singleton.instance.id_condominio;
  // Sem condomínio aberto (app aberto pela notificação), não manda "null".
  if (cond != null && cond != 0) {
    params['id_condominio'] = cond.toString();
  }
  final url = ApiConfig.buildUri('/visitantes/pendentes', params.isEmpty ? null : params);
  try {
    final response = await ApiClient.get(
      url,
    ).timeout(ApiConfig.timeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return parsed is List ? parsed : null;
    }
    return null;
  } catch (e) {
    logDebug('[apiGetPendentes] Error: $e');
    return null;
  }
}

/// Portaria remota: morador responde a uma solicitação.
/// autorizar=true, darEntrada=false → POST /visitantes/:id/autorizar (libera acesso e facial)
/// autorizar=true, darEntrada=true  → POST /visitantes/:id/autorizar { darEntrada: true } (libera e já registra entrada)
/// autorizar=false                  → POST /visitantes/:id/negar
/// Retorna {} em sucesso ou a mensagem de erro.
apiResponderAutorizacao(int idVisitante, bool autorizar, {bool darEntrada = false}) async {
  final r = await apiResponderAutorizacaoComStatus(idVisitante, autorizar, darEntrada: darEntrada);
  return r.erro == null ? {} : r.erro;
}

/// Igual a [apiResponderAutorizacao], mas devolve também o status HTTP
/// (`null` = sem resposta: rede ou timeout). O card do Android decide por ele
/// se fecha quando o servidor recusa o NEGAR (400/409), como no delivery.
/// `erro` é null em sucesso.
///
/// [skip401Handling]: o card do Android responde em segundo plano, sem tela;
/// ali um 401 não pode deslogar o app em silêncio (quem chama trata).
Future<({int? statusCode, dynamic erro})> apiResponderAutorizacaoComStatus(
    int idVisitante, bool autorizar, {bool darEntrada = false, bool skip401Handling = false}) async {
  final acao = autorizar ? 'autorizar' : 'negar';
  final url = ApiConfig.buildUri('/visitantes/$idVisitante/$acao');
  final headers = {
    "Authorization": getToken(),
    "Content-Type": "application/json; charset=utf-8"
  };
  final dynamic response;
  try {
    final body = autorizar ? {'darEntrada': darEntrada} : {};
    response = await ApiClient.post(
      url,
      headers: headers,
      body: json.encode(body),
      encoding: utf8,
      skip401Handling: skip401Handling,
    ).timeout(ApiConfig.timeout);
  } catch (e) {
    return (statusCode: null, erro: "Falha de comunicação com o servidor.");
  }
  final int status = response.statusCode;
  if (status >= 200 && status < 300) {
    return (statusCode: status, erro: null);
  }
  // Lista do ValidationPipe, HTML de proxy ou rótulo HTTP não vão crus para a tela.
  return (statusCode: status, erro: mensagemCurtaDaApi(response.body) ?? "Erro ao responder solicitação");
}

/// Registra a entrada manual de um visitante (check-in pelo morador ou porteiro).
/// Chama POST /visitantes/check-in com o id do visitante.
apiCheckInVisitante(int idVisitante) async {
  final url = ApiConfig.buildUri('/visitantes/check-in');
  final headers = {
    "Authorization": getToken(),
    "Content-Type": "application/json; charset=utf-8"
  };
  final body = json.encode({'id': idVisitante});
  try {
    final response = await ApiClient.post(
      url,
      headers: headers,
      body: body,
      encoding: utf8,
    ).timeout(ApiConfig.timeout);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return {};
    }
    final parsed = jsonDecode(response.body);
    return parsed['message'] ?? "Erro ao registrar entrada";
  } catch (e) {
    return "Falha de comunicação com o servidor.";
  }
}

/// Registra a saída manual / dá baixa na visita (check-out pelo morador ou porteiro).
/// Chama POST /visitantes/check-out com o id do visitante.
apiCheckOutVisitante(int idVisitante) async {
  final url = ApiConfig.buildUri('/visitantes/check-out');
  final headers = {
    "Authorization": getToken(),
    "Content-Type": "application/json; charset=utf-8"
  };
  final body = json.encode({'id': idVisitante});
  try {
    final response = await ApiClient.post(
      url,
      headers: headers,
      body: body,
      encoding: utf8,
    ).timeout(ApiConfig.timeout);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return {};
    }
    final parsed = jsonDecode(response.body);
    return parsed['message'] ?? "Erro ao dar baixa na visita";
  } catch (e) {
    return "Falha de comunicação com o servidor.";
  }
}

// ===================== Convite de visita por link =====================
//
// O morador gera um link, manda pelo WhatsApp, e o visitante preenche nome,
// CPF e foto pelo próprio celular. O que volta é um RASCUNHO: nada entra na
// portaria antes de o morador confirmar.

/// Corpo do POST /convites. Leva a unidade em que o morador está navegando
/// (`Singleton.id_apartamento`, o `apto_id` do condomínio aberto): sem ela a
/// API usava a primeira unidade da conta, e quem tem duas gerava o link para
/// a errada. A API só aceita unidade vinculada ao próprio morador. Sem
/// unidade válida (síndico sem apto, -1), vai só o tipo e a API escolhe como
/// antes.
Map<String, dynamic> corpoGerarConvite({required bool isPrestador, dynamic idApartamento}) {
  final id = int.tryParse(idApartamento?.toString() ?? '');
  return {
    'is_prestador': isPrestador,
    if (id != null && id > 0) 'id_apartamento': id,
  };
}

/// Gera o convite. O backend decide o condomínio pelo vínculo do morador e
/// confere a unidade enviada contra esses vínculos.
apiGerarConvite({bool isPrestador = false}) async {
  var url = ApiConfig.buildUri('/convites');
  try {
    var response = await ApiClient.post(
      url,
      body: jsonEncode(corpoGerarConvite(
        isPrestador: isPrestador,
        idApartamento: Singleton.instance.id_apartamento,
      )),
    );
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    return _mensagemDeErro(response, 'Não foi possível gerar o convite.');
  } catch (e) {
    return { "erro": "Falha de comunicação." };
  }
}

/// Convites já preenchidos, esperando a decisão deste morador.
apiGetConvitesPendentes() async {
  var url = ApiConfig.buildUri('/convites/pendentes');
  try {
    var response = await ApiClient.get(url);
    if (response.statusCode == 200) {
      var parsed = jsonDecode(response.body);
      return parsed is List ? parsed : [];
    }
    return [];
  } catch (e) {
    return [];
  }
}

/// Confirma ou recusa. Os extras (período e dias) só existem na confirmação
/// e são OPCIONAIS no servidor — a versão do app publicada antes deles manda
/// corpo vazio e continua funcionando.
apiResponderConvite(
  int id, {
  required bool confirmar,
  String? dataInicio,
  String? dataTermino,
  String? diasSemana,
}) async {
  final acao = confirmar ? 'confirmar' : 'recusar';
  var url = ApiConfig.buildUri('/convites/$id/$acao');
  try {
    final Map<String, dynamic> corpo = {};
    if (confirmar) {
      if (dataInicio != null) corpo['data_hora_inicio'] = dataInicio;
      if (dataTermino != null) corpo['data_hora_termino'] = dataTermino;
      if (diasSemana != null) corpo['dias_semana'] = diasSemana;
    }
    var response = await ApiClient.post(
      url,
      body: jsonEncode(corpo),
    );
    if (response.statusCode == 200) return { "ok": true };
    return _mensagemDeErro(response, 'Não foi possível responder ao convite.');
  } catch (e) {
    return { "erro": "Falha de comunicação." };
  }
}

/// Extrai a mensagem que o NestJS manda em `message`. O servidor explica
/// melhor que um texto genérico — ele sabe se o teto de convites estourou ou
/// se a unidade não está vinculada.
Map<String, dynamic> _mensagemDeErro(dynamic response, String padrao) {
  try {
    final body = jsonDecode(response.body);
    final msg = body is Map ? body['message'] : null;
    if (msg != null && msg.toString().trim().isNotEmpty) {
      return { "erro": msg is List ? msg.join(', ') : msg.toString() };
    }
  } catch (_) {}
  return { "erro": padrao };
}
