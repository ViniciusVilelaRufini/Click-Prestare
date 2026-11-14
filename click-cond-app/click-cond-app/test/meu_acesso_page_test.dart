import 'package:click/pages/shared/meu_acesso/meu_acesso_page.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/services/biometric_auth_service.dart';
import 'package:click/services/credencial_acesso.dart';
import 'package:click/utils/codigo_dinamico.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qr_flutter/qr_flutter.dart';

class _SeguroFalso implements SecureStorageInterface {
  final Map<String, String> dados = {};

  @override
  Future<void> write({required String key, required String? value}) async {
    if (value == null) {
      dados.remove(key);
    } else {
      dados[key] = value;
    }
  }

  @override
  Future<String?> read({required String key}) async => dados[key];

  @override
  Future<void> delete({required String key}) async => dados.remove(key);

  @override
  Future<Map<String, String>> readAll() async => Map.of(dados);
}

const _hexA = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const _canal = MethodChannel('prestare/tela_segura');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<Map<String, dynamic>> respostas;
  late List<String> telaSegura;
  late List<String> brilho;
  late DateTime relogio;
  final inicio = DateTime.utc(2026, 11, 14, 12, 0, 0);

  Map<String, dynamic> emitida() => {
        'disponivel': true,
        'id': 7,
        'segredo': _hexA,
        'intervalo_s': 30,
        'agora_servidor': relogio.toIso8601String(),
      };

  setUp(() {
    respostas = [];
    telaSegura = [];
    brilho = [];
    relogio = inicio;
    CredencialAcesso.armazenamento = _SeguroFalso();
    CredencialAcesso.agora = () => relogio;
    CredencialAcesso.chamar = (int id, {bool renovar = false}) async =>
        respostas.isEmpty ? {'erro': 'Sem conexão com a internet.', 'sem_conexao': true} : respostas.removeAt(0);
    MeuAcessoPage.brilhoMaximo = () async => brilho.add('max');
    MeuAcessoPage.restaurarBrilho = () async => brilho.add('restaurar');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(_canal, (call) async {
      telaSegura.add(call.method);
      return null;
    });
    Singleton.instance.id_condominio = 10;
    Singleton.instance.condominio_nome = 'Residencial Teste';
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(_canal, null);
    Singleton.instance.reset();
  });

  String codigoEm(DateTime t) =>
      gerarCodigoDinamico(id: 7, contador: contadorDe(t), segredo: segredoDeHex(_hexA));

  Future<void> abrir(WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: MeuAcessoPage()));
    await tester.pump();
    await tester.pump();
  }

  testWidgets('pronta: mostra um QrImageView com o código do instante e o contador', (tester) async {
    relogio = inicio.add(const Duration(seconds: 12));
    respostas.add(emitida());

    await abrir(tester);

    expect(find.byType(QrImageView), findsOneWidget);
    expect(find.byKey(ValueKey('qr-${codigoEm(relogio)}')), findsOneWidget);
    expect(find.text('Novo código em 18 s'), findsOneWidget);
    expect(find.text('Residencial Teste'), findsOneWidget);
    expect(telaSegura, ['ligar']);
    expect(brilho, ['max']);

    relogio = relogio.add(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Novo código em 17 s'), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('o código muda quando o relógio cruza o múltiplo de 30 s', (tester) async {
    relogio = inicio.add(const Duration(seconds: 28));
    respostas.add(emitida());

    await abrir(tester);
    final antes = codigoEm(relogio);
    expect(find.byKey(ValueKey('qr-$antes')), findsOneWidget);

    relogio = relogio.add(const Duration(seconds: 1)); // :29, mesmo intervalo
    await tester.pump(const Duration(seconds: 1));
    expect(find.byKey(ValueKey('qr-$antes')), findsOneWidget);
    expect(find.text('Novo código em 1 s'), findsOneWidget);

    relogio = relogio.add(const Duration(seconds: 1)); // :30, vira
    await tester.pump(const Duration(seconds: 1));
    final depois = codigoEm(relogio);
    expect(depois, isNot(antes));
    expect(find.byKey(ValueKey('qr-$depois')), findsOneWidget);
    expect(find.byKey(ValueKey('qr-$antes')), findsNothing);
    expect(find.text('Novo código em 30 s'), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('primeira vez sem internet: mostra a mensagem e o botão Tentar de novo', (tester) async {
    await abrir(tester);

    expect(find.text('Conecte-se à internet uma vez para ativar seu QR de acesso.'), findsOneWidget);
    expect(find.byType(QrImageView), findsNothing);
    final botao = find.text('TENTAR DE NOVO');
    expect(botao, findsOneWidget);

    respostas.add(emitida());
    await tester.tap(botao);
    await tester.pump();
    await tester.pump();

    expect(find.byKey(ValueKey('qr-${codigoEm(relogio)}')), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('indisponível no condomínio e sem unidade: mostram as mensagens exatas', (tester) async {
    respostas.add({'disponivel': false, 'motivo': 'opcao_desligada'});
    await abrir(tester);
    expect(find.text('O QR de acesso não está ativo neste condomínio.'), findsOneWidget);
    expect(find.byType(QrImageView), findsNothing);

    await tester.pumpWidget(const SizedBox());
    respostas.add({'disponivel': false, 'motivo': 'sem_morador'});
    await abrir(tester);
    expect(find.text('Seu usuário não tem unidade vinculada neste condomínio.'), findsOneWidget);
    expect(find.byType(QrImageView), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('ao sair da tela desliga a tela segura', (tester) async {
    respostas.add(emitida());
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MeuAcessoPage())),
          child: const Text('abrir'),
        ),
      ),
    ));
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle(const Duration(milliseconds: 100), EnginePhase.sendSemanticsUpdate, const Duration(seconds: 2));
    expect(find.byType(QrImageView), findsOneWidget);
    expect(telaSegura, ['ligar']);

    tester.state<NavigatorState>(find.byType(Navigator)).pop();
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    expect(find.byType(MeuAcessoPage), findsNothing);
    expect(telaSegura, ['ligar', 'desligar']);
    expect(brilho, ['max', 'restaurar']);
  });

  testWidgets('app em segundo plano restaura o brilho; ao voltar, maximiza de novo', (tester) async {
    respostas.add(emitida());
    await abrir(tester);
    expect(brilho, ['max']);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    expect(brilho, ['max', 'restaurar']);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(brilho, ['max', 'restaurar', 'max']);

    await tester.pumpWidget(const SizedBox());
  });
}
