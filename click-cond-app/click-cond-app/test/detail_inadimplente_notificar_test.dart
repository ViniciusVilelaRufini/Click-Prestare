import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:click/pages/shared/financeiro/detail_inadimplente.dart';

/// O síndico decide cobrar olhando o detalhe do apartamento — é ali que ele
/// vê quais meses estão em aberto e quanto soma.
///
/// O "Notificar" existia só na linha de UMA das três listas que levam a esta
/// tela (`InadimplenciaAptosPage`); pelos outros dois caminhos — o dashboard
/// POR BLOCO e a `list_inadimplentes` — não havia botão nenhum. Quem abrisse
/// o apartamento precisava voltar e lembrar de usar a listagem certa.
///
/// Corrigido na tela de detalhe, que é onde os três caminhos terminam.
void main() {
  testWidgets('detalhe do inadimplente oferece notificar a cobrança', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: DetailInadimplente(bloco: 'A', apto: '101'),
      ),
    );

    expect(find.text('Notificar cobrança'), findsOneWidget);

    // Deixa a chamada de rede do initState concluir (sem servidor, ela falha
    // e a tela trata) — mesmo padrão de historico_acessos_test.
    await tester.pump(const Duration(milliseconds: 100));
  });

  testWidgets('o botão fica acessível mesmo enquanto a lista carrega', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: DetailInadimplente(bloco: 'A', apto: '101'),
      ),
    );

    // Primeiro frame: ainda em _isLoading, o corpo é só o spinner. O botão
    // não pode depender disso — ele mora no rodapé, como no modal da web.
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('Notificar cobrança'), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 100));
  });
}
