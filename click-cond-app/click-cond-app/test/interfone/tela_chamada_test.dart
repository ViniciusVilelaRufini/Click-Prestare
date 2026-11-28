import 'dart:async';
import 'dart:convert';

import 'package:click/pages/shared/interfone/tela_chamada.dart';
import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/services/interfone/interfone_chamadas.dart';
import 'package:click/services/interfone/sip_voz.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _SessaoFalsa implements SessaoVoz {
  final StreamController<String> _c = StreamController<String>.broadcast();
  String _estado = 'conectando';
  bool encerrada = false;
  bool? mudoLigado;

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
  void mudo(bool ligado) => mudoLigado = ligado;

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

Map<String, dynamic> _estado(String tipo) => {
      'id': 41,
      'tipo': tipo,
      'estado': 'chamando',
      'resultado': null,
      'unidade': 'Bloco A · Apto 106',
      'portao': 'Portão social',
      'foto_url': null,
      'atendida_por_mim': false,
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _SessaoFalsa sessao;
  late List<String> rotas;
  late List<String> encerradasNativas;
  late bool atenderConflito;
  late String tipo;
  late Map<String, dynamic> respostaAbrir;

  setUp(() {
    sessao = _SessaoFalsa();
    rotas = [];
    encerradasNativas = [];
    atenderConflito = false;
    tipo = 'facial_unidade';
    respostaAbrir = {'ok': true};
    ApiClient.tokenProvider = () => 'sessao';
    ApiClient.client = MockClient((r) async {
      rotas.add('${r.method} ${r.url.path}');
      if (r.url.path.endsWith('/atender')) {
        return atenderConflito
            ? http.Response(jsonEncode({'motivo': 'ja_atendida'}), 409)
            : http.Response(jsonEncode(_entrada), 201);
      }
      if (r.url.path.endsWith('/abrir')) return http.Response(jsonEncode(respostaAbrir), 201);
      return http.Response(jsonEncode(_estado(tipo)), 200);
    });
    InterfoneChamadas.redefinirParaTeste();
  });

  tearDown(ApiClient.restaurarPadroes);

  Future<void> abrir(WidgetTester tester, {DadosEntrada? jaConectado, bool microfone = true}) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => TelaChamada(
                id: 41,
                jaConectado: jaConectado,
                tipoInicial: jaConectado == null ? null : 'unidade_portaria',
                conectar: (DadosEntrada d, RTCVideoRenderer? v) async => sessao,
                pedirMicrofone: () async => microfone,
                criarVideo: () async => null,
                encerrarTelaNativa: (uuid) async => encerradasNativas.add(uuid),
                marcarConectada: (_) async {},
                prepararSessao: () async {},
                esperaAoFechar: const Duration(seconds: 3),
              ),
            )),
            child: const Text('abrir'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('chamada do facial mostra ABRIR PORTÃO e abre', (tester) async {
    await abrir(tester);
    expect(rotas, contains('POST /api/interfone/chamadas/41/atender'));
    expect(find.text('PORTÃO SOCIAL'), findsOneWidget);
    expect(find.text('Bloco A · Apto 106'), findsOneWidget);
    expect(find.text('ABRIR PORTÃO'), findsOneWidget);

    sessao.mudar('em_chamada');
    await tester.pump();
    await tester.pump();
    await tester.tap(find.text('ABRIR PORTÃO'));
    await tester.pumpAndSettle();
    expect(rotas, contains('POST /api/interfone/chamadas/41/abrir'));
    expect(find.text('Portão aberto'), findsOneWidget);

    await tester.tap(find.text('ENCERRAR'));
    await tester.pumpAndSettle();
    expect(sessao.encerrada, isTrue);
    expect(find.byType(TelaChamada), findsNothing);
    expect(encerradasNativas, [uuidDaChamada(41)]);
  });

  testWidgets('abrir recusado mostra o motivo', (tester) async {
    respostaAbrir = {'ok': false, 'motivo': 'agente offline'};
    await abrir(tester);
    sessao.mudar('em_chamada');
    await tester.pump();
    await tester.pump();
    await tester.tap(find.text('ABRIR PORTÃO'));
    await tester.pumpAndSettle();
    expect(find.text('Não foi possível abrir: agente offline'), findsOneWidget);
    await tester.tap(find.text('ENCERRAR'));
    await tester.pumpAndSettle();
  });

  testWidgets('chamada da portaria para a unidade não mostra ABRIR PORTÃO', (tester) async {
    tipo = 'portaria_unidade';
    await abrir(tester);
    expect(find.text('ABRIR PORTÃO'), findsNothing);
    expect(find.text('PORTARIA'), findsOneWidget);
    await tester.tap(find.text('ENCERRAR'));
    await tester.pumpAndSettle();
  });

  testWidgets('409 mostra "Já atendida em outro aparelho" e fecha', (tester) async {
    atenderConflito = true;
    await abrir(tester);
    expect(find.text('Já atendida em outro aparelho'), findsOneWidget);
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
    expect(find.byType(TelaChamada), findsNothing);
  });

  testWidgets('sem microfone não atende', (tester) async {
    await abrir(tester, microfone: false);
    expect(rotas.where((r) => r.endsWith('/atender')), isEmpty);
    expect(find.textContaining('Sem acesso ao microfone'), findsOneWidget);
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
  });

  testWidgets('ligando para a portaria: entra direto e avisa quando ninguém atende', (tester) async {
    tipo = 'unidade_portaria';
    await abrir(tester, jaConectado: DadosEntrada.fromJson(_entrada));
    expect(rotas.where((r) => r.endsWith('/atender')), isEmpty);
    expect(find.text('ABRIR PORTÃO'), findsNothing);
    expect(find.text('CHAMANDO A PORTARIA…'), findsOneWidget);
    sessao.mudar('encerrada');
    await tester.pump();
    await tester.pump();
    expect(find.text('A portaria não atendeu'), findsOneWidget);
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
    expect(find.byType(TelaChamada), findsNothing);
  });

  testWidgets('Encerrar no sistema (CallKit) desliga a conversa', (tester) async {
    await abrir(tester);
    sessao.mudar('em_chamada');
    await tester.pump();
    await tester.pump();
    InterfoneChamadas.registrarTela(99, () {}); // outra chamada não interfere
    await InterfoneChamadas.tratarEvento(CallEventActionCallEnded(CallKitParams(id: uuidDaChamada(41))));
    await tester.pumpAndSettle();
    expect(sessao.encerrada, isTrue);
    expect(find.byType(TelaChamada), findsNothing);
  });

  test('mensagens das recusas', () {
    expect(mensagemDaRecusa('ja_atendida'), 'Já atendida em outro aparelho');
    expect(mensagemDaRecusa('encerrada'), 'A chamada já terminou');
    expect(mensagemDaRecusa('portaria_indisponivel'), 'Portaria indisponível agora');
    expect(mensagemDaRecusa(null), 'Não foi possível entrar na chamada');
  });

  test('ICE do contrato vira um servidor por URL no sip_ua', () {
    final ice = SipVoz.iceDoSipUa(const [
      ServidorIce(urls: ['stun:a:3478']),
      ServidorIce(urls: ['turn:a:3478?transport=udp', 'turn:a:3478?transport=tcp'], username: 'u', credential: 'c'),
    ]);
    expect(ice, [
      {'urls': 'stun:a:3478'},
      {'urls': 'turn:a:3478?transport=udp', 'username': 'u', 'credential': 'c'},
      {'urls': 'turn:a:3478?transport=tcp', 'username': 'u', 'credential': 'c'},
    ]);
  });

  test('a chamada não liga a câmera e pede o vídeo do facial', () {
    final o = SipVoz.opcoesDaChamada();
    expect(o['mediaConstraints'], {'audio': true, 'video': false});
    expect(o['rtcOfferConstraints']['mandatory']['OfferToReceiveVideo'], isTrue);
  });
}
