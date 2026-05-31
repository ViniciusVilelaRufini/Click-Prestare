import 'dart:convert' show Encoding;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
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
class ApiClient {
  /// Flag para impedir múltiplos handles de 401 simultâneos (vários requests
  /// podem voltar 401 ao mesmo tempo após expiração — quero logout uma vez só).
  static bool _handlingExpiration = false;

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
    final res = await http.get(url, headers: headers);
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
    final res = await http.post(url, headers: headers, body: body, encoding: encoding);
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
    final res = await http.put(url, headers: headers, body: body, encoding: encoding);
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
    final res = await http.delete(url, headers: headers, body: body, encoding: encoding);
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
