import 'package:click/services/biometric_auth_service.dart';

/// Acesso ao armazenamento antigo (`localstorage`, JSON em texto puro).
/// Usado só para migrar e como reserva se o Keystore/Keychain falhar.
class LegadoSessao {
  final dynamic Function(String chave) ler;
  final Future<void> Function(String chave, String valor) gravar;
  final Future<void> Function(String chave) apagar;

  const LegadoSessao({required this.ler, required this.gravar, required this.apagar});
}

/// Segredos da sessão: o token do app (válido por 365 dias) e o token de
/// "dispositivo confiável" do MFA do síndico.
///
/// Ficavam no `localstorage`, que grava um JSON legível nos documentos do app,
/// e o Android incluía esse arquivo no backup do Google. Aqui eles vão para o
/// armazenamento seguro, com um cache em memória para que `getToken()` continue
/// síncrono (é chamado em todo request pelo ApiClient).
class SegredosSessao {
  static const chaves = ['token', 'sindico_device_token'];

  static SecureStorageInterface armazenamento = DefaultSecureStorage();
  static LegadoSessao? legado;

  static final Map<String, String> _cache = {};

  /// Quantas vezes cada chave foi gravada ou apagada. Serve para [carregar]
  /// saber que o que leu do armazenamento já ficou velho.
  static final Map<String, int> _versoes = {};

  /// Carrega os segredos no cache. Chamado no boot (ensureStorageReady), antes
  /// de qualquer request. Migra o que ainda estiver no armazenamento antigo.
  ///
  /// O cache só é tocado no fim, de uma vez. Limpá-lo antes de ler deixava
  /// getToken() vazio durante a leitura: o request dessa janela saía sem
  /// Authorization, tomava 401 e o ApiClient encerrava uma sessão válida.
  static Future<void> carregar() async {
    final versoes = Map.of(_versoes);
    bool mudou(String chave) => _versoes[chave] != versoes[chave];

    final lidos = <String, String>{};
    final semLeitura = <String>{};

    for (final chave in chaves) {
      String? valor;
      var leu = true;
      try {
        valor = await armazenamento.read(key: chave);
      } catch (_) {
        leu = false;
      }

      if (!_valido(valor) && !mudou(chave)) {
        final antigo = legado?.ler(chave)?.toString();
        if (_valido(antigo)) {
          valor = antigo;
          try {
            await armazenamento.write(key: chave, value: antigo);
            await legado?.apagar(chave);
          } catch (_) {
            // Keystore indisponível: o valor continua no legado e a migração
            // é tentada de novo no próximo boot. Melhor que deslogar.
          }
        }
      }

      if (_valido(valor)) {
        lidos[chave] = valor!;
      } else if (!leu) {
        semLeitura.add(chave);
      }
    }

    for (final chave in chaves) {
      // Login ou logout durante a leitura: o que aconteceu depois é que vale.
      if (mudou(chave)) continue;
      // Falha de leitura não é prova de que o segredo não existe.
      if (semLeitura.contains(chave)) continue;
      final valor = lidos[chave];
      if (valor != null) {
        _cache[chave] = valor;
      } else {
        _cache.remove(chave);
      }
    }
  }

  static String ler(String chave) => _cache[chave] ?? '';

  /// Atualiza o cache na hora e persiste no armazenamento seguro.
  /// `null` (ou vazio) apaga.
  static Future<void> gravar(String chave, String? valor) async {
    if (!_valido(valor)) return apagar(chave);
    _versoes[chave] = (_versoes[chave] ?? 0) + 1;
    _cache[chave] = valor!;
    try {
      await armazenamento.write(key: chave, value: valor);
      await legado?.apagar(chave);
    } catch (_) {
      await legado?.gravar(chave, valor);
    }
  }

  static Future<void> apagar(String chave) async {
    _versoes[chave] = (_versoes[chave] ?? 0) + 1;
    _cache.remove(chave);
    try {
      await armazenamento.delete(key: chave);
    } catch (_) {}
    await legado?.apagar(chave);
  }

  static bool _valido(String? v) => v != null && v.trim().isNotEmpty && v != 'null';
}
