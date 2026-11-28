import 'package:click/utils/local_storage.dart';
import 'package:click/utils/log.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Permissões do interfone pedidas ANTES da primeira chamada.
///
/// Na tela bloqueada o alerta do sistema não aparece (iPhone atendendo pelo
/// CallKit) e, no Android 14, o serviço de chamada do flutter_callkit_incoming
/// só sobe com o tipo "microfone" se o RECORD_AUDIO já estiver concedido
/// quando a chamada toca. Por isso o app pede quando o módulo aparece ligado
/// pela primeira vez e quando o morador liga "Receber chamadas do portão".
///
/// No Android 14+ também confere a tela cheia (USE_FULL_SCREEN_INTENT): sem
/// ela a chamada vira só notificação, e o app manda o morador liberar (uma vez;
/// o switch pergunta de novo).
class PermissoesInterfone {
  PermissoesInterfone._();

  static Future<PermissionStatus> Function() _statusMicrofone = _statusMicrofonePadrao;
  static Future<bool> Function() _pedirMicrofone = _pedirMicrofonePadrao;
  static Future<bool> Function() _podeTelaCheia = _podeTelaCheiaPadrao;
  static Future<void> Function() _pedirTelaCheia = _pedirTelaCheiaPadrao;
  static bool Function() _ehAndroid = _ehAndroidPadrao;
  static bool Function() _telaCheiaJaPedida = interfoneTelaCheiaPedida;
  static void Function() _marcarTelaCheiaPedida = marcarInterfoneTelaCheiaPedida;
  static DateTime? Function() _adiadoAte = interfonePermissoesAdiadasAte;
  static void Function(DateTime ate) _adiar = adiarInterfonePermissoes;
  static DateTime Function() _agora = DateTime.now;

  /// "Agora não": a home só pergunta de novo depois disto (o switch sempre
  /// pergunta).
  static const Duration adiamento = Duration(days: 7);

  static bool _perguntouNestaSessao = false;

  /// Explica e pede o que falta. [doSwitch]: o morador acabou de ligar
  /// "Receber chamadas do portão" e pergunta de novo mesmo que já tenha
  /// perguntado. Nunca lança.
  static Future<void> preparar(BuildContext context, {bool doSwitch = false}) async {
    if (!doSwitch && _perguntouNestaSessao) return;
    if (!doSwitch) {
      final ate = _adiadoAte();
      if (ate != null && _agora().isBefore(ate)) return;
    }
    _perguntouNestaSessao = true;

    PermissionStatus? mic;
    try {
      mic = await _statusMicrofone();
    } catch (e) {
      logDebug('[Interfone] status do microfone: ${e.runtimeType}');
    }
    final micBloqueado = mic != null && (mic.isPermanentlyDenied || mic.isRestricted);
    final precisaMic = mic != null && !mic.isGranted && !micBloqueado;

    var precisaTelaCheia = false;
    if (_ehAndroid() && (doSwitch || !_telaCheiaJaPedida())) {
      try {
        precisaTelaCheia = !await _podeTelaCheia();
      } catch (e) {
        logDebug('[Interfone] tela cheia: ${e.runtimeType}');
      }
    }

    if (!context.mounted) return;
    if (!precisaMic && !precisaTelaCheia) {
      if (doSwitch && micBloqueado) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(
          content: Text('Libere o microfone do Prestare nas configurações do celular para atender o interfone.'),
        ));
      }
      return;
    }

    final ok = await showAppConfirmDialog(
      context,
      title: 'Interfone no celular',
      message: textoDoPedido(microfone: precisaMic, telaCheia: precisaTelaCheia),
      confirmLabel: 'Continuar',
      cancelLabel: 'Agora não',
      icon: PhosphorIcons.phoneCall,
    );
    if (!ok) {
      _adiar(_agora().add(adiamento));
      return;
    }
    if (precisaMic) {
      try {
        await _pedirMicrofone();
      } catch (e) {
        logDebug('[Interfone] pedir microfone: ${e.runtimeType}');
      }
    }
    if (precisaTelaCheia) {
      _marcarTelaCheiaPedida();
      try {
        await _pedirTelaCheia();
      } catch (e) {
        logDebug('[Interfone] pedir tela cheia: ${e.runtimeType}');
      }
    }
  }

  @visibleForTesting
  static String textoDoPedido({required bool microfone, required bool telaCheia}) {
    final partes = <String>[
      if (microfone) 'Para você conversar com quem chama no portão, o Prestare precisa usar o microfone.',
      if (telaCheia)
        'Para a chamada aparecer em tela cheia, também com o celular bloqueado, permita as notificações em tela cheia na próxima tela.',
    ];
    return partes.join('\n\n');
  }

  /// Troca as dependências no teste; sem argumentos, volta ao padrão.
  @visibleForTesting
  static void redefinirParaTeste({
    Future<PermissionStatus> Function()? statusMicrofone,
    Future<bool> Function()? pedirMicrofone,
    Future<bool> Function()? podeTelaCheia,
    Future<void> Function()? pedirTelaCheia,
    bool Function()? ehAndroid,
    bool Function()? telaCheiaJaPedida,
    void Function()? marcarTelaCheiaPedida,
    DateTime? Function()? adiadoAte,
    void Function(DateTime ate)? adiar,
    DateTime Function()? agora,
  }) {
    _perguntouNestaSessao = false;
    _statusMicrofone = statusMicrofone ?? _statusMicrofonePadrao;
    _pedirMicrofone = pedirMicrofone ?? _pedirMicrofonePadrao;
    _podeTelaCheia = podeTelaCheia ?? _podeTelaCheiaPadrao;
    _pedirTelaCheia = pedirTelaCheia ?? _pedirTelaCheiaPadrao;
    _ehAndroid = ehAndroid ?? _ehAndroidPadrao;
    _telaCheiaJaPedida = telaCheiaJaPedida ?? interfoneTelaCheiaPedida;
    _marcarTelaCheiaPedida = marcarTelaCheiaPedida ?? marcarInterfoneTelaCheiaPedida;
    _adiadoAte = adiadoAte ?? interfonePermissoesAdiadasAte;
    _adiar = adiar ?? adiarInterfonePermissoes;
    _agora = agora ?? DateTime.now;
  }

  /// Nova sessão do app (teste): volta a perguntar.
  @visibleForTesting
  static void esquecerSessao() => _perguntouNestaSessao = false;
}

Future<PermissionStatus> _statusMicrofonePadrao() => Permission.microphone.status;

Future<bool> _pedirMicrofonePadrao() async => (await Permission.microphone.request()).isGranted;

Future<bool> _podeTelaCheiaPadrao() => FlutterCallkitIncoming.canUseFullScreenIntent();

Future<void> _pedirTelaCheiaPadrao() async {
  await FlutterCallkitIncoming.requestFullIntentPermission();
}

bool _ehAndroidPadrao() => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
