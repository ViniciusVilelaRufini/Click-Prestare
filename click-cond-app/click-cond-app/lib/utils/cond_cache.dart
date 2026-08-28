import 'package:flutter/widgets.dart';

/// Último payload bom da tela do condomínio, por condomínio.
///
/// A tela é recriada do zero a cada `Navigator.push` vindo da lista de
/// condomínios, então o stale-while-revalidate interno dela não ajuda ao
/// voltar: o estado nasce vazio e tudo volta ao esqueleto. Guardando aqui, a
/// tela pinta na hora com o que já foi carregado e revalida em segundo plano.
///
/// Vive só na memória do processo — é dado de exibição, não fonte de verdade.
/// Limpo no logout ([storageLogout]) para o próximo login não ver número alheio.
class CondCacheEntry {
  final Map<String, dynamic> cond;
  final Map<String, dynamic>? summary;
  final String saldo;
  final int ocorrenciasAbertas;
  final double? temp;
  final String? weatherDesc;
  final IconData? weatherIcon;

  const CondCacheEntry({
    required this.cond,
    required this.summary,
    required this.saldo,
    required this.ocorrenciasAbertas,
    this.temp,
    this.weatherDesc,
    this.weatherIcon,
  });

  CondCacheEntry withWeather(double? temp, String? desc, IconData? icon) {
    return CondCacheEntry(
      cond: cond,
      summary: summary,
      saldo: saldo,
      ocorrenciasAbertas: ocorrenciasAbertas,
      temp: temp,
      weatherDesc: desc,
      weatherIcon: icon,
    );
  }
}

class CondCache {
  CondCache._();

  static final Map<int, CondCacheEntry> _entries = {};

  static CondCacheEntry? get(int id) => _entries[id];

  static void put(int id, CondCacheEntry entry) => _entries[id] = entry;

  /// Só o clima mudou: preserva o resto da entrada já cacheada.
  static void putWeather(int id, double? temp, String? desc, IconData? icon) {
    final current = _entries[id];
    if (current == null) return;
    _entries[id] = current.withWeather(temp, desc, icon);
  }

  static void clear() => _entries.clear();
}
