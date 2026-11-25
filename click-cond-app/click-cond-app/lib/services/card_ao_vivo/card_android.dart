import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:click/controllers/controller_delivery.dart';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/services/card_ao_vivo/textos_card.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/autorizacoes_controle.dart';
import 'package:click/utils/fila_por_chave.dart';
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

  /// Delivery pedido no QR do portão: "vou buscar" (segundo plano, sem
  /// desbloqueio; o portão não abre).
  static const acaoVouBuscar = 'vou_buscar';

  static final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  static Future<void>? _iniciando;

  /// Chamado pela UI quando o morador toca em AUTORIZAR (app aberto/abrindo).
  /// `origem`: visitante | visita | delivery. `rodada`: a do pedido
  /// ([rodadaDoPedido] do `chegouEm`), para a decisão valer só para ele.
  static void Function(int idPedido, String origem, int? rodada)? aoAutorizarPelaNotificacao;

  /// Chamado pela UI quando o morador toca no corpo da notificação.
  static void Function(String origem)? aoTocarNoCard;

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
    if (acaoDeSegundoPlano(r.actionId)) {
      respostaCardSegundoPlano(r);
    } else if (r.actionId == acaoAutorizar) {
      aoAutorizarPelaNotificacao?.call(dados.idPedido, dados.origem, rodadaDoPedido(dados.conteudo['chegouEm']));
    } else {
      aoTocarNoCard?.call(dados.origem);
    }
  }

  /// Pushes do mesmo card, um de cada vez e na ordem de chegada (A8).
  static final FilaPorChave<int> _fila = FilaPorChave<int>(
    aoFalhar: (e, _) => logDebug('Card ao vivo: push do card não aplicado: $e'),
  );

  /// Última fase aplicada a cada card neste isolate (o de segundo plano e o
  /// do app têm a sua; a notificação ativa é a referência comum).
  static final Map<int, String> _faseAplicada = {};

  /// Exibe, atualiza ou remove o card a partir do push de dados.
  ///
  /// Nunca lança (o listener do push não espera). Os pushes do mesmo
  /// `id_cartao` rodam em fila: sem ela o `encerrado` podia cancelar antes de
  /// o `show` do `aguardando` anterior sair, e o card ficava na tela.
  static Future<void> exibir(Map<String, dynamic> data) {
    if (!_suportado) return Future.value();
    final idCartao = int.tryParse('${data['id_cartao']}');
    if (idCartao == null) return Future.value();
    return _fila.rodar(idCartao, () => _exibir(idCartao, data));
  }

  /// Fase do card que está na tela, ou null (nenhum).
  static Future<String?> _faseNaTela(int idCartao) async {
    final aplicada = _faseAplicada[idCartao];
    if (aplicada != null) return aplicada;
    try {
      final ativas = await _plugin.getActiveNotifications();
      for (final n in ativas) {
        if (n.id != idCartao) continue;
        final fase = _lerPayload(n.payload)?.conteudo['fase'];
        return fase?.toString();
      }
    } catch (_) {}
    return null;
  }

  static Future<void> _exibir(int idCartao, Map<String, dynamic> data) async {
    await iniciar();
    final idPedido = int.tryParse('${data['id_pedido']}');
    if (idPedido == null) return;
    final origem = '${data['origem'] ?? ''}';

    if (data['fase'] == 'encerrado') {
      _faseAplicada[idCartao] = 'encerrado';
      await _plugin.cancel(id: idCartao);
      await _apagarFoto(idCartao);
      return;
    }
    Map<String, dynamic> conteudo;
    try {
      conteudo = Map<String, dynamic>.from(jsonDecode('${data['conteudo']}') as Map);
    } catch (_) {
      return;
    }
    // O FCM não garante ordem: um `aguardando` atrasado não ressuscita
    // AUTORIZAR/NEGAR num card que já foi respondido ou encerrado (F16).
    final nova = '${conteudo['fase'] ?? data['fase'] ?? ''}';
    final naTela = await _faseNaTela(idCartao);
    if (!faseCardAvanca(naTela, nova, origem: origem)) {
      logDebug('Card ao vivo: push "$nova" ignorado (card já em "$naTela")');
      return;
    }
    // Portaria: a foto vem só na abertura (data['foto']). Delivery: no próprio
    // conteúdo, em toda fase (o entregador pode ser identificado depois).
    // O arquivo guardado é reusado nas fases seguintes.
    final foto = data['foto'] ?? conteudo.remove('foto');
    if (foto is String && foto.isNotEmpty) await _guardarFoto(idCartao, foto);
    await mostrar(idCartao: idCartao, idPedido: idPedido, origem: origem, conteudo: conteudo);

    // Confirma que o card abriu (sem isto o servidor manda o aviso comum em
    // 10 s). O delivery abre em fases variadas; confirmar de novo não faz mal.
    if (conteudo['fase'] == 'aguardando' || origem == 'delivery') await _confirmar(idCartao);
  }

  static Future<void> mostrar({
    required int idCartao,
    required int idPedido,
    required String origem,
    required Map<String, dynamic> conteudo,
  }) async {
    final delivery = origem == 'delivery';
    final t = textosCard(conteudo, origem: origem);
    final fase = '${conteudo['fase']}';
    final agoraMs = DateTime.now().millisecondsSinceEpoch;
    final expiraMs = ((conteudo['expiraEm'] as num?) ?? 0) * 1000;
    final chegouMs = ((conteudo['chegouEm'] as num?) ?? 0) * 1000;
    final duracao = delivery
        ? switch (fase) {
            'entregue' => 5 * 60 * 1000,
            'recusado' => 2 * 60 * 1000,
            _ => 2 * 60 * 60 * 1000,
          }
        : switch (fase) {
            'aguardando' => (expiraMs - agoraMs).clamp(5000, 600000).toInt() + 30000, // teto = prazo da API (10 min)
            'liberado' => 10 * 60 * 1000,
            'entrou' => 5 * 60 * 1000,
            _ => 2 * 60 * 1000,
          };
    // Portaria: contagem regressiva até o fim da janela de resposta.
    // Delivery: tempo que o entregador espera, contando para cima.
    final regressiva = !delivery && fase == 'aguardando';
    final progressiva = delivery && (fase == 'chegou' || fase == 'aguardando');
    // Toca na chegada do pedido; no delivery, também quando pede autorização
    // ou quando é para descer à portaria — nunca pela resposta do próprio morador.
    final toca = cardToca(conteudo, origem: origem);
    _faseAplicada[idCartao] = fase;
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
      onlyAlertOnce: !toca,
      timeoutAfter: duracao,
      showWhen: regressiva || progressiva,
      when: regressiva ? expiraMs.toInt() : (progressiva ? chegouMs.toInt() : null),
      usesChronometer: regressiva || progressiva,
      chronometerCountDown: regressiva,
      color: _corDaFase(fase),
      // Entregador no portão: VOU BUSCAR no lugar de RECUSAR (recusar fica na
      // tela do app) e LIBERAR ENTRADA no de AUTORIZAR, que segue abrindo o app.
      actions: t.comBotoes
          ? [
              AndroidNotificationAction(t.portao ? acaoVouBuscar : acaoNegar, t.rotuloEsquerdo,
                  cancelNotification: false),
              AndroidNotificationAction(acaoAutorizar, t.rotuloDireito,
                  showsUserInterface: true, cancelNotification: false),
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

  /// Botão de segundo plano tomou 401: troca o card por um aviso sem botões
  /// (o toque abre o app, que pede o login). Sem isto o card ficava parado e
  /// o morador tocava de novo sem nada acontecer.
  static Future<void> _avisarSessaoVencida(_PayloadCard p) async {
    try {
      final t = textosCard(p.conteudo, origem: p.origem);
      await _plugin.show(
        id: p.idCartao,
        title: t.titulo,
        body: textoSessaoVencidaCard,
        notificationDetails: const NotificationDetails(
          android: AndroidNotificationDetails(
            canalId,
            'Portaria remota',
            importance: Importance.max,
            priority: Priority.max,
            category: AndroidNotificationCategory.status,
            visibility: NotificationVisibility.public,
            autoCancel: true,
            onlyAlertOnce: true,
          ),
        ),
        payload: jsonEncode({
          'id_cartao': p.idCartao,
          'id_pedido': p.idPedido,
          'origem': p.origem,
          'conteudo': p.conteudo,
        }),
      );
    } catch (e) {
      logDebug('Card ao vivo: aviso de sessão vencida não exibido: $e');
    }
  }

  static Color _corDaFase(String fase) => switch (fase) {
        'aguardando' || 'chegou' || 'retirar' => const Color(0xFFFFC83D),
        'liberado' || 'entrou' || 'autorizado' || 'entregue' => const Color(0xFF5EC28A),
        'negado' || 'recusado' => const Color(0xFFFF6B6B),
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

/// Texto do card quando um botão de segundo plano toma 401.
const textoSessaoVencidaCard = 'Sua sessão expirou. Abra o app e entre de novo para responder.';

/// O push novo do card pode ser aplicado sobre o que está na tela ([atual],
/// null = nenhum)? O FCM não garante ordem e o servidor não manda número de
/// sequência, então vale a ordem das fases:
/// - portaria: aguardando → liberado/negado/expirado → entrou; não volta;
/// - delivery: vai e volta no meio (autorizado ⇄ retirar, o entregador pede
///   no portão de novo), mas depois de entregue/recusado não reabre;
/// - `encerrado` é o fim nos dois: nada depois dele.
/// A mesma fase entra de novo (é a confirmação do servidor ou atualização).
bool faseCardAvanca(String? atual, String nova, {required String origem}) {
  if (atual == null || atual.isEmpty) return true;
  if (atual == 'encerrado') return false;
  if (nova == 'encerrado' || nova == atual) return true;
  if (origem == 'delivery') return atual != 'entregue' && atual != 'recusado';
  int ordem(String f) => switch (f) {
        'aguardando' => 0,
        'entrou' => 2,
        _ => 1,
      };
  return ordem(nova) >= ordem(atual);
}

/// Resposta recusada pelo servidor: 400 (pedido que já não aceita resposta)
/// ou 409 (a portaria mudou o atendimento antes) fecham o card. Sem rede,
/// timeout ou sessão vencida: o card fica, para o morador tentar de novo.
bool respostaRecusadaFechaCard(int? statusHttp) => statusHttp == 400 || statusHttp == 409;

/// Botões que respondem sem abrir o app: NEGAR/RECUSAR e, no delivery do
/// portão, VOU BUSCAR. AUTORIZAR / LIBERAR ENTRADA abrem o app (desbloqueio).
bool acaoDeSegundoPlano(String? actionId) =>
    actionId == CardAndroid.acaoNegar || actionId == CardAndroid.acaoVouBuscar;

/// Chamada à API de um botão de segundo plano do card do delivery:
/// RECUSAR (mesmo motivo da tela do app) ou VOU BUSCAR.
///
/// Roda em segundo plano, sem tela: um 401 não desloga o app (F17) — o
/// card avisa para abrir o app.
Future<DeliveryResult> respostaDeliveryDoCard(String acao, int idPedido) =>
    acao == CardAndroid.acaoVouBuscar
        ? apiVouBuscarDeliveryPorId(idPedido, skip401Handling: true)
        : apiResponderDeliveryPorId(idPedido, autorizar: false, skip401Handling: true);

/// 401 num botão de segundo plano: a sessão do aparelho venceu (senha trocada
/// em outro lugar, vínculo removido). Sem tela para mostrar o login.
bool sessaoVencidaNoCard(int? statusHttp) => statusHttp == 401;

/// NEGAR da portaria tocado no card: `aceito` mostra "negado" na hora;
/// recusado com 400/409 (a portaria já resolveu ou cancelou o pedido) fecha o
/// card, como no delivery — antes ele ficava parado na tela. 401
/// (`sessaoVencida`): não desloga o app em
/// segundo plano; o card pede para abrir o app.
Future<({bool aceito, bool fecharCard, bool sessaoVencida})> negarPortariaDoCard(int idPedido) async {
  final r = await apiResponderAutorizacaoComStatus(idPedido, false, skip401Handling: true);
  if (r.erro == null) return (aceito: true, fecharCard: false, sessaoVencida: false);
  logDebug('Card ao vivo: negar recusado (${r.statusCode}): ${r.erro}');
  return (
    aceito: false,
    fecharCard: respostaRecusadaFechaCard(r.statusCode),
    sessaoVencida: sessaoVencidaNoCard(r.statusCode),
  );
}

/// Fase mostrada na hora, depois que a API aceitou o botão (o push do
/// servidor confirma em seguida).
String faseDepoisDoBotao(String acao) => acao == CardAndroid.acaoVouBuscar ? 'retirar' : 'recusado';

/// NEGAR (ou VOU BUSCAR) tocado na notificação, com o app fechado (isolate
/// de segundo plano) ou aberto. Não pede desbloqueio: nenhum dos dois abre
/// nada.
@pragma('vm:entry-point')
Future<void> respostaCardSegundoPlano(NotificationResponse r) async {
  final acao = r.actionId;
  if (acao == null || !acaoDeSegundoPlano(acao)) return;
  DartPluginRegistrant.ensureInitialized();
  final p = CardAndroid._lerPayload(r.payload);
  if (p == null) return;
  try {
    await ensureStorageReady();
    if (p.origem == 'delivery') {
      final r = await respostaDeliveryDoCard(acao, p.idPedido);
      if (r.success) {
        final conteudo = {
          ...p.conteudo,
          'fase': faseDepoisDoBotao(acao),
          'voceRespondeu': true,
          'pelaPortaria': false,
          'horaResposta': DateTime.now().millisecondsSinceEpoch ~/ 1000,
        }..remove('portao');
        await CardAndroid.mostrar(idCartao: p.idCartao, idPedido: p.idPedido, origem: p.origem, conteudo: conteudo);
      } else {
        logDebug('Card ao vivo: resposta "$acao" não aceita (${r.statusCode}): ${r.message}');
        // A portaria já mudou o atendimento: o card não fica parado na tela.
        if (respostaRecusadaFechaCard(r.statusCode)) await CardAndroid._plugin.cancel(id: p.idCartao);
        if (sessaoVencidaNoCard(r.statusCode)) await CardAndroid._avisarSessaoVencida(p);
      }
      return;
    }
    // "Vou buscar" só existe no delivery: nunca vira NEGAR de visitante.
    if (acao != CardAndroid.acaoNegar) return;
    final res = await negarPortariaDoCard(p.idPedido);
    if (res.aceito) {
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
    } else if (res.fecharCard) {
      await CardAndroid._plugin.cancel(id: p.idCartao);
    } else if (res.sessaoVencida) {
      await CardAndroid._avisarSessaoVencida(p);
    }
  } catch (e) {
    logDebug('Card ao vivo: negar falhou: $e');
  }
}
