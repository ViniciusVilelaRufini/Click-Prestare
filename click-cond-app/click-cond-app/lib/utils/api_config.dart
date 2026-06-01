import 'package:flutter/foundation.dart';

/// Configuração centralizada da API.
class ApiConfig {
  /// Mude para 'true' para usar o servidor do Railway (Nuvem)
  /// Mude para 'false' para usar o servidor local (Seu PC)
  static const bool isProduction = false;

  /// Host dinâmico
  static String get host {
    if (isProduction) return "click-prestare-production.up.railway.app";
    if (kIsWeb) return "localhost:3003";
    // 10.0.2.2 é o endereço especial para acessar o localhost do seu PC de dentro do Emulador Android
    return "10.0.2.2:3003";
  }

  /// HTTPS é obrigatório no Railway (Produção)
  static bool get useHttps => isProduction;

  /// Timeout padrão de requisições HTTP
  static const Duration timeout = Duration(seconds: 30);

  /// Constrói uma Uri completa para o endpoint.
  static Uri buildUri(String path, [Map<String, String>? params]) {
    String cleanPath = path.startsWith('/api') ? path : '/api$path';
    return useHttps
        ? Uri.https(host, cleanPath, params)
        : Uri.http(host, cleanPath, params);
  }
}
