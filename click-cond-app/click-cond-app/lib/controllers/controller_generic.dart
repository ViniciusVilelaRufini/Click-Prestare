import 'dart:convert';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:http/http.dart' as http;

final _kTimeout = ApiConfig.timeout;

Uri _buildUri(String path, [Map<String, String>? params]) =>
    ApiConfig.buildUri(path, params);

Map<String, String> _authHeaders({bool withContentType = false}) {
  final headers = <String, String>{"Authorization": getToken()};
  if (withContentType) headers["Content-Type"] = "application/json; charset=utf-8";
  return headers;
}

apiSaveObject(String route, String nameObj, dynamic obj, bool isEdit) async {
  http.Response? response;
  try {
    final endUri = isEdit ? 'update' : 'insert';
    final url = _buildUri('/$route/$endUri');

    // Serializa o objeto: prefere obj.toJson() se existir, senão usa direto
    final Map<String, dynamic> payload = {};
    payload['id_condominio'] = Singleton.instance.id_condominio.toString();
    try {
      payload[nameObj] = obj is Map ? obj : obj.toJson();
    } catch (_) {
      payload[nameObj] = obj;
    }
    final body = json.encode(payload);

    response = await ApiClient.post(
          url,
          headers: _authHeaders(withContentType: true),
          body: body,
          encoding: utf8,
        ).timeout(_kTimeout);
  } catch (e) {
    // Falha de rede / timeout / serialização — devolve mensagem amigável
    return "Falha de comunicação com o servidor. Verifique sua conexão.";
  }

  // Sucesso
  if (response.statusCode >= 200 && response.statusCode < 300) return "";

  // Erro — tenta extrair message do body
  // ignore: avoid_print
  print('[apiSaveObject] HTTP ${response.statusCode} body=${response.body}');
  // Bodyzinho cru pra debug visivel ao usuario quando algo eh estranho
  // (vai pra dialog quando dev mode).
  final shortBody = response.body.length > 200
      ? '${response.body.substring(0, 200)}...'
      : response.body;
  try {
    final parsed = jsonDecode(response.body);
    if (parsed is Map && parsed["message"] != null) {
      final msg = parsed["message"];
      String msgStr;
      if (msg is List) {
        msgStr = msg.join(', ');
      } else {
        msgStr = msg.toString();
      }
      // Sanitiza: se a mensagem contem padroes de erro JS interno
      // (dart2js / runtime), substitui por mensagem generica.
      // 'Must call super constructor' eh um TypeError do JS engine.
      if (msgStr.contains('super constructor') ||
          msgStr.contains('Cannot read prop') ||
          msgStr.startsWith('TypeError:') ||
          msgStr.startsWith('RangeError:')) {
        // ignore: avoid_print
        print('[apiSaveObject] backend devolveu erro JS interno: $msgStr');
        // Inclui inicio do body no proprio erro pra dar pista ao usuario,
        // que vai poder mandar print pra mim em vez de precisar de F12.
        return 'Erro interno no servidor (HTTP ${response.statusCode}). Detalhes: $shortBody';
      }
      return msgStr;
    }
  } catch (_) {}
  return "Erro HTTP ${response.statusCode}: $shortBody";
}

apiDeleteObject(String route, int idObj) async {
  final url = _buildUri('/$route/remove');
  final body = json.encode({"id": idObj});
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

apiGetAll(String route) async {
  final url = _buildUri('/$route/get-all', {
    'id_condominio': Singleton.instance.id_condominio.toString(),
    'offset': '0',
    'id_apto': Singleton.instance.getIdApartamento(),
  });
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return (parsed == null || parsed == "") ? [] : parsed;
    }
    return [];
  } catch (e) {
    print('[apiGetAll] Erro: $e');
    return [];
  }
}

apiGetDetails(String route, int idItem) async {
  final url = _buildUri('/$route/get', {
    'id_condominio': Singleton.instance.id_condominio.toString(),
    'id': idItem.toString(),
  });
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    return null;
  } catch (e) {
    return null;
  }
}

apiGetAllDocs(String route, int isAta) async {
  final url = _buildUri('/$route/get-all', {
    'id_condominio': Singleton.instance.id_condominio.toString(),
    'is_ata': isAta.toString(),
  });
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return (parsed == null || parsed == "") ? [] : parsed;
    }
    return [];
  } catch (e) {
    print('[apiGetAllDocs] Erro: $e');
    return [];
  }
}

apiUpdateStatus(String route, int idItem, bool status, String motivo) async {
  final url = _buildUri('/$route/update-status');
  final body = json.encode({
    "id": idItem,
    "isAccept": status,
    "motivo_recusa": motivo,
    "id_condominio": Singleton.instance.id_condominio.toString(),
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) return "";
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Erro desconhecido";
  } catch (e) {
    throw e;
  }
}

apiUpdateStatusOcorrManut(String route, int idItem, String status) async {
  final url = _buildUri('/$route/update-status');
  final body = json.encode({
    "id": idItem,
    "status": status,
    "id_condominio": Singleton.instance.id_condominio.toString(),
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) return "";
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Erro desconhecido";
  } catch (e) {
    throw e;
  }
}

/// Atribui uma ocorrência a um funcionário (Users.id). idResponsavel null desatribui.
/// Dispara push ao funcionário em produção (NestJS). Retorna "" em sucesso.
apiUpdateResponsavel(int idOcorrencia, int? idResponsavel) async {
  final url = _buildUri('/ocorrencias/update-responsavel');
  final body = json.encode({
    "id": idOcorrencia,
    "id_responsavel": idResponsavel,
    "id_condominio": Singleton.instance.id_condominio.toString(),
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode >= 200 && response.statusCode < 300) return "";
    final parsed = jsonDecode(response.body);
    return (parsed is Map ? parsed["message"]?.toString() : null) ?? "Erro HTTP ${response.statusCode}";
  } catch (e) {
    return "Falha de comunicação com o servidor.";
  }
}

apiGetOcorrenciaMessages(int idOcorrencia) async {
  final url = _buildUri('/ocorrencias/mensagens/get-all', {
    'id': idOcorrencia.toString(),
  });
  try {
    final response = await ApiClient.get(url, headers: _authHeaders())
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return (parsed == null || parsed == "") ? [] : parsed;
    }
    return [];
  } catch (e) {
    print('[apiGetOcorrenciaMessages] Erro: $e');
    return [];
  }
}

apiSendOcorrenciaMessage(int idOcorrencia, String mensagem) async {
  final url = _buildUri('/ocorrencias/mensagens/enviar');
  final body = json.encode({
    "id_ocorrencia": idOcorrencia,
    "mensagem": mensagem,
  });
  try {
    final response = await ApiClient.post(url, headers: _authHeaders(withContentType: true), body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    return null;
  } catch (e) {
    print('[apiSendOcorrenciaMessage] Erro: $e');
    return null;
  }
}

/// Uma linha do card de confirmação (ex: "Área" / "Churrasqueira 1").
class AcaoItem {
  final String rotulo;
  final String valor;
  AcaoItem(this.rotulo, this.valor);
}

/// Botão do card. `efeito` diz o que fazer com `valor`:
///   copiar     -> área de transferência (PIX, linha digitável)
///   abrir_url  -> navegador (boleto, comprovante)
///   abrir_tela -> tela do app (valor = chave em TELAS_APP no backend)
class AcaoBotao {
  final String rotulo;
  final String efeito;
  final String valor;
  AcaoBotao(this.rotulo, this.efeito, this.valor);
}

/// Card que acompanha a resposta do assistente.
///
/// Dois formatos no mesmo widget: [confirmavel] = true mostra Confirmar/
/// Cancelar e executa via /chat-ia/confirmar; false é informativo, com
/// atalhos que agem só no app (copiar, abrir link, abrir tela).
class AcaoPendenteIa {
  final String? id;
  final String tipo;
  final String titulo;
  final List<AcaoItem> itens;
  final bool confirmavel;
  final List<AcaoBotao> botoes;

  AcaoPendenteIa({
    this.id,
    required this.tipo,
    required this.titulo,
    required this.itens,
    required this.confirmavel,
    required this.botoes,
  });

  static AcaoPendenteIa? deJson(dynamic j) {
    if (j is! Map) return null;
    final confirmavel = j['confirmavel'] == true;
    final id = j['id']?.toString();
    // Card confirmável sem id não tem como ser executado — descarta.
    if (confirmavel && (id == null || id.isEmpty)) return null;

    final itens = (j['itens'] as List? ?? [])
        .whereType<Map>()
        .map((i) => AcaoItem(
              i['rotulo']?.toString() ?? '',
              i['valor']?.toString() ?? '',
            ))
        .toList();
    final botoes = (j['botoes'] as List? ?? [])
        .whereType<Map>()
        .map((b) => AcaoBotao(
              b['rotulo']?.toString() ?? '',
              b['efeito']?.toString() ?? '',
              b['valor']?.toString() ?? '',
            ))
        .where((b) => b.rotulo.isNotEmpty && b.valor.isNotEmpty)
        .toList();

    // Card sem nada acionável não vira UI.
    if (!confirmavel && botoes.isEmpty) return null;

    return AcaoPendenteIa(
      id: id,
      tipo: j['tipo']?.toString() ?? '',
      titulo: j['titulo']?.toString() ?? 'Ação',
      itens: itens,
      confirmavel: confirmavel,
      botoes: botoes,
    );
  }
}

/// Resposta do assistente: texto e, quando ele preparou uma ação, a proposta
/// que vira card de confirmação na tela.
class RespostaIa {
  final String texto;
  final AcaoPendenteIa? acao;
  RespostaIa(this.texto, {this.acao});
}

/// Envia uma pergunta ao Assistente IA e devolve a resposta.
/// O escopo dos dados (síndico vê tudo, morador só o próprio) é aplicado no
/// backend a partir do JWT; o histórico da conversa também é mantido lá.
Future<RespostaIa> apiPerguntarChatIa(String pergunta) async {
  final url = _buildUri('/chat-ia/perguntar');
  final body = json.encode({
    "id_condominio": Singleton.instance.id_condominio.toString(),
    "pergunta": pergunta,
  });
  try {
    final response = await ApiClient.post(
      url,
      headers: _authHeaders(withContentType: true),
      body: body,
    ).timeout(const Duration(seconds: 60));
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body);
      return RespostaIa(
        (parsed["resposta"] ?? "").toString(),
        acao: AcaoPendenteIa.deJson(parsed["acao"]),
      );
    }
    try {
      final parsed = jsonDecode(response.body);
      return RespostaIa(parsed["message"]?.toString() ??
          "Não consegui responder agora. Tente novamente.");
    } catch (_) {
      return RespostaIa("Não consegui responder agora. Tente novamente.");
    }
  } catch (e) {
    print('[apiPerguntarChatIa] Erro: $e');
    return RespostaIa("Falha de comunicação com o servidor. Verifique sua conexão.");
  }
}

/// Confirma uma ação proposta pelo assistente. Só aqui a escrita acontece.
/// Devolve a mensagem de sucesso, ou lança a mensagem de erro do backend.
Future<String> apiConfirmarAcaoChatIa(String idAcao) async {
  final url = _buildUri('/chat-ia/confirmar');
  final body = json.encode({
    "id_condominio": Singleton.instance.id_condominio.toString(),
    "id_acao": idAcao,
  });
  try {
    final response = await ApiClient.post(
      url,
      headers: _authHeaders(withContentType: true),
      body: body,
    ).timeout(const Duration(seconds: 30));
    final parsed = jsonDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return (parsed["mensagem"] ?? "Pronto!").toString();
    }
    final msg = parsed["message"];
    throw (msg is List ? msg.join(', ') : msg?.toString()) ??
        "Não foi possível concluir.";
  } catch (e) {
    if (e is String) rethrow;
    print('[apiConfirmarAcaoChatIa] Erro: $e');
    throw "Falha de comunicação com o servidor.";
  }
}
