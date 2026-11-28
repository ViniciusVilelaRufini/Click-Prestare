import 'package:click/utils/log.dart';
import 'dart:async';
import 'dart:convert';

import 'package:click/pages/shared/areas sociais/list_areas_sociais.dart';
import 'package:click/pages/shared/assembleias/detail_assembleia.dart';
import 'package:click/pages/shared/assembleias/list_assembleias.dart';
import 'package:click/pages/shared/comunicados/detail_comunidado.dart';
import 'package:click/pages/shared/comunicados/list_comunicados.dart';
import 'package:click/pages/shared/delivery/list_delivery.dart';
import 'package:click/pages/shared/encomendas/list_encomendas.dart';
import 'package:click/pages/shared/enquetes/detail_enquete.dart';
import 'package:click/pages/shared/enquetes/list_enquetes.dart';
import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart';
import 'package:click/pages/shared/notificacoes/historico_acessos_page.dart';
import 'package:click/pages/shared/ocorrencias/detail_ocorrencia.dart';
import 'package:click/pages/shared/ocorrencias/list_ocorrencias.dart';
import 'package:click/pages/shared/ocorrencias/ocorrencia_chat.dart';
import 'package:click/pages/shared/delivery/resposta_delivery.dart';
import 'package:click/controllers/controller_delivery.dart';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/pages/shared/visitantes/convites_visita.dart';
import 'package:click/pages/shared/visitantes/pendentes_visitante.dart';
import 'package:click/services/atualizacoes_app.dart';
import 'package:click/services/card_ao_vivo/card_android.dart';
import 'package:click/services/card_ao_vivo/card_ao_vivo_ios.dart';
import 'package:click/services/destino_push.dart';
import 'package:click/services/interfone/token_voip.dart';
import 'package:click/theme/theme_controller.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/autorizacoes_controle.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/navigation_service.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

class FirebaseService {
  static final FirebaseService instance = FirebaseService._();
  FirebaseService._();

  /// Teto de espera das chamadas ao FCM. Login e logout esperam por elas, e o
  /// plugin não tem limite próprio.
  @visibleForTesting
  Duration limiteFcm = const Duration(seconds: 15);

  @visibleForTesting
  Future<String?> Function() obterTokenFcm = () => FirebaseMessaging.instance.getToken();

  @visibleForTesting
  Future<void> Function() apagarTokenFcm = () => FirebaseMessaging.instance.deleteToken();

  /// Token VoIP (PushKit) do iPhone para o interfone; null no Android (trocado
  /// no teste).
  @visibleForTesting
  Future<String?> Function() obterTokenVoip = tokenVoipDoAparelho;

  /// Entrega a sessão ao Swift do card do iPhone (trocado no teste).
  @visibleForTesting
  Future<void> Function(String jwt, String baseUrl) definirSessaoCard = CardAoVivoIos.definirSessao;

  /// Remoção de push mais recente: o login seguinte espera por ela. Nunca lança.
  Future<void> _desregistro = Future.value();

  /// Tema que o servidor conhece para este aparelho (null = ainda não registrou).
  String? _temaEnviado;

  /// Tema do app no formato do servidor: o card ao vivo do iPhone segue a
  /// escolha feita em Configurações (Claro, Escuro ou Sistema).
  @visibleForTesting
  static String temaDoApp(ThemeMode modo) {
    switch (modo) {
      case ThemeMode.light:
        return 'claro';
      case ThemeMode.dark:
        return 'escuro';
      case ThemeMode.system:
        return 'sistema';
    }
  }

  /// Trocou o tema depois do registro: avisa o servidor, para o próximo card
  /// já sair na cor nova.
  void _aoMudarTema() {
    final tema = temaDoApp(ThemeController.instance.mode);
    if (_temaEnviado == null || _temaEnviado == tema) return;
    unawaited(registrarNoServidor());
  }

  /// Nunca lança: quem chama não espera o resultado, e uma falha aqui não
  /// pode derrubar nem travar o app — no máximo o aparelho fica sem push.
  Future<void> init() async {
    if (kIsWeb) return;
    try {
      await _init();
    } catch (e) {
      // Sem push, mas com app funcionando.
      logDebug('Firebase indisponível, seguindo sem push: $e');
    }
  }

  Future<void> _init() async {
    await Firebase.initializeApp();
    await ensureStorageReady();

    FirebaseMessaging messaging = FirebaseMessaging.instance;

    // Card ao vivo da portaria remota (Android: notificação fixa; iPhone:
    // Live Activity pela ponte Swift). Antes do registro do token, que leva
    // o token de push-to-start do iPhone junto.
    CardAoVivoIos.iniciar(aoMudarToken: () => registrarNoServidor());
    ThemeController.instance.addListener(_aoMudarTema);
    CardAndroid.aoTocarNoCard =
        (origem) => _navigateByType(origem == 'delivery' ? 'delivery' : 'autorizacao_visitante', const {});
    CardAndroid.aoAutorizarPelaNotificacao = _autorizarPelaNotificacao;
    try {
      await CardAndroid.iniciar();
    } catch (e) {
      logDebug('Card ao vivo (Android) indisponível: $e');
    }

    // Request permissions (iOS/Android 13+)
    NotificationSettings settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );

    if (settings.authorizationStatus == AuthorizationStatus.authorized) {
      if (kDebugMode) {
        logDebug('User granted notification permission');
      }
    }

    await messaging.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );

    String? token = await messaging.getToken().timeout(
      const Duration(seconds: 15),
      onTimeout: () => null,
    );
    if (kDebugMode) {
      logDebug('FCM Token: $token');
    }

    await _registrarNoServidor(token);
    FirebaseMessaging.instance.onTokenRefresh.listen(_registrarNoServidor);

    // Handle background messages
    FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

    // Handle foreground messages
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      if (kDebugMode) {
        logDebug('Got a message whilst in the foreground! Data: ${message.data}');
      }

      // Telas abertas que mostram este assunto recarregam (reserva aprovada,
      // ocorrência resolvida, visitante que saiu...).
      final dominio = dominioDoPush(message.data);
      if (dominio != null) AtualizacoesApp.avisar(dominio);

      final type = message.data['type']?.toString();
      if (type == 'card_portaria') {
        // Nunca lança; pushes do mesmo card em fila (A8).
        unawaited(CardAndroid.exibir(message.data));
        // Diálogo de visitante só para a portaria remota; o delivery fica na
        // notificação fixa (RECUSAR/AUTORIZAR nela mesma).
        if (message.data['origem'] != 'delivery') _cardPortariaEmPrimeiroPlano(message.data);
      } else if (type == 'autorizacao_visitante') {
        final idStr = message.data['id']?.toString();
        final id = int.tryParse(idStr ?? '');
        if (id != null) {
          mostrarDialogoAutorizacaoVisitante(
            id: id,
            nome: message.data['nome']?.toString(),
            photo: message.data['photo']?.toString() ?? message.data['foto_pessoa']?.toString(),
          );
        }
      }
    });

    // Check if the app was launched by tapping a notification (terminated → foreground)
    final initialMessage = await messaging.getInitialMessage();
    if (initialMessage != null) {
      if (kDebugMode) {
        logDebug('App opened from terminated state via notification: ${initialMessage.data}');
      }
      handleNotificationNavigation(initialMessage);
    }

    // Handle when the app is opened from a notification (background → foreground)
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      if (kDebugMode) {
        logDebug('Notification opened the app from background. Data: ${message.data}');
      }
      handleNotificationNavigation(message);
    });

    // App aberto pela notificação do card (AUTORIZAR ou toque) estando fechado.
    CardAndroid.tratarAbertura();
  }

  /// Push do card da portaria com o app aberto: `aguardando` abre o diálogo;
  /// fase final (outro morador respondeu, venceu, a portaria encerrou) fecha
  /// o diálogo do mesmo pedido, se estiver aberto (F13).
  void _cardPortariaEmPrimeiroPlano(Map<String, dynamic> data) {
    final id = int.tryParse('${data['id_pedido']}');
    if (id == null) return;
    Map? conteudo;
    try {
      conteudo = jsonDecode('${data['conteudo']}') as Map;
    } catch (_) {}
    final fase = '${data['fase'] ?? conteudo?['fase'] ?? ''}';
    final rodada = rodadaDoPedido(conteudo?['chegouEm']);
    if (fase == 'aguardando') {
      mostrarDialogoAutorizacaoVisitante(id: id, nome: conteudo?['nome']?.toString(), rodada: rodada);
    } else if (fasesFinaisDoPedido.contains(fase)) {
      ControleAutorizacoes.instance.pedidoEncerrado(id, fase, rodada: rodada);
    }
  }

  /// AUTORIZAR tocado na notificação do card (Android). O app só abre depois
  /// do desbloqueio, que é a exigência de segurança do AUTORIZAR.
  ///
  /// Passa pelo [ControleAutorizacoes] como o diálogo e a tela de pendentes
  /// (A5): fecha o diálogo do mesmo pedido, não decide duas vezes e marca a
  /// decisão para a tela de pendentes esconder o card.
  Future<void> _autorizarPelaNotificacao(int idPedido, String origem, int? rodada) async {
    if (origem == 'delivery') {
      final r = await apiResponderDeliveryPorId(idPedido, autorizar: true);
      _navigateByType('delivery', const {});
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = NavigationService.navigatorKey.currentContext;
        if (ctx == null) return;
        ScaffoldMessenger.maybeOf(ctx)?.showSnackBar(SnackBar(
          content: Text(r.success
              ? mensagemAutorizacaoDelivery(r.delivery?.status)
              : (r.message ?? 'Não foi possível autorizar.')),
        ));
      });
      return;
    }
    final controle = ControleAutorizacoes.instance;
    controle.fecharDialogoDe(idPedido);
    if (!controle.assumirDecisao(idPedido, rodada: rodada)) {
      // Já decidido (ou sendo decidido agora) por outra superfície.
      _navigateByType('autorizacao_visitante', const {});
      return;
    }
    final r = await apiResponderAutorizacaoComStatus(idPedido, true);
    if (r.erro == null || respostaRecusadaFechaCard(r.statusCode)) {
      // 400/409: o pedido já não aceita resposta (respondido, vencido).
      controle.decidiu(idPedido, rodada: rodada);
    } else {
      controle.desistiuDaDecisao(idPedido);
    }
    AtualizacoesApp.avisar(DominioApp.visitante);
    _navigateByType('autorizacao_visitante', const {});
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = NavigationService.navigatorKey.currentContext;
      if (ctx == null) return;
      ScaffoldMessenger.maybeOf(ctx)?.showSnackBar(SnackBar(
        content: Text(r.erro == null ? 'Entrada autorizada.' : '${r.erro}'),
      ));
    });
  }

  /// Navega diretamente para a tela apropriada ao tocar na notificação push.
  void handleNotificationNavigation(RemoteMessage? message) {
    if (message == null) return;
    // Push comum do delivery vem sem `type` (só id_delivery/status): F9.
    final type = tipoDoPush(message.data);
    if (type == null) return;

    if (kDebugMode) {
      logDebug('[FCM] handleNotificationNavigation: type=$type, data=${message.data}');
    }

    _navigateByType(type, message.data);
  }

  /// Abre a tela de um tipo de aviso (toque no card ao vivo do iPhone).
  void abrirTela(String tipo) => _navigateByType(tipo, const {});

  void _navigateByType(String type, Map<String, dynamic> data, [int attempts = 0]) {
    final nav = NavigationService.navigatorKey.currentState;
    final ctx = NavigationService.navigatorKey.currentContext;

    // Se o navigator ainda não estiver pronto (ex.: app iniciando ou splash/auto-login),
    // tenta novamente a cada 200ms por até 5 segundos.
    if (nav == null || ctx == null) {
      if (attempts < 25) {
        Future.delayed(const Duration(milliseconds: 200), () {
          _navigateByType(type, data, attempts + 1);
        });
      }
      return;
    }

    final destino = destinoDoPush(type, data);
    if (destino == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      void abrir(Widget tela, {String? nome}) => nav.push(MaterialPageRoute(
            settings: nome == null ? null : RouteSettings(name: nome),
            builder: (_) => tela,
          ));
      final id = destino.id;
      final cond = destino.idCondominio;
      switch (destino.tela) {
        case TelaPush.pendentes:
          abrir(PendentesVisitantePage(idCondominio: cond));
        case TelaPush.historicoAcessos:
          abrir(const HistoricoAcessosPage());
        case TelaPush.encomendas:
          abrir(ListEncomendas(destacarId: id));
        // Card ao vivo do delivery (toque ou AUTORIZAR na notificação fixa)
        // e o push comum do delivery.
        case TelaPush.delivery:
          abrir(ListDelivery(idCondominio: cond), nome: '/delivery');
        // A rota da ocorrência não precisa do condomínio aberto (a API
        // confere pelo id): abre o item do push, não a lista vazia (F10).
        case TelaPush.ocorrencia:
          abrir(DetailOcorrencia(id: id!));
        case TelaPush.ocorrenciaChat:
          abrir(DetailOcorrencia(id: id!));
          abrir(OcorrenciaChatPage(idOcorrencia: id, titulo: 'Ocorrência #$id'));
        case TelaPush.ocorrencias:
          abrir(const ListOcorrencias());
        case TelaPush.financeiro:
          abrir(MoradorFinanceiroView(idCondominio: cond));
        case TelaPush.reservas:
          // Aba "Minhas reservas": o card da reserva tem o "Confirmar presença".
          abrir(ListAreasSociais(minhasReservas: true, idCondominio: cond));
        case TelaPush.comunicado:
          abrir(DetailComunicado(id: id!));
        case TelaPush.comunicados:
          abrir(const ListComunicados());
        case TelaPush.assembleia:
          abrir(DetailAssembleia(id: id!));
        case TelaPush.assembleias:
          abrir(const ListAssembleias());
        case TelaPush.enquete:
          abrir(DetailEnquete(id: id!));
        case TelaPush.enquetes:
          abrir(const ListEnquetes());
        case TelaPush.convites:
          abrir(const ConvitesVisitaPage());
      }
    });
  }

  /// Envia o token do aparelho para o servidor, se houver sessão.
  Future<void> registrarNoServidor([String? tokenFcm]) async {
    // Token pedido com um deleteToken em curso morreria logo em seguida.
    await _desregistro;
    // Push é acessório: sem rede ou sem Google Play o getToken lança.
    String? token = tokenFcm;
    try {
      token ??= await obterTokenFcm().timeout(limiteFcm);
    } catch (e) {
      logDebug('Sem token de push: $e');
      return;
    }
    await _registrarNoServidor(token);
  }

  Future<void> _registrarNoServidor(String? tokenFcm) async {
    if (tokenFcm == null || tokenFcm.isEmpty) return;
    try {
      await ensureStorageReady().timeout(limiteFcm);
    } catch (e) {
      logDebug('Armazenamento sem resposta ao registrar push: ${e.runtimeType}');
    }
    final jwt = getToken();
    if (jwt.isEmpty) return;

    // Sessão para os botões do card no iPhone (o Swift chama a API sozinho).
    await atualizarSessaoDoCard(jwt);
    final cardTokenInicio = await CardAoVivoIos.obterTokenInicio();
    final tema = temaDoApp(ThemeController.instance.mode);
    String? voipToken;
    try {
      voipToken = tokenVoipValido(await obterTokenVoip().timeout(limiteFcm));
    } catch (e) {
      logDebug('Interfone: sem token VoIP: ${e.runtimeType}');
    }

    try {
      await ApiClient.post(
        ApiConfig.buildUri('/users/update-fcm-token'),
        headers: {'Content-Type': 'application/json', 'Authorization': jwt},
        body: jsonEncode({
          'fcm_token': tokenFcm,
          'plataforma': defaultTargetPlatform.name,
          if (cardTokenInicio != null) 'card_token_inicio': cardTokenInicio,
          // Este app monta o card ao vivo no Android (o servidor manda o push
          // só de dados apenas para aparelhos com esta marca).
          if (defaultTargetPlatform == TargetPlatform.android) 'card_android': true,
          'card_tema': tema,
          // Versão do card que este app desenha: 2 = também o do delivery
          // (o servidor só manda card de delivery a partir dela).
          'card_versao': 2,
          // Interfone pelo app: o iPhone toca pelo push VoIP (PushKit); o
          // Android pelo push de dados. Versão 1 = este app atende a chamada
          // (o servidor manda push comum "atualize o app" para quem tem 0).
          if (voipToken != null) 'voip_token': voipToken,
          'interfone_versao': 1,
        }),
      );
      _temaEnviado = tema;
    } catch (e) {
      logDebug('Falha ao registrar token de push: $e');
    }
  }

  /// Entrega o token da sessão ao card do iPhone, que guarda a própria cópia
  /// no keychain e chama a API sozinho (NEGAR/AUTORIZAR, confirmar).
  ///
  /// Também roda depois da troca de senha ([atualizarTokenSessao]): a API
  /// recusa (401) o JWT emitido antes da troca, e o card ficava com o velho —
  /// os botões paravam e o porteiro esperava (F12). Nunca lança.
  Future<void> atualizarSessaoDoCard(String jwt) async {
    if (jwt.isEmpty) return;
    final base = ApiConfig.buildUri('').toString().replaceAll(RegExp(r'/+$'), '');
    try {
      await definirSessaoCard(jwt, base).timeout(limiteFcm);
    } catch (e) {
      logDebug('Card ao vivo: sessão do iPhone não atualizada: $e');
    }
  }

  /// Remove o token do servidor e invalida o token local no Firebase (logout).
  /// Garante que nenhuma notificação seja recebida enquanto o app estiver deslogado.
  ///
  /// [jwt] é o token da sessão que está saindo: o logout já o apagou do cache
  /// quando esta chamada chega ao servidor. Se outra sessão começar nesse
  /// intervalo, para por aqui: o token do aparelho é um só, e removê-lo deixaria
  /// o login novo sem push (a rota do servidor não filtra por usuário).
  Future<void> desregistrarNoServidor({String? jwt}) =>
      _desregistro = _desregistrar(jwt: jwt);

  Future<void> _desregistrar({String? jwt}) async {
    final sessao = jwt ?? getToken();
    bool outraSessao() => jwt != null && getToken().isNotEmpty;

    if (outraSessao()) return;
    // Card ao vivo: sem esperar. O Sair não pode depender de plugin nativo
    // (o FCM já mostrou que um plugin sem resposta trava o logout).
    unawaited(CardAoVivoIos.limparSessao().timeout(limiteFcm, onTimeout: () {}).catchError((_) {}));
    unawaited(CardAndroid.limpar().timeout(limiteFcm, onTimeout: () {}).catchError((_) {}));
    String? token;
    try {
      token = await obterTokenFcm().timeout(limiteFcm);
    } catch (_) {}

    if (outraSessao()) return;
    if (sessao.isNotEmpty) {
      try {
        await ApiClient.post(
          ApiConfig.buildUri('/users/remove-fcm-token'),
          headers: {'Content-Type': 'application/json', 'Authorization': sessao},
          body: jsonEncode({
            if (token != null && token.isNotEmpty) 'fcm_token': token,
          }),
          // Já é um logout: 401 aqui não tem o que encerrar.
          skip401Handling: true,
        );
      } catch (e) {
        logDebug('Erro ao desregistrar FCM token no backend: $e');
      }
    }

    if (outraSessao()) return;
    try {
      await apagarTokenFcm().timeout(limiteFcm);
    } catch (e) {
      logDebug('Erro ao deletar FCM token local: $e');
    }
  }
}

// Entry point do isolate de segundo plano: sem a anotação, o build release
// (AOT) remove a função e o card do Android não aparece com o app fechado.
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  if (kIsWeb) return;
  await Firebase.initializeApp();
  if (kDebugMode) {
    logDebug("Handling a background message: ${message.messageId}");
  }
  // Card ao vivo no Android: o push só de dados vira a notificação fixa.
  if (message.data['type'] == 'card_portaria') {
    await CardAndroid.exibir(message.data);
  }
}

/// Fases do card da portaria que encerram o pedido para o morador: o diálogo
/// aberto para ele fecha (F13).
const Set<String> fasesFinaisDoPedido = {'liberado', 'negado', 'expirado', 'entrou', 'encerrado'};
