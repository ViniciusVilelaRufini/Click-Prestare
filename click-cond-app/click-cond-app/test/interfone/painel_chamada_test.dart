import 'dart:async';
import 'dart:convert';

import 'package:click/pages/shared/interfone/tela_chamada.dart';
import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/services/interfone/interfone_chamadas.dart';
import 'package:click/services/interfone/sip_voz.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _SessaoFalsa implements SessaoVoz {
  final StreamController<String> _c = StreamController<String>.broadcast();
  String _estado = 'conectando';
  bool encerrada = false;

  void mudar(String e) {
    _estado = e;
    _c.add(e);
  }

  @override
  Stream<String> get estado => _c.stream;
  @override
  String get estadoAtual => _estado;
  @override
  final ValueNotifier<bool> temVideo = ValueNotifier<bool>(false);
  @override
  void encerrar() {
    if (encerrada) return;
    encerrada = true;
    mudar('encerrada');
  }

  @override
  void mudo(bool ligado) {}
  @override
  Future<void> altoFalante(bool ligado) async {}
}

const _entrada = {
  'id': 41,
  'token': 't',
  'wss': 'wss://voz.prestarecondominios.com.br:8089/ws',
  'sip_uri': 'sip:entrar@voz.prestarecondominios.com.br',
  'ice': [],
};

/// App fechado → Atender: a navegação de entrada (HomePage faz
/// pushReplacement, a lista de condomínios faz push) não pode trocar nem
/// esconder a tela da chamada.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _SessaoFalsa sessao;
  late GlobalKey<NavigatorState> nav;

  setUp(() {
    sessao = _SessaoFalsa();
    nav = GlobalKey<NavigatorState>();
    ApiClient.tokenProvider = () => 'sessao';
    ApiClient.client = MockClient((r) async {
      if (r.url.path.endsWith('/atender')) return http.Response(jsonEncode(_entrada), 201);
      // O GET do estado falha: a tela usa o que veio no push.
      return http.Response('{}', 500);
    });
    InterfoneChamadas.redefinirParaTeste();
    ChamadaNaTela.redefinirParaTeste();
  });

  tearDown(() {
    ApiClient.restaurarPadroes();
    ChamadaNaTela.redefinirParaTeste();
  });

  Future<void> montar(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      navigatorKey: nav,
      builder: (context, child) => PainelChamada(
        construir: (p, fechar) => TelaChamada(
          id: p.id,
          jaConectado: p.jaConectado,
          tipoInicial: p.tipo,
          tituloInicial: p.portao,
          unidadeInicial: p.unidade,
          aoFechar: fechar,
          conectar: (DadosEntrada d, RTCVideoRenderer? v) async => sessao,
          pedirMicrofone: () async => true,
          criarVideo: () async => null,
          encerrarTelaNativa: (_) async {},
          marcarConectada: (_) async {},
          prepararSessao: () async {},
          esperaAoFechar: const Duration(seconds: 3),
        ),
        child: child,
      ),
      home: const Scaffold(body: Text('abertura')),
    ));
  }

  testWidgets('chamada aceita antes da navegação de entrada continua na tela', (tester) async {
    await montar(tester);
    await abrirTelaDaChamada(41, {'tipo': 'facial_unidade', 'portao': 'Portão social', 'unidade': 'Bloco A · Apto 106'});
    await tester.pump();

    // A HomePage troca a rota do topo e a lista empurra a home do condomínio.
    unawaited(nav.currentState!.pushReplacement(MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('porta')))));
    await tester.pumpAndSettle();
    unawaited(nav.currentState!.push(MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('home do condomínio')))));
    await tester.pumpAndSettle();

    expect(find.byType(TelaChamada), findsOneWidget);
    expect(sessao.encerrada, isFalse);
    // Valores do push: o GET do estado falhou.
    expect(find.text('PORTÃO SOCIAL'), findsOneWidget);
    expect(find.text('Bloco A · Apto 106'), findsOneWidget);
    expect(find.text('ABRIR PORTÃO'), findsOneWidget);
    expect(ChamadaNaTela.ativa, isTrue);
    expect(ChamadaNaTela.consumirVoltar(), isTrue);

    await tester.tap(find.text('ENCERRAR'));
    await tester.pumpAndSettle();
    expect(find.byType(TelaChamada), findsNothing);
    expect(sessao.encerrada, isTrue);
    expect(ChamadaNaTela.ativa, isFalse);
    expect(ChamadaNaTela.consumirVoltar(), isFalse);
    // A navegação de baixo ficou intacta.
    expect(find.text('home do condomínio'), findsOneWidget);
  });

  testWidgets('com a chamada na tela: Navigator o mesmo, sem foco, leitor de tela e animações embaixo', (tester) async {
    await montar(tester);
    final antes = nav.currentState;
    final foco = FocusNode();
    addTearDown(foco.dispose);
    unawaited(nav.currentState!.push(MaterialPageRoute<void>(
        builder: (_) => Scaffold(body: TextField(focusNode: foco, decoration: const InputDecoration(labelText: 'busca'))))));
    await tester.pumpAndSettle();
    foco.requestFocus();
    await tester.pump();
    expect(foco.hasFocus, isTrue);

    await abrirTelaDaChamada(41, {'tipo': 'facial_unidade'});
    await tester.pump();
    expect(foco.hasFocus, isFalse);
    expect(identical(nav.currentState, antes), isTrue);
    expect(tester.widget<ExcludeSemantics>(find.byType(ExcludeSemantics).first).excluding, isTrue);
    expect(TickerMode.valuesOf(tester.element(find.byType(TextField))).enabled, isFalse);

    await tester.tap(find.text('ENCERRAR'));
    await tester.pumpAndSettle();
    expect(identical(nav.currentState, antes), isTrue);
    expect(tester.widget<ExcludeSemantics>(find.byType(ExcludeSemantics).first).excluding, isFalse);
    expect(TickerMode.valuesOf(tester.element(find.byType(TextField))).enabled, isTrue);
  });

  testWidgets('a mesma chamada aceita duas vezes abre uma tela só', (tester) async {
    await montar(tester);
    await abrirTelaDaChamada(41, const {});
    await abrirTelaDaChamada(41, const {});
    await tester.pump();
    expect(find.byType(TelaChamada), findsOneWidget);
    await tester.tap(find.text('ENCERRAR'));
    await tester.pumpAndSettle();
  });
}
