import 'dart:convert';

import 'package:click/utils/api_client.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/log.dart';

/// Um servidor ICE (STUN/TURN) como a API manda: `urls` pode vir em lista ou
/// texto solto (as duas formas valem no WebRTC).
class ServidorIce {
  final List<String> urls;
  final String? username;
  final String? credential;

  const ServidorIce({required this.urls, this.username, this.credential});

  factory ServidorIce.fromJson(Map<String, dynamic> j) {
    final bruto = j['urls'];
    final urls = bruto is List
        ? bruto.map((u) => '$u').where((u) => u.isNotEmpty).toList()
        : (bruto == null || '$bruto'.isEmpty ? <String>[] : ['$bruto']);
    return ServidorIce(
      urls: urls,
      username: j['username']?.toString(),
      credential: j['credential']?.toString(),
    );
  }
}

/// Resposta de todo "atender"/"ligar": com ela o app entra na chamada pela
/// central de voz (SIP sobre WSS), sem ficar registrado.
class DadosEntrada {
  final int id;
  final String token;
  final String wss;
  final String sipUri;
  final List<ServidorIce> ice;

  const DadosEntrada({
    required this.id,
    required this.token,
    required this.wss,
    required this.sipUri,
    required this.ice,
  });

  factory DadosEntrada.fromJson(Map<String, dynamic> j) => DadosEntrada(
        id: _int(j['id']) ?? 0,
        token: '${j['token'] ?? ''}',
        wss: '${j['wss'] ?? ''}',
        sipUri: '${j['sip_uri'] ?? ''}',
        ice: (j['ice'] is List ? j['ice'] as List : const [])
            .whereType<Map>()
            .map((m) => ServidorIce.fromJson(Map<String, dynamic>.from(m)))
            .toList(),
      );
}

/// Estado de uma chamada visto pelo morador.
class EstadoChamada {
  final int id;

  /// `facial_unidade`, `portaria_unidade` ou `unidade_portaria`.
  final String tipo;

  /// `chamando`, `portaria`, `atendida` ou `encerrada`.
  final String estado;
  final String? resultado;
  final String unidade;
  final String portao;
  final String? fotoUrl;
  final bool atendidaPorMim;

  const EstadoChamada({
    required this.id,
    required this.tipo,
    required this.estado,
    this.resultado,
    required this.unidade,
    required this.portao,
    this.fotoUrl,
    this.atendidaPorMim = false,
  });

  /// Chamada que veio do facial do portão: só nela existe "Abrir portão".
  bool get ehDoFacial => tipo == 'facial_unidade';

  factory EstadoChamada.fromJson(Map<String, dynamic> j) => EstadoChamada(
        id: _int(j['id']) ?? 0,
        tipo: '${j['tipo'] ?? ''}',
        estado: '${j['estado'] ?? ''}',
        resultado: j['resultado']?.toString(),
        unidade: '${j['unidade'] ?? ''}',
        portao: '${j['portao'] ?? ''}',
        fotoUrl: _textoOuNull(j['foto_url']),
        atendidaPorMim: j['atendida_por_mim'] == true,
      );
}

/// Uma linha do histórico do interfone da unidade.
class ItemHistoricoInterfone {
  final int id;
  final String tipo;
  final DateTime? inicio;
  final String? resultado;
  final String? atendidaPorNome;
  final String? fotoUrl;
  final bool portaAberta;

  const ItemHistoricoInterfone({
    required this.id,
    required this.tipo,
    this.inicio,
    this.resultado,
    this.atendidaPorNome,
    this.fotoUrl,
    this.portaAberta = false,
  });

  factory ItemHistoricoInterfone.fromJson(Map<String, dynamic> j) => ItemHistoricoInterfone(
        id: _int(j['id']) ?? 0,
        tipo: '${j['tipo'] ?? ''}',
        inicio: DateTime.tryParse('${j['inicio'] ?? ''}'),
        resultado: j['resultado']?.toString(),
        atendidaPorNome: _textoOuNull(j['atendida_por_nome']),
        fotoUrl: _textoOuNull(j['foto_url']),
        portaAberta: j['porta_aberta'] == true,
      );
}

/// Resultado de "atender"/"ligar": os dados de entrada ou, na recusa (409),
/// o motivo da API (`ja_atendida`, `encerrada`, `portaria_indisponivel`).
typedef ResultadoEntrada = ({DadosEntrada? dados, String? motivo});

/// Rotas do interfone pelo app (morador). Nunca lança: sem rede ou com erro,
/// devolve null/false e quem chama mostra a mensagem dele.
class InterfoneApi {
  InterfoneApi._();

  /// O módulo está ligado para este morador (condomínio contratou e ativou).
  static Future<bool> disponivel() async {
    final j = await _getJson('/interfone/disponivel');
    return j is Map && j['ativo'] == true;
  }

  static Future<EstadoChamada?> estado(int id) async {
    final j = await _getJson('/interfone/chamadas/$id');
    if (j is! Map) return null;
    return EstadoChamada.fromJson(Map<String, dynamic>.from(j));
  }

  /// Pede para entrar na chamada. Null quando outro aparelho já atendeu, a
  /// chamada acabou ou deu erro.
  static Future<DadosEntrada?> atender(int id) async => (await atenderComMotivo(id)).dados;

  static Future<ResultadoEntrada> atenderComMotivo(int id) =>
      _entrada('/interfone/chamadas/$id/atender', null);

  static Future<bool> recusar(int id) async {
    try {
      final r = await ApiClient.post(ApiConfig.buildUri('/interfone/chamadas/$id/recusar'));
      return r.statusCode >= 200 && r.statusCode < 300;
    } catch (e) {
      logDebug('[Interfone] recusar: ${e.runtimeType}');
      return false;
    }
  }

  static Future<({bool ok, String? motivo})> abrir(int id) async {
    try {
      final r = await ApiClient.post(ApiConfig.buildUri('/interfone/chamadas/$id/abrir'));
      final j = _decodificar(r.body);
      if (r.statusCode >= 200 && r.statusCode < 300 && j is Map) {
        final ok = j['ok'] == true;
        return (ok: ok, motivo: ok ? null : _textoOuNull(j['motivo']));
      }
      return (ok: false, motivo: _motivo(j) ?? mensagemCurtaDaApi(r.body));
    } catch (e) {
      logDebug('[Interfone] abrir: ${e.runtimeType}');
      return (ok: false, motivo: 'sem conexão');
    }
  }

  static Future<DadosEntrada?> ligarPortaria(int idApartamento) async =>
      (await ligarPortariaComMotivo(idApartamento)).dados;

  static Future<ResultadoEntrada> ligarPortariaComMotivo(int idApartamento) =>
      _entrada('/interfone/ligar-portaria', {'id_apartamento': idApartamento});

  /// Últimas chamadas da unidade (30 dias, 50 itens). Null em erro.
  static Future<List<ItemHistoricoInterfone>?> historico(int idApartamento) async {
    final j = await _getJson('/interfone/historico', {'id_apartamento': '$idApartamento'});
    if (j is! List) return null;
    return j
        .whereType<Map>()
        .map((m) => ItemHistoricoInterfone.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  /// "Receber chamadas do portão". Null quando não deu para ler.
  static Future<bool?> preferencia() async {
    final j = await _getJson('/interfone/preferencia');
    if (j is! Map || j['receber'] is! bool) return null;
    return j['receber'] as bool;
  }

  static Future<bool> definirPreferencia(bool receber) async {
    try {
      final r = await ApiClient.put(
        ApiConfig.buildUri('/interfone/preferencia'),
        body: jsonEncode({'receber': receber}),
      );
      return r.statusCode >= 200 && r.statusCode < 300;
    } catch (e) {
      logDebug('[Interfone] preferencia: ${e.runtimeType}');
      return false;
    }
  }

  static Future<ResultadoEntrada> _entrada(String caminho, Map<String, dynamic>? corpo) async {
    try {
      final r = await ApiClient.post(
        ApiConfig.buildUri(caminho),
        body: corpo == null ? null : jsonEncode(corpo),
      );
      final j = _decodificar(r.body);
      if (r.statusCode >= 200 && r.statusCode < 300 && j is Map) {
        return (dados: DadosEntrada.fromJson(Map<String, dynamic>.from(j)), motivo: null);
      }
      return (dados: null, motivo: _motivo(j) ?? (r.statusCode == 409 ? 'ja_atendida' : null));
    } catch (e) {
      logDebug('[Interfone] $caminho: ${e.runtimeType}');
      return (dados: null, motivo: null);
    }
  }

  static Future<Object?> _getJson(String caminho, [Map<String, String>? params]) async {
    try {
      final r = await ApiClient.get(ApiConfig.buildUri(caminho, params));
      if (r.statusCode < 200 || r.statusCode >= 300) return null;
      return _decodificar(r.body);
    } catch (e) {
      logDebug('[Interfone] $caminho: ${e.runtimeType}');
      return null;
    }
  }
}

Object? _decodificar(String body) {
  try {
    return jsonDecode(body);
  } catch (_) {
    return null;
  }
}

/// `motivo` no corpo do 409. O Nest põe o objeto da exceção em `message`
/// quando ela é lançada com objeto; aceita as duas formas.
String? _motivo(Object? j) {
  if (j is! Map) return null;
  final direto = _textoOuNull(j['motivo']);
  if (direto != null) return direto;
  final m = j['message'];
  if (m is Map) return _textoOuNull(m['motivo']);
  return null;
}

int? _int(Object? v) => v is int ? v : int.tryParse('${v ?? ''}');

String? _textoOuNull(Object? v) {
  if (v == null) return null;
  final t = '$v'.trim();
  return t.isEmpty ? null : t;
}
