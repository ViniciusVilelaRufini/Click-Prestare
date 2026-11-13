import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/services/card_ao_vivo/textos_card.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/log.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:path_provider/path_provider.dart';

/// Card ao vivo da portaria remota no Android: uma notificação fixa por
/// pedido, montada pelo app a partir do push de dados `type: card_portaria`
/// e atualizada a cada fase (mesmo id = `id_cartao`).
///
/// NEGAR roda em segundo plano, sem abrir o app. AUTORIZAR abre o app — com a
/// tela de bloqueio segura, o Android pede o desbloqueio antes — e o app
/// autoriza ao abrir (decisão do usuário: AUTORIZAR exige desbloqueio).
class CardAndroid {
  CardAndroid._();

  static const canalId = 'card_portaria';
  static const acaoNegar = 'negar';
  static const acaoAutorizar = 'autorizar';

  static final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  static Future<void>? _iniciando;

  /// Chamado pela UI quando o morador toca em AUTORIZAR (app aberto/abrindo).
  static void Function(int idPedido)? aoAutorizarPelaNotificacao;

  /// Chamado pela UI quando o morador toca no corpo da notificação.
  static VoidCallback? aoTocarNoCard;

  static bool get _suportado => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  static Future<void> iniciar() {
    if (!_suportado) return Future.value();
    return _iniciando ??= _iniciar().catchError((Object e) {
      // Plugin indisponível (teste, motor sem plugins): tenta de novo na
      // próxima chamada em vez de guardar a falha para sempre.
      _iniciando = null;
      throw e;
    });
  }

  static Future<void> _iniciar() async {
    await _plugin.initialize(
      // Ícone monocromático da barra de status (o ic_launcher colorido vira um
      // quadrado branco).
      settings: const InitializationSettings(android: AndroidInitializationSettings('@drawable/ic_stat_card')),
      onDidReceiveNotificationResponse: _respostaEmPrimeiroPlano,
      onDidReceiveBackgroundNotificationResponse: respostaCardSegundoPlano,
    );
    await _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(const AndroidNotificationChannel(
          canalId,
          'Portaria remota',
          description: 'Pedidos de autorização de visitante, com resposta na própria notificação',
          importance: Importance.max,
        ));
  }

  /// Logout: nenhum card fica na tela de quem saiu.
  static Future<void> limpar() async {
    // Só se o plugin já subiu (no app, na abertura): o Sair não inicializa
    // nada nativo.
    if (!_suportado || _iniciando == null) return;
    try {
      await _iniciando;
      await _plugin.cancelAll();
    } catch (_) {}
  }

  /// App aberto pela notificação (AUTORIZAR ou toque no corpo) depois de fechado.
  static Future<void> tratarAbertura() async {
    if (!_suportado) return;
    final NotificationAppLaunchDetails? detalhes;
    try {
      await iniciar();
      detalhes = await _plugin.getNotificationAppLaunchDetails();
    } catch (e) {
      logDebug('Card ao vivo: abertura pela notificação não lida: $e');
      return;
    }
    final r = detalhes?.notificationResponse;
    if (detalhes?.didNotificationLaunchApp == true && r != null) _respostaEmPrimeiroPlano(r);
  }

  static void _respostaEmPrimeiroPlano(NotificationResponse r) {
    final dados = _lerPayload(r.payload);
    if (dados == null) return;
    if (r.actionId == acaoNegar) {
      respostaCardSegundoPlano(r);
    } else if (r.actionId == acaoAutorizar) {
      aoAutorizarPelaNotificacao?.call(dados.idPedido);
    } else {
      aoTocarNoCard?.call();
    }
  }

  /// Exibe, atualiza ou remove o card a partir do push de dados.
  static Future<void> exibir(Map<String, dynamic> data) async {
    if (!_suportado) return;
    await iniciar();
    final idCartao = int.tryParse('${data['id_cartao']}');
    final idPedido = int.tryParse('${data['id_pedido']}');
    if (idCartao == null || idPedido == null) return;

    if (data['fase'] == 'encerrado') {
      await _plugin.cancel(id: idCartao);
      await _apagarFoto(idCartao);
      return;
    }
    // A foto só vem na abertura; as fases seguintes reusam o arquivo.
    final foto = data['foto'];
    if (foto is String && foto.isNotEmpty) await _guardarFoto(idCartao, foto);
    Map<String, dynamic> conteudo;
    try {
      conteudo = Map<String, dynamic>.from(jsonDecode('${data['conteudo']}') as Map);
    } catch (_) {
      return;
    }
    await mostrar(idCartao: idCartao, idPedido: idPedido, origem: '${data['origem'] ?? ''}', conteudo: conteudo);

    if (conteudo['fase'] == 'aguardando') await _confirmar(idCartao);
  }

  static Future<void> mostrar({
    required int idCartao,
    required int idPedido,
    required String origem,
    required Map<String, dynamic> conteudo,
  }) async {
    final t = textosCard(conteudo);
    final fase = '${conteudo['fase']}';
    final agoraMs = DateTime.now().millisecondsSinceEpoch;
    final expiraMs = ((conteudo['expiraEm'] as num?) ?? 0) * 1000;
    final duracao = switch (fase) {
      'aguardando' => (expiraMs - agoraMs).clamp(5000, 180000).toInt() + 30000,
      'liberado' => 10 * 60 * 1000,
      'entrou' => 5 * 60 * 1000,
      _ => 2 * 60 * 1000,
    };
    final foto = await _arquivoFoto(idCartao);
    final detalhes = AndroidNotificationDetails(
      canalId,
      'Portaria remota',
      // Foto do visitante (miniatura do servidor) como imagem grande.
      largeIcon: foto != null ? FilePathAndroidBitmap(foto) : null,
      importance: Importance.max,
      priority: Priority.max,
      category: AndroidNotificationCategory.status,
      visibility: NotificationVisibility.public,
      ongoing: t.emAndamento,
      autoCancel: !t.emAndamento,
      // Só a chegada do pedido toca; as mudanças de fase atualizam em silêncio.
      onlyAlertOnce: fase != 'aguardando',
      timeoutAfter: duracao,
      // Contagem regressiva até o fim da janela de resposta.
      showWhen: fase == 'aguardando',
      when: fase == 'aguardando' ? expiraMs.toInt() : null,
      usesChronometer: fase == 'aguardando',
      chronometerCountDown: fase == 'aguardando',
      color: _corDaFase(fase),
      actions: t.comBotoes
          ? const [
              AndroidNotificationAction(acaoNegar, 'NEGAR', cancelNotification: false),
              AndroidNotificationAction(acaoAutorizar, 'AUTORIZAR', showsUserInterface: true, cancelNotification: false),
            ]
          : null,
    );
    await _plugin.show(
      id: idCartao,
      title: t.titulo,
      body: t.corpo,
      notificationDetails: NotificationDetails(android: detalhes),
      payload: jsonEncode({'id_cartao': idCartao, 'id_pedido': idPedido, 'origem': origem, 'conteudo': conteudo}),
    );
  }

  /// Avisa o servidor que o card abriu (sem isto ele manda o push comum em 10 s).
  static Future<void> _confirmar(int idCartao) async {
    try {
      await ensureStorageReady();
      final jwt = getToken();
      if (jwt.isEmpty) return;
      await ApiClient.post(
        ApiConfig.buildUri('/card-ao-vivo/confirmar'),
        headers: {'Content-Type': 'application/json', 'Authorization': jwt},
        body: jsonEncode({'id_cartao': idCartao}),
        skip401Handling: true,
      ).timeout(const Duration(seconds: 8));
    } catch (e) {
      logDebug('Card ao vivo: confirmação falhou: $e');
    }
  }

  static Future<File?> _caminhoFoto(int idCartao) async {
    try {
      final dir = await getTemporaryDirectory();
      return File('${dir.path}/card_foto_$idCartao.jpg');
    } catch (_) {
      return null;
    }
  }

  static Future<void> _guardarFoto(int idCartao, String base64) async {
    try {
      final f = await _caminhoFoto(idCartao);
      await f?.writeAsBytes(base64Decode(base64), flush: true);
    } catch (e) {
      logDebug('Card ao vivo: foto não gravada: $e');
    }
  }

  /// Caminho da foto do card, se o servidor mandou uma.
  static Future<String?> _arquivoFoto(int idCartao) async {
    final f = await _caminhoFoto(idCartao);
    try {
      return f != null && await f.exists() ? f.path : null;
    } catch (_) {
      return null;
    }
  }

  static Future<void> _apagarFoto(int idCartao) async {
    try {
      final f = await _caminhoFoto(idCartao);
      if (f != null && await f.exists()) await f.delete();
    } catch (_) {}
  }

  static Color _corDaFase(String fase) => switch (fase) {
        'aguardando' => const Color(0xFFFFC83D),
        'liberado' || 'entrou' => const Color(0xFF5EC28A),
        'negado' => const Color(0xFFFF6B6B),
        _ => const Color(0xFF666666),
      };

  static _PayloadCard? _lerPayload(String? payload) {
    if (payload == null || payload.isEmpty) return null;
    try {
      final m = jsonDecode(payload) as Map;
      return _PayloadCard(
        idCartao: (m['id_cartao'] as num).toInt(),
        idPedido: (m['id_pedido'] as num).toInt(),
        origem: '${m['origem'] ?? ''}',
        conteudo: Map<String, dynamic>.from((m['conteudo'] as Map?) ?? const {}),
      );
    } catch (_) {
      return null;
    }
  }
}

class _PayloadCard {
  final int idCartao;
  final int idPedido;
  final String origem;
  final Map<String, dynamic> conteudo;
  const _PayloadCard({required this.idCartao, required this.idPedido, required this.origem, required this.conteudo});
}

/// NEGAR tocado na notificação, com o app fechado (isolate de segundo plano)
/// ou aberto. Não pede desbloqueio: negar é seguro.
@pragma('vm:entry-point')
Future<void> respostaCardSegundoPlano(NotificationResponse r) async {
  if (r.actionId != CardAndroid.acaoNegar) return;
  DartPluginRegistrant.ensureInitialized();
  final p = CardAndroid._lerPayload(r.payload);
  if (p == null) return;
  try {
    await ensureStorageReady();
    final res = await apiResponderAutorizacao(p.idPedido, false);
    if (res is Map) {
      // Mostra o resultado na hora; o push do servidor confirma em seguida.
      await CardAndroid.mostrar(
        idCartao: p.idCartao,
        idPedido: p.idPedido,
        origem: p.origem,
        conteudo: {
          ...p.conteudo,
          'fase': 'negado',
          'voceRespondeu': true,
          'horaResposta': DateTime.now().millisecondsSinceEpoch ~/ 1000,
        },
      );
    } else {
      logDebug('Card ao vivo: negar recusado: $res');
    }
  } catch (e) {
    logDebug('Card ao vivo: negar falhou: $e');
  }
}
