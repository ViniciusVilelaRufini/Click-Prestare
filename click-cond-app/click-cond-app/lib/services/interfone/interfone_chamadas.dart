import 'dart:async';

import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/log.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';

/// Chamada do interfone ainda tocando no aparelho deve sumir?
///
/// Só segue tocando enquanto a API diz `chamando`. Atendida por outro aparelho
/// (ou pela portaria), transferida para a portaria ou encerrada: fecha. Atendida
/// por mim não fecha (é a chamada em que estou).
bool deveFecharTela(EstadoChamada e) {
  if (e.estado == 'chamando') return false;
  if (e.estado == 'atendida') return !e.atendidaPorMim;
  return true;
}

const String _prefixoUuid = '00000000-0000-4000-8000-';

/// UUID da tela de ligação, derivado do id da chamada. O AppDelegate do iPhone
/// monta o mesmo (`uuidDaChamada` em AppDelegate.swift): o push VoIP e o Dart
/// falam da mesma ligação no CallKit.
String uuidDaChamada(int id) => '$_prefixoUuid${(id < 0 ? 0 : id).toRadixString(16).padLeft(12, '0')}';

int? idDaChamadaPeloUuid(String uuid) {
  final u = uuid.toLowerCase();
  if (!u.startsWith(_prefixoUuid)) return null;
  return int.tryParse(u.substring(_prefixoUuid.length), radix: 16);
}

/// Id da chamada de um evento do CallKit: o `extra.id` do push, senão o UUID.
int? idDaChamadaDoParams(CallKitParams p) {
  final extra = p.extra?['id'];
  final doExtra = int.tryParse('${extra ?? ''}');
  if (doExtra != null && doExtra > 0) return doExtra;
  return idDaChamadaPeloUuid(p.id);
}

/// Tela de ligação nativa a partir do push `interfone_chamada`. Null sem id.
CallKitParams? parametrosDaChamada(Map<String, dynamic> data) {
  final id = int.tryParse('${data['id'] ?? ''}');
  if (id == null || id <= 0) return null;
  String texto(String chave) => '${data[chave] ?? ''}'.trim();
  final portao = texto('portao');
  final unidade = texto('unidade');
  return CallKitParams(
    id: uuidDaChamada(id),
    nameCaller: portao.isEmpty ? 'Interfone' : portao,
    appName: 'Prestare',
    handle: unidade,
    // 0 = voz: o vídeo do facial é só de recebimento e o app nunca liga a
    // câmera (e o serviço do Android não pede o tipo "camera").
    type: 0,
    duration: 60000,
    // A chamada perdida chega pelo push comum do servidor.
    missedCallNotification: const NotificationParams(showNotification: false),
    extra: {
      'id': '$id',
      'tipo': texto('tipo'),
      'unidade': unidade,
      'portao': portao,
      'condominio': texto('condominio'),
    },
    android: const AndroidParams(
      isCustomNotification: true,
      isShowLogo: false,
      isShowCallID: true,
      isShowFullLockedScreen: true,
      ringtonePath: 'system_ringtone_default',
      // Prestare Dark: bg-100 e tinta branca (AppColors.darkBg100 / darkTextPrimary).
      backgroundColor: '#0B0B0B',
      textColor: '#FFFFFF',
      incomingCallNotificationChannelName: 'Chamadas do portão',
      missedCallNotificationChannelName: 'Chamadas perdidas do portão',
      textAccept: 'Atender',
      textDecline: 'Recusar',
    ),
    ios: const IOSParams(
      handleType: 'generic',
      // Fora dos Recentes do app Telefone e com a unidade legível (o plugin
      // cifra o handle quando normalHandle é 0).
      includesCallsInRecents: false,
      normalHandle: 1,
      supportsVideo: false,
      maximumCallGroups: 1,
      maximumCallsPerCallGroup: 1,
      supportsDTMF: false,
      supportsHolding: false,
      supportsGrouping: false,
      supportsUngrouping: false,
      ringtonePath: 'system_ringtone_default',
    ),
  );
}

/// Chamadas do interfone que entram no aparelho: mostra a tela de ligação
/// nativa (CallKit no iPhone, tela cheia no Android), vigia o estado na API
/// enquanto toca e reage a Atender/Recusar.
///
/// Roda também no isolate de segundo plano do FCM (Android com o app fechado):
/// lá não há navegação; o Atender é tratado quando o app abre ([iniciar]
/// procura a chamada aceita).
class InterfoneChamadas {
  InterfoneChamadas._();

  static Future<void> Function(CallKitParams p) _mostrar = FlutterCallkitIncoming.showCallkitIncoming;
  static Future<void> Function(String uuid) _encerrar = FlutterCallkitIncoming.endCall;
  static Future<EstadoChamada?> Function(int id) _consultar = InterfoneApi.estado;
  static Future<bool> Function(int id) _recusar = InterfoneApi.recusar;
  static Duration _intervalo = const Duration(seconds: 2);

  /// Abre a tela da chamada (Atender). Definido pelo app em [iniciar]; no
  /// isolate de segundo plano fica sem tela.
  static Future<void> Function(int id, Map<String, dynamic> extra)? _abrirTela;

  /// Teto da vigia: a tela nativa some sozinha em 60 s.
  static const Duration _vigiaMaxima = Duration(seconds: 70);

  static final Map<int, Timer> _vigias = {};
  static final Set<int> _fechadasPeloApp = {};
  static final Set<int> _telasAbertas = {};
  static final Map<int, Map<String, dynamic>> _extras = {};
  static StreamSubscription<CallEvent?>? _escuta;

  /// Liga a escuta dos eventos no app principal e retoma o que ficou do
  /// aparelho acordado por push: chamada já aceita (Android com o app fechado)
  /// abre a tela; chamada tocando (iPhone acordado pelo VoIP) passa a ser vigiada.
  static Future<void> iniciar({
    required Future<void> Function(int id, Map<String, dynamic> extra) abrirTela,
    Future<void> Function()? aoMudarTokenVoip,
  }) async {
    if (kIsWeb) return;
    _abrirTela = abrirTela;
    _aoMudarTokenVoip = aoMudarTokenVoip;
    _garantirEscuta();
    try {
      final ativas = await FlutterCallkitIncoming.activeCalls();
      for (final p in ativas) {
        final id = idDaChamadaDoParams(p);
        if (id == null) continue;
        if (p.isAccepted) {
          await _abrir(id, p.extra);
        } else {
          _vigiar(id);
        }
      }
    } catch (e) {
      logDebug('[Interfone] chamadas ativas: ${e.runtimeType}');
    }
  }

  static Future<void> Function()? _aoMudarTokenVoip;

  /// Toque no aviso comum `interfone_chamada` (iPhone sem token VoIP): abre a
  /// tela da chamada se ela ainda estiver tocando (`chamando`). Nunca lança.
  static Future<void> abrirPeloAviso(Map<String, dynamic> data) async {
    final id = int.tryParse('${data['id'] ?? ''}');
    if (id == null || id <= 0) return;
    try {
      // A tela desta chamada acabou de ser encerrada aqui: a API pode demorar
      // a refletir o fim, e o toque no aviso não deve reabri-la.
      if (_encerradaRecentemente(id)) return;
      await _garantirSessao();
      final e = await _consultar(id);
      if (e?.estado != 'chamando') return;
      await _abrir(id, Map<String, dynamic>.from(data));
    } catch (e) {
      logDebug('[Interfone] aviso: ${e.runtimeType}');
    }
  }

  /// Push `interfone_chamada`: mostra a tela de ligação. Nunca lança.
  static Future<void> mostrarEntrando(Map<String, dynamic> data) async {
    final params = parametrosDaChamada(data);
    if (params == null) return;
    final id = idDaChamadaDoParams(params)!;
    _extras[id] = params.extra ?? const {};
    _garantirEscuta();
    _fechadasPeloApp.remove(id);
    try {
      await _mostrar(params);
    } catch (e) {
      logDebug('[Interfone] mostrar chamada: ${e.runtimeType}');
      return;
    }
    _vigiar(id);
  }

  /// Push `interfone_fim` (ou estado final na vigia): fecha a tela de ligação
  /// sem avisar a API. Nunca lança.
  static Future<void> encerrarTela(int id) async {
    _pararVigia(id);
    _fechadasPeloApp.add(id);
    try {
      await _encerrar(uuidDaChamada(id));
    } catch (e) {
      logDebug('[Interfone] encerrar tela: ${e.runtimeType}');
    }
  }

  /// A tela da chamada aberta para [id] quer saber quando a ligação acaba no
  /// sistema (Encerrar no CallKit da tela bloqueada, na notificação do
  /// Android): aí ela desliga a conversa.
  ///
  /// [aoMudo] recebe o Mudo tocado na tela nativa (CallKit, notificação do
  /// Android): a conversa precisa mudar junto, senão o visitante segue ouvindo.
  static void registrarTela(int id, void Function() aoEncerrarNoSistema, {void Function(bool mudo)? aoMudo}) {
    _telasRegistradas[id] = aoEncerrarNoSistema;
    if (aoMudo != null) {
      _mudoDasTelas[id] = aoMudo;
      // Mudo tocado no CallKit antes de a tela existir (app abrindo).
      final pendente = _mudoPendente.remove(id);
      if (pendente != null) aoMudo(pendente);
    } else {
      _mudoDasTelas.remove(id);
    }
  }

  /// Último Mudo do sistema que chegou antes de a tela registrar.
  static final Map<int, bool> _mudoPendente = {};

  /// A tela da chamada terminou: libera o id para uma próxima abertura.
  static void telaFechada(int id) {
    _encerradasEm[id] = _agora();
    _telasAbertas.remove(id);
    _telasRegistradas.remove(id);
    _mudoDasTelas.remove(id);
    _mudoPendente.remove(id);
  }

  static const _janelaReabrir = Duration(seconds: 30);
  static final Map<int, DateTime> _encerradasEm = {};
  static DateTime Function() _agora = DateTime.now;

  @visibleForTesting
  static set relogioParaTeste(DateTime Function() r) => _agora = r;

  static bool _encerradaRecentemente(int id) {
    final em = _encerradasEm[id];
    if (em == null) return false;
    if (_agora().difference(em) < _janelaReabrir) return true;
    _encerradasEm.remove(id);
    return false;
  }

  static final Map<int, void Function()> _telasRegistradas = {};
  static final Map<int, void Function(bool mudo)> _mudoDasTelas = {};

  static void _avisarTela(int id) {
    final cb = _telasRegistradas.remove(id);
    if (cb != null) cb();
  }

  @visibleForTesting
  static Future<void> tratarEvento(CallEvent? ev) async {
    switch (ev) {
      case CallEventActionCallIncoming(:final callKitParams):
        final id = idDaChamadaDoParams(callKitParams);
        if (id != null) _vigiar(id);
      case CallEventActionCallAccept(:final callKitParams):
        final id = idDaChamadaDoParams(callKitParams);
        if (id == null) return;
        _pararVigia(id);
        await _abrir(id, callKitParams.extra);
      case CallEventActionCallDecline(:final callKitParams):
        final id = idDaChamadaDoParams(callKitParams);
        if (id == null) return;
        _pararVigia(id);
        _avisarTela(id);
        // O iPhone manda DECLINE também quando o próprio app encerra uma
        // chamada que não foi atendida: aí não é recusa do morador.
        if (_fechadasPeloApp.remove(id)) return;
        await _garantirSessao();
        await _recusar(id);
      case CallEventActionCallEnded(:final callKitParams):
        final id = idDaChamadaDoParams(callKitParams);
        if (id != null) {
          _pararVigia(id);
          _fechadasPeloApp.remove(id);
          _mudoPendente.remove(id);
          _avisarTela(id);
        }
      case CallEventActionCallToggleMute(:final id, :final isMuted):
        final idChamada = idDaChamadaPeloUuid(id);
        if (idChamada != null) {
          final tela = _mudoDasTelas[idChamada];
          if (tela != null) {
            tela(isMuted);
          } else {
            _mudoPendente[idChamada] = isMuted;
          }
        }
      case CallEventActionCallTimeout(:final id):
        final idChamada = idDaChamadaPeloUuid(id);
        if (idChamada != null) _pararVigia(idChamada);
      case CallEventActionDidUpdateDevicePushTokenVoip():
        final aviso = _aoMudarTokenVoip;
        if (aviso != null) await aviso();
      default:
        break;
    }
  }

  static Future<void> _abrir(int id, Map<String, dynamic>? extra) async {
    final abrir = _abrirTela;
    if (abrir == null) return;
    if (!_telasAbertas.add(id)) return;
    try {
      // Evento sem extra: usa o que veio no push.
      await abrir(id, (extra == null || extra.isEmpty) ? (_extras[id] ?? const {}) : extra);
    } catch (e) {
      _telasAbertas.remove(id);
      logDebug('[Interfone] abrir tela: ${e.runtimeType}');
    }
  }

  static void _garantirEscuta() {
    if (_escuta != null) return;
    try {
      _escuta = FlutterCallkitIncoming.onEvent.listen(
        (ev) => unawaited(tratarEvento(ev).catchError((Object e) {
          logDebug('[Interfone] evento: ${e.runtimeType}');
        })),
        onError: (Object e) => logDebug('[Interfone] eventos: ${e.runtimeType}'),
      );
    } catch (e) {
      logDebug('[Interfone] sem eventos do CallKit: ${e.runtimeType}');
    }
  }

  /// Consulta a API a cada [_intervalo] enquanto a tela toca e fecha quando a
  /// chamada já não é deste aparelho.
  static void _vigiar(int id) {
    if (_vigias.containsKey(id)) return;
    final inicio = DateTime.now();
    var consultando = false;
    _vigias[id] = Timer.periodic(_intervalo, (t) async {
      if (DateTime.now().difference(inicio) > _vigiaMaxima) {
        _pararVigia(id);
        return;
      }
      if (consultando) return;
      consultando = true;
      try {
        await _garantirSessao();
        final e = await _consultar(id);
        if (_vigias[id] != t) return;
        if (e != null && deveFecharTela(e)) await encerrarTela(id);
      } catch (e) {
        logDebug('[Interfone] vigia: ${e.runtimeType}');
      } finally {
        consultando = false;
      }
    });
  }

  static void _pararVigia(int id) => _vigias.remove(id)?.cancel();

  /// No isolate de segundo plano o cache da sessão começa vazio.
  static Future<void> _garantirSessao() async {
    try {
      await ensureStorageReady().timeout(const Duration(seconds: 5));
    } catch (_) {}
  }

  /// Troca as dependências no teste; sem argumentos, volta ao padrão.
  @visibleForTesting
  static void redefinirParaTeste({
    Future<void> Function(CallKitParams p)? mostrar,
    Future<void> Function(String uuid)? encerrar,
    Future<EstadoChamada?> Function(int id)? consultar,
    Future<bool> Function(int id)? recusar,
    Future<void> Function(int id, Map<String, dynamic> extra)? abrirTela,
    Duration? intervalo,
  }) {
    for (final t in _vigias.values) {
      t.cancel();
    }
    _vigias.clear();
    _fechadasPeloApp.clear();
    _telasAbertas.clear();
    _telasRegistradas.clear();
    _mudoDasTelas.clear();
    _mudoPendente.clear();
    _encerradasEm.clear();
    _agora = DateTime.now;
    _extras.clear();
    _mostrar = mostrar ?? FlutterCallkitIncoming.showCallkitIncoming;
    _encerrar = encerrar ?? FlutterCallkitIncoming.endCall;
    _consultar = consultar ?? InterfoneApi.estado;
    _recusar = recusar ?? InterfoneApi.recusar;
    _abrirTela = abrirTela;
    _intervalo = intervalo ?? const Duration(seconds: 2);
    // No teste não há canal de eventos; marca a escuta como já ligada.
    _escuta ??= const Stream<CallEvent?>.empty().listen(null);
  }
}
