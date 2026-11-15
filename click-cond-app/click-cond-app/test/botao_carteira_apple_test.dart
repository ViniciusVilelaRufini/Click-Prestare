import 'package:click/pages/shared/meu_acesso/botao_carteira_apple.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Botão "Adicionar à Carteira Apple": no iPhone é o PKAddPassButton nativo
/// (platform view), cujo toque chega pelo canal da view; fora dele, um
/// substituto com o mesmo rótulo.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<MethodCall> chamadasViews;
  late int toques;

  setUp(() {
    chamadasViews = [];
    toques = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform_views, (chamada) async {
      chamadasViews.add(chamada);
      return null;
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform_views, null);
  });

  Future<void> abrir(WidgetTester tester, {required bool nativo, bool ocupado = false}) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 320,
            child: BotaoCarteiraApple(aoTocar: () => toques++, ocupado: ocupado, nativo: nativo),
          ),
        ),
      ),
    ));
    await tester.pump();
  }

  /// O que o PKAddPassButton manda ao Flutter quando o morador toca nele.
  Future<void> nativoTocou(WidgetTester tester, int id) async {
    await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.handlePlatformMessage(
      '${BotaoCarteiraApple.tipoView}/$id',
      const StandardMethodCodec().encodeMethodCall(const MethodCall('tocou')),
      (_) {},
    );
    await tester.pump();
  }

  int idCriado() {
    final criar = chamadasViews.singleWhere((c) => c.method == 'create');
    expect((criar.arguments as Map)['viewType'], BotaoCarteiraApple.tipoView);
    return (criar.arguments as Map)['id'] as int;
  }

  testWidgets('iPhone: cria a view nativa com altura 48 e largura do container, sem o botão Prestare', (tester) async {
    await abrir(tester, nativo: true);
    expect(find.byType(UiKitView), findsOneWidget);
    expect(tester.widget<UiKitView>(find.byType(UiKitView)).viewType, BotaoCarteiraApple.tipoView);
    expect(tester.getSize(find.byType(UiKitView)), const Size(320, 48));
    idCriado();
    expect(find.bySemanticsLabel(BotaoCarteiraApple.rotulo), findsNothing);
  });

  testWidgets('iPhone: o toque no botão nativo dispara a ação', (tester) async {
    await abrir(tester, nativo: true);
    await nativoTocou(tester, idCriado());
    expect(toques, 1);
  });

  testWidgets('iPhone ocupado: toque do nativo ignorado e a view não recebe toques', (tester) async {
    await abrir(tester, nativo: true, ocupado: true);
    await nativoTocou(tester, idCriado());
    expect(toques, 0);
    final ignora = tester
        .widget<IgnorePointer>(find.ancestor(of: find.byType(UiKitView), matching: find.byType(IgnorePointer)).first);
    expect(ignora.ignoring, isTrue);
  });

  testWidgets('ao sair da tela, o canal da view deixa de chamar a ação', (tester) async {
    await abrir(tester, nativo: true);
    final id = idCriado();
    await tester.pumpWidget(const SizedBox());
    await nativoTocou(tester, id);
    expect(toques, 0);
  });

  testWidgets('fora do iPhone: substituto com o rótulo, tocável, sem view nativa', (tester) async {
    await abrir(tester, nativo: false);
    expect(find.byType(UiKitView), findsNothing);
    expect(chamadasViews, isEmpty);
    await tester.tap(find.bySemanticsLabel(BotaoCarteiraApple.rotulo));
    expect(toques, 1);
  });
}
