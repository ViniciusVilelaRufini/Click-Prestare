import 'dart:async';
import 'dart:io';

import 'package:click/pages/shared/meu_acesso/passe_carteira_secao.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Seção "carteira" da tela Meu acesso: só no iPhone, só com a opção ligada no
/// condomínio e a carteira da Apple disponível na API. Sem botão do Google (o
/// dono decidiu publicar só a Apple). Enquanto carrega, em erro ou desligada,
/// não desenha nada.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<int> situacoesPedidas;
  late List<Map<String, dynamic>> situacoes;
  late List<int> passesPedidos;
  late Map<String, dynamic> respostaPasse;
  late List<int> cancelamentos;
  late Map<String, dynamic> respostaCancelar;
  late List<String> abertos;
  late Directory tmp;

  Map<String, dynamic> situacao({bool habilitado = true, bool disponivel = true, bool ativo = false}) => {
        'habilitado': habilitado,
        'apple': {'disponivel': disponivel, 'ativo': ativo},
        'google': {'disponivel': false, 'ativo': false},
      };

  setUp(() {
    situacoesPedidas = [];
    situacoes = [];
    passesPedidos = [];
    respostaPasse = {'bytes': <int>[0x50, 0x4b, 3, 4]};
    cancelamentos = [];
    respostaCancelar = {'ok': true};
    abertos = [];
    tmp = Directory.systemTemp.createTempSync('passe_carteira_');
    PasseCarteiraSecao.situacao = (id) async {
      situacoesPedidas.add(id);
      return situacoes.isEmpty ? situacao() : situacoes.removeAt(0);
    };
    PasseCarteiraSecao.passeApple = (id) async {
      passesPedidos.add(id);
      return respostaPasse;
    };
    PasseCarteiraSecao.cancelar = (id) async {
      cancelamentos.add(id);
      return respostaCancelar;
    };
    PasseCarteiraSecao.diretorioTemporario = () async => tmp.path;
  });

  tearDown(() {
    PasseCarteiraSecao.restaurarPadroes();
    try {
      tmp.deleteSync(recursive: true);
    } catch (_) {}
  });

  Future<void> abrir(WidgetTester tester, {TargetPlatform plataforma = TargetPlatform.iOS}) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: PasseCarteiraSecao(
            idCondominio: 10,
            plataforma: plataforma,
            abrirArquivo: (caminho) async => abertos.add(caminho),
          ),
        ),
      ),
    ));
    await tester.pump();
    await tester.pump();
  }

  Finder botaoAdicionar() => find.bySemanticsLabel('Adicionar à Carteira da Apple');

  testWidgets('habilitado false, erro ou carregando: a seção não desenha nada', (tester) async {
    final segurar = Completer<Map<String, dynamic>>();
    PasseCarteiraSecao.situacao = (id) => segurar.future;
    await abrir(tester);
    expect(find.byType(PasseCarteiraSecao), findsOneWidget);
    expect(find.byKey(PasseCarteiraSecao.chaveConteudo), findsNothing);
    segurar.complete(situacao(habilitado: false));
    await tester.pump();
    expect(find.byKey(PasseCarteiraSecao.chaveConteudo), findsNothing);

    await tester.pumpWidget(const SizedBox());
    PasseCarteiraSecao.situacao = (id) async => {'erro': 'Sem conexão com a internet.'};
    await abrir(tester);
    expect(find.byKey(PasseCarteiraSecao.chaveConteudo), findsNothing);
    expect(find.textContaining('Sem conexão'), findsNothing);
  });

  testWidgets('iPhone com apple.disponivel: mostra o botão da Apple e nada do Google', (tester) async {
    await abrir(tester);
    expect(situacoesPedidas, [10]);
    expect(botaoAdicionar(), findsOneWidget);
    expect(find.textContaining('Google'), findsNothing);
    expect(find.text('Passe ativo na carteira.'), findsNothing);
  });

  testWidgets('Android: nada, e nem pergunta a situação', (tester) async {
    await abrir(tester, plataforma: TargetPlatform.android);
    expect(situacoesPedidas, isEmpty);
    expect(find.byKey(PasseCarteiraSecao.chaveConteudo), findsNothing);
  });

  testWidgets('iPhone com apple.disponivel false: não mostra botão', (tester) async {
    situacoes.add(situacao(disponivel: false));
    await abrir(tester);
    expect(botaoAdicionar(), findsNothing);
    expect(find.byKey(PasseCarteiraSecao.chaveConteudo), findsNothing);
  });

  testWidgets('tocar no botão da Apple grava o arquivo e abre o caminho terminado em .pkpass', (tester) async {
    await abrir(tester);
    await tester.tap(botaoAdicionar());
    await tester.pump();
    await tester.pump();

    expect(passesPedidos, [10]);
    expect(abertos, hasLength(1));
    expect(abertos.single, endsWith('prestare.pkpass'));
    expect(File(abertos.single).readAsBytesSync(), [0x50, 0x4b, 3, 4]);
    // Fechada a folha do sistema, a situação é lida de novo.
    expect(situacoesPedidas, [10, 10]);
  });

  testWidgets('ativo true: mostra "Passe ativo na carteira.", "Adicionar novamente" e "Cancelar passe"', (tester) async {
    situacoes.add(situacao(ativo: true));
    await abrir(tester);
    expect(find.text('Passe ativo na carteira.'), findsOneWidget);
    expect(find.bySemanticsLabel('Adicionar novamente'), findsOneWidget);
    expect(find.bySemanticsLabel('Cancelar passe'), findsOneWidget);

    await tester.tap(find.bySemanticsLabel('Adicionar novamente'));
    await tester.pump();
    await tester.pump();
    expect(passesPedidos, [10]);
    expect(abertos, hasLength(1));
  });

  testWidgets('cancelar pede confirmação com o texto exato, chama a API e recarrega', (tester) async {
    situacoes.addAll([situacao(ativo: true), situacao(ativo: false)]);
    await abrir(tester);

    await tester.tap(find.bySemanticsLabel('Cancelar passe'));
    await tester.pumpAndSettle();
    expect(
      find.text('Cancelar o passe da carteira? Ele deixa de abrir na hora, em todos os aparelhos. O QR desta tela continua funcionando.'),
      findsOneWidget,
    );
    expect(cancelamentos, isEmpty);

    await tester.tap(find.text('CANCELAR PASSE').last);
    await tester.pumpAndSettle();
    expect(cancelamentos, [10]);
    expect(situacoesPedidas, [10, 10]);
    expect(find.text('Passe ativo na carteira.'), findsNothing);
    expect(botaoAdicionar(), findsOneWidget);
  });

  testWidgets('voltar da confirmação não cancela', (tester) async {
    situacoes.add(situacao(ativo: true));
    await abrir(tester);

    await tester.tap(find.bySemanticsLabel('Cancelar passe'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('VOLTAR'));
    await tester.pumpAndSettle();
    expect(cancelamentos, isEmpty);
    expect(find.text('Passe ativo na carteira.'), findsOneWidget);
  });

  testWidgets('erro do servidor ao adicionar aparece em SnackBar', (tester) async {
    respostaPasse = {'erro': 'Carteira indisponível no momento.'};
    await abrir(tester);
    await tester.tap(botaoAdicionar());
    await tester.pump();
    await tester.pump();
    expect(find.descendant(of: find.byType(SnackBar), matching: find.text('Carteira indisponível no momento.')),
        findsOneWidget);
    expect(abertos, isEmpty);
  });

  testWidgets('erro sem mensagem ao cancelar: texto padrão em SnackBar', (tester) async {
    situacoes.add(situacao(ativo: true));
    respostaCancelar = {'erro': ''};
    await abrir(tester);
    await tester.tap(find.bySemanticsLabel('Cancelar passe'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CANCELAR PASSE').last);
    await tester.pump();
    await tester.pump();
    expect(find.descendant(of: find.byType(SnackBar), matching: find.text('Não foi possível concluir. Tente de novo.')),
        findsOneWidget);
  });

  testWidgets('volta ao primeiro plano: recarrega a situação', (tester) async {
    await abrir(tester);
    expect(situacoesPedidas, [10]);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(situacoesPedidas, [10, 10]);
  });
}
