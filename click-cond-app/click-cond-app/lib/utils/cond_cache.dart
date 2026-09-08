import 'package:click/utils/local_storage.dart';
import 'package:flutter/widgets.dart';

/// Último payload bom da tela do condomínio, por condomínio.
///
/// A tela pinta na hora com o que já foi carregado e revalida em segundo plano.
/// Persistido em storage local para carregamento instantâneo no primeiro frame.
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

  Map<String, dynamic> toJson() {
    return {
      'cond': cond,
      'summary': summary,
      'saldo': saldo,
      'ocorrenciasAbertas': ocorrenciasAbertas,
      'temp': temp,
      'weatherDesc': weatherDesc,
    };
  }

  factory CondCacheEntry.fromJson(Map<String, dynamic> json) {
    return CondCacheEntry(
      cond: json['cond'] is Map ? Map<String, dynamic>.from(json['cond']) : {},
      summary: json['summary'] is Map ? Map<String, dynamic>.from(json['summary']) : null,
      saldo: json['saldo']?.toString() ?? '',
      ocorrenciasAbertas: json['ocorrenciasAbertas'] is int ? json['ocorrenciasAbertas'] : 0,
      temp: json['temp'] is num ? (json['temp'] as num).toDouble() : null,
      weatherDesc: json['weatherDesc']?.toString(),
    );
  }
}

class CondCache {
  CondCache._();

  static final Map<int, CondCacheEntry> _entries = {};

  static CondCacheEntry? get(int id) {
    if (_entries.containsKey(id)) {
      return _entries[id];
    }
    final persistent = getCondCachePersistent(id);
    if (persistent != null) {
      try {
        final entry = CondCacheEntry.fromJson(persistent);
        _entries[id] = entry;
        return entry;
      } catch (_) {}
    }
    return null;
  }

  static void put(int id, CondCacheEntry entry) {
    _entries[id] = entry;
    saveCondCachePersistent(id, entry.toJson());
  }

  /// Só o clima mudou: preserva o resto da entrada já cacheada.
  static void putWeather(int id, double? temp, String? desc, IconData? icon) {
    final current = _entries[id];
    if (current == null) return;
    final updated = current.withWeather(temp, desc, icon);
    _entries[id] = updated;
    saveCondCachePersistent(id, updated.toJson());
  }

  static void clear() {
    _entries.clear();
  }
}
