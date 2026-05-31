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
  static void _checkAuth(http.Response res) {
    if (res.statusCode != 401) return;
    if (_handlingExpiration) return; // outro request já está cuidando
    _handlingExpiration = true;

    // Limpa token + dados de usuário do storage local.
    storageLogout();

    // Aguarda o frame atual terminar antes de navegar — evita "setState
    // during build" se o 401 acontecer durante construção de tela.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final navState = NavigationService.navigatorKey.currentState;
      if (navState == null) {
        _handlingExpiration = false;
        return;
      }

      // Avisa usuário (snackbar não bloqueante).
      final ctx = navState.context;
      ScaffoldMessenger.maybeOf(ctx)?.showSnackBar(
        const SnackBar(
          content: Text('Sua sessão expirou. Faça login novamente.'),
          duration: Duration(seconds: 4),
        ),
      );

      // Volta para a raiz limpando toda a pilha.
      navState.pushNamedAndRemoveUntil('/', (_) => false);

      // Reseta após um pequeno delay para permitir novos handles de 401
      // em sessões futuras (sem isso, o segundo logout do app não funcionaria).
      Future.delayed(const Duration(seconds: 2), () {
        _handlingExpiration = false;
      });
    });
  }
}
