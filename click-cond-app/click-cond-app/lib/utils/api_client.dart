import 'dart:convert' show Encoding, jsonDecode;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:click/utils/api_config.dart';
import 'package:click/utils/local_storage.dart';
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
    final res = await client.get(url, headers: _headers(headers)).timeout(timeout);
    if (!skip401Handling) _checkAuth(res);
    return res;
  }

  static Future<http.Response> post(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
    Encoding? encoding,
    bool skip401Handling = false,
  }) async {
    final res = await client
        .post(url, headers: _headers(headers, comCorpo: body != null), body: body, encoding: encoding)
        .timeout(timeout);
    if (!skip401Handling) _checkAuth(res);
    return res;
  }

  static Future<http.Response> put(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
    Encoding? encoding,
    bool skip401Handling = false,
  }) async {
    final res = await client
        .put(url, headers: _headers(headers, comCorpo: body != null), body: body, encoding: encoding)
        .timeout(timeout);
    if (!skip401Handling) _checkAuth(res);
    return res;
  }

  static Future<http.Response> delete(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
    Encoding? encoding,
    bool skip401Handling = false,
  }) async {
    final res = await client
        .delete(url, headers: _headers(headers, comCorpo: body != null), body: body, encoding: encoding)
        .timeout(timeout);
    if (!skip401Handling) _checkAuth(res);
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
  static void _checkAuth(http.Response res) {
    if (res.statusCode != 401) return;
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
    } catch (_) {
      // WidgetsBinding pode falhar se chamado fora do contexto Flutter.
      _handlingExpiration = false;
    }
  }
}
