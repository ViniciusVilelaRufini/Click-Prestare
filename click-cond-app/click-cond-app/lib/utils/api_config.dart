import 'package:flutter/foundation.dart';

/// Configuração centralizada da API.
class ApiConfig {
  /// Mude para 'true' para usar o servidor do Railway (Nuvem)
  /// Mude para 'false' para usar o servidor local (Seu PC)
  static const bool isProduction = true;

  /// Host dinâmico
  static String get host {
    if (isProduction) return "click-prestare-production.up.railway.app";
    if (kIsWeb) return "localhost:3003";
    return "192.168.3.74:3003";
  }

  /// HTTPS é obrigatório no Railway (Produção)
  static bool get useHttps => isProduction;

  /// Timeout padrão de requisições HTTP
  static const Duration timeout = Duration(seconds: 30);

  /// Constrói uma Uri completa para o endpoint.
  static Uri buildUri(String path, [Map<String, String>? params]) {
    String cleanPath = path;
    if (isProduction) {
      cleanPath = path.startsWith('/api') ? path : '/api$path';
    } else {
      if (cleanPath.startsWith('/api')) {
        cleanPath = cleanPath.substring(4);
      }
      if (!cleanPath.startsWith('/')) {
        cleanPath = '/$cleanPath';
      }
    }
    return useHttps
        ? Uri.https(host, cleanPath, params)
        : Uri.http(host, cleanPath, params);
  }
}
