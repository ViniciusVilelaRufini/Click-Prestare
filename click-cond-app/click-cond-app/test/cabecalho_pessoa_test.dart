import 'package:click/theme/app_colors.dart';
import 'package:click/widgets/app/cabecalho_pessoa.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Topo do cartão de visitante/prestador no desenho novo: foto (ou iniciais)
/// à esquerda com o degradê só na imagem, selo de status colorido e o nome
/// com tipo e unidade.
void main() {
  Future<void> montar(WidgetTester t, {ImageProvider? foto, StatusPessoa status = StatusPessoa.noLocal}) {
    return t.pumpWidget(MaterialApp(
      home: Scaffold(
        body: CabecalhoPessoa(
          nome: 'Rafael Costa',
          subtitulo: 'Visitante · Bloco A · 106',
          status: status,
          foto: foto,
        ),
      ),
    ));
  }

  testWidgets('sem foto mostra as iniciais, sem degradê', (t) async {
    await montar(t);
    expect(find.text('RC'), findsOneWidget);
    expect(find.byType(ShaderMask), findsNothing);
    expect(find.text('Rafael Costa'), findsOneWidget);
    expect(find.text('Visitante · Bloco A · 106'), findsOneWidget);
  });

  testWidgets('com foto, a imagem dissolve (degradê só na foto)', (t) async {
    await montar(t, foto: const AssetImage('assets/images/modulos/mudanca.png'));
    expect(find.descendant(of: find.byType(ShaderMask), matching: find.byType(Image)), findsOneWidget);
    expect(find.text('RC'), findsNothing);
  });

  testWidgets('selo de status na cor do estado', (t) async {
    await montar(t, status: StatusPessoa.noLocal);
    expect(t.widget<Text>(find.text('NO LOCAL')).style?.color, AppColors.success);
    await montar(t, status: StatusPessoa.finalizado);
    final ctx = t.element(find.text('FINALIZADO'));
    expect(t.widget<Text>(find.text('FINALIZADO')).style?.color, AppColors.textTertiary(ctx));
  });
}
