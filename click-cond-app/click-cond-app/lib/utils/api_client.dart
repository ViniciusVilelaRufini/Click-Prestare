import 'dart:convert' show Encoding, jsonDecode;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:click/utils/api_config.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/log.dart';
import 'package:click/utils/navigation_service.dart';

/// Wrapper sobre `http` que centraliza tratamento de 401.
///
/// Por que existe:
///   - O backend reduziu expiração do JWT de 7 dias para 8 horas (commit
///     ffba018). Antes, o token raramente expirava. Agora, todo usuário
///     que abre o app no dia seguinte recebe 401 em todos os requests e
///     ficava com "Houve um erro, tente novamente" sem entender por quê.
///   - Esse wrapper detecta 401, limpa storage (logout) e força o app
///     a voltar para a tela inicial (que pede login de novo).
///
/// Como usar: substituir `http.get/post(...)` por `ApiClient.get/post(...)`
/// nos controllers. A API é igual à do package `http`, então a migração
/// é mecânica.
/// Extrai a mensagem de erro que o NestJS mandou no corpo da resposta.
///
/// Sem isto, os `catch` dos controllers trocam a explicação do servidor por um
/// "Houve um erro, tente novamente!" genérico — e o usuário fica sem saber que
/// o problema foi, por exemplo, a senha atual estar errada.
String mensagemDeErroApi(String body, {String fallback = 'Houve um erro, tente novamente!'}) {
  try {
    final parsed = jsonDecode(body);
    if (parsed is Map) {
      final message = parsed['message'];
      // O ValidationPipe do NestJS manda lista quando reprova vários campos.
      if (message is List) {
        final texto = message.map((m) => m.toString().trim()).where((m) => m.isNotEmpty).join('\n');
        if (texto.isNotEmpty) return texto;
      } else if (message != null && message.toString().trim().isNotEmpty) {
        return message.toString().trim();
      }
    }
  } catch (_) {
    // Corpo não-JSON (HTML de proxy, resposta vazia): cai no fallback.
  }
  return fallback;
}

/// Teto da recusa que vai para a tela. A maior `message` da API hoje (espaço
/// com terminal facial ligado) tem ~260 caracteres; acima disso é despejo de
/// erro, não explicação.
const int _kMaxMensagemApi = 400;

/// Rótulos HTTP em inglês que o NestJS põe em `message` quando a exceção não
/// traz texto próprio — não explicam nada ao usuário.
const Set<String> _kRotulosHttp = {
  'bad request',
  'unauthorized',
  'forbidden',
  'forbidden resource',
  'not found',
  'conflict',
  'internal server error',
  'too many requests',
  'service unavailable',
  'bad gateway',
  'payload too large',
  'gateway timeout',
  'request timeout',
  'unprocessable entity',
};

final RegExp _kTextoTecnico = RegExp(
  r'(\n\s*at\s)' // stack trace
  r'|(^\s*[\[{])' // JSON cru
  r'|(<\/?[a-zA-Z!][^>]*>)' // HTML
  r'|(prisma)'
  r'|((Type|Range|Reference|Syntax)Error)'
  r'|(Exception)'
  r'|(Cannot read prop)'
  r'|(super constructor)'
  r'|(ECONN|ETIMEDOUT)'
  r'|(^Cannot (GET|POST|PUT|PATCH|DELETE) )', // rota inexistente no Nest
  caseSensitive: false,
);

/// A `message` da API quando ela serve para a tela: texto (ou lista de
/// textos do ValidationPipe) curto e sem cara de erro técnico. Devolve null
/// quando não há mensagem, o corpo não é JSON (HTML de proxy) ou o texto é
/// stack, JSON, HTML, Prisma ou rótulo HTTP em inglês — aí quem chama usa o
/// texto genérico que já tinha.
String? mensagemCurtaDaApi(String body) {
  dynamic parsed;
  try {
    parsed = jsonDecode(body);
  } catch (_) {
    return null;
  }
  if (parsed is! Map) return null;
  final message = parsed['message'];
  String texto;
  if (message is String) {
    texto = message.trim();
  } else if (message is List) {
    texto = message
        .whereType<String>()
        .map((m) => m.trim())
        .where((m) => m.isNotEmpty)
        .join('\n');
  } else {
    return null;
  }
  if (texto.isEmpty || texto.length > _kMaxMensagemApi) return null;
  if (_kRotulosHttp.contains(texto.toLowerCase())) return null;
  if (_kTextoTecnico.hasMatch(texto)) return null;
  return texto;
}

/// Resultado de uma escrita na API: deu certo ou não e, quando a API recusou
/// explicando, a explicação (já filtrada por [mensagemCurtaDaApi]).
///
/// Existe ao lado dos métodos que devolvem só bool: eles continuam iguais para
/// os chamadores antigos, e a tela que quer mostrar a recusa usa o irmão
/// `...Resultado`.
class ResultadoApi {
  final bool ok;

  /// A `message` da API, ou null (sem conexão, sem mensagem, texto técnico).
  final String? mensagem;

  const ResultadoApi.sucesso()
      : ok = true,
        mensagem = null;

  const ResultadoApi.falha([this.mensagem]) : ok = false;

  factory ResultadoApi.daResposta(int statusCode, String body) {
    if (statusCode >= 200 && statusCode < 300) return const ResultadoApi.sucesso();
    return ResultadoApi.falha(mensagemCurtaDaApi(body));
  }

  /// A explicação da API ou, sem ela, o texto genérico da tela.
  String mensagemOu(String fallback) => mensagem ?? fallback;
}

class ApiClient {
  /// Flag para impedir múltiplos handles de 401 simultâneos (vários requests
  /// podem voltar 401 ao mesmo tempo após expiração — quero logout uma vez só).
  static bool _handlingExpiration = false;

  /// Cliente HTTP de todos os verbos. Existe como campo para poder ser
  /// trocado por um MockClient no teste — em produção é o cliente padrão.
  static http.Client client = http.Client();

  /// Teto de espera de TODA chamada.
  ///
  /// O package `http` não tem timeout padrão: numa rede que aceita a conexão e
  /// não responde, o Future nunca completa e a tela fica girando para sempre.
  /// Ficava a cargo de cada call site aplicar `.timeout(...)` — e controllers
  /// inteiros esqueceram (financeiro, encomendas, consentimento, login de
  /// funcionário). Aqui dentro, ninguém pode esquecer.
  static Duration timeout = ApiConfig.timeout;

  /// De onde sai o token da sessão. Campo para poder ser trocado no teste.
  static String Function() tokenProvider = getToken;

  /// Devolve cliente, timeout e token ao padrão de produção (usado no tearDown).
  static void restaurarPadroes() {
    client = http.Client();
    timeout = ApiConfig.timeout;
    tokenProvider = getToken;
  }

  /// Completa os headers do call site com o que toda chamada precisa.
  ///
  /// O `Authorization` era montado à mão em ~50 lugares (quatro cópias de um
  /// `_authHeaders()` idêntico, mais mapas inline): trocar o esquema de auth
  /// exigiria editar todos, e rota nova podia esquecer. O header do call site
  /// continua tendo precedência — quem precisa de algo específico, manda.
  static Map<String, String> _headers(Map<String, String>? doCallSite, {bool comCorpo = false}) {
    final headers = <String, String>{};

    final token = tokenProvider();
    // Sem sessão (login, cadastro) não se manda o header: `Authorization: ""`
    // é pior que a ausência dele, porque um guard pode lê-lo como inválido.
    if (token.isNotEmpty) headers['Authorization'] = token;

    if (comCorpo) headers['Content-Type'] = 'application/json';

    if (doCallSite != null) headers.addAll(doCallSite);
    return headers;
  }

  /// Define se [_checkAuth] deve agir em 401 desta chamada.
  ///
  /// Use `skip401Handling: true` em endpoints de LOGIN — onde 401 significa
  /// "senha errada" e não "token expirado". Sem isso, o usuário errando a
  /// senha veria a snackbar de "sessão expirou" mesmo nunca tendo logado.
  static Future<http.Response> get(
    Uri url, {
    Map<String, String>? headers,
    bool skip401Handling = false,
  }) async {
    final enviados = _headers(headers);
    final res = await client.get(url, headers: enviados).timeout(timeout);
    if (!skip401Handling) _checkAuth(res, enviados['Authorization']);
    return res;
  }

  static Future<http.Response> post(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
    Encoding? encoding,
    bool skip401Handling = false,
  }) async {
    final enviados = _headers(headers, comCorpo: body != null);
    final res = await client
        .post(url, headers: enviados, body: body, encoding: encoding)
        .timeout(timeout);
    if (!skip401Handling) _checkAuth(res, enviados['Authorization']);
    return res;
  }

  static Future<http.Response> put(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
    Encoding? encoding,
    bool skip401Handling = false,
  }) async {
    final enviados = _headers(headers, comCorpo: body != null);
    final res = await client
        .put(url, headers: enviados, body: body, encoding: encoding)
        .timeout(timeout);
    if (!skip401Handling) _checkAuth(res, enviados['Authorization']);
    return res;
  }

  static Future<http.Response> patch(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
    Encoding? encoding,
    bool skip401Handling = false,
  }) async {
    final enviados = _headers(headers, comCorpo: body != null);
    final res = await client
        .patch(url, headers: enviados, body: body, encoding: encoding)
        .timeout(timeout);
    if (!skip401Handling) _checkAuth(res, enviados['Authorization']);
    return res;
  }

  static Future<http.Response> delete(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
    Encoding? encoding,
    bool skip401Handling = false,
  }) async {
    final enviados = _headers(headers, comCorpo: body != null);
    final res = await client
        .delete(url, headers: enviados, body: body, encoding: encoding)
        .timeout(timeout);
    if (!skip401Handling) _checkAuth(res, enviados['Authorization']);
    return res;
  }

  /// Quando um endpoint protegido devolve 401, considera token expirado.
  /// Limpa storage e força navegação pra rota raiz (que vai exibir o login).
  ///
  /// Defensivo: todo o handler está dentro de try/catch porque dart2js
  /// (Flutter Web) tem comportamento errático com WidgetsBinding/Navigator
  /// quando chamado durante uma operação síncrona — se algo aqui jogar,
  /// queremos que o request original prossiga e mostre o erro normal,
  /// não que vire um TypeError JS confuso na tela ("super constructor...").
  ///
  /// Só encerra a sessão que recebeu o 401. Resposta de um request feito com
  /// outro token e que chega depois de um login novo não diz nada sobre a sessão
  /// atual, e tratá-la apagaria o token recém-recebido. Sem token no request o
  /// 401 também não prova nada: é falta de credencial, não credencial vencida.
  static void _checkAuth(http.Response res, String? tokenEnviado) {
    if (res.statusCode != 401) return;
    final enviado = tokenEnviado ?? '';
    final sessaoAtual = enviado.isNotEmpty && enviado == tokenProvider();
    logDebug('[ApiClient] status 401 em ${res.request?.url.path}: '
        'Authorization ${enviado.isEmpty ? "ausente" : "enviado"}, '
        '${sessaoAtual ? "sessão atual" : "ignorado, não é a sessão atual"}');
    if (!sessaoAtual) return;
    if (_handlingExpiration) return;
    _handlingExpiration = true;

    try {
      storageLogout();
    } catch (_) {}

    try {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        try {
          final navState = NavigationService.navigatorKey.currentState;
          if (navState == null) {
            _handlingExpiration = false;
            return;
          }

          final ctx = navState.context;
          ScaffoldMessenger.maybeOf(ctx)?.showSnackBar(
            const SnackBar(
              content: Text('Sua sessão expirou. Faça login novamente.'),
              duration: Duration(seconds: 4),
            ),
          );

          navState.pushNamedAndRemoveUntil('/', (_) => false);
        } catch (_) {
          // Engole — pior caso usuário vê o erro do request original.
        } finally {
          Future.delayed(const Duration(seconds: 2), () {
            _handlingExpiration = false;
          });
        }
      });
      // O callback acima só roda se houver frame, e o app pode estar parado.
      WidgetsBinding.instance.ensureVisualUpdate();
    } catch (_) {
      // WidgetsBinding pode falhar se chamado fora do contexto Flutter.
      _handlingExpiration = false;
    }
  }
}
