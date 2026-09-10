import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:click/widgets/cells/cell_financeiro_card.dart';

/// O card do morador oferece pagar com cartão — mas só quando o link leva a
/// uma página que aceita cartão.
///
/// `url_boleto` guarda duas coisas diferentes conforme a origem do
/// lançamento, e essa é a distinção que estes testes protegem:
///
///  - `origem == 'superlogica'` → é o `link_segundavia` do ERP, uma PÁGINA de
///    pagamento com boleto, Pix e cartão.
///  - qualquer outra origem → é um arquivo (PDF/imagem) que alguém subiu.
///    Abrir aquilo e chamar de "pagar com cartão" promete o que o link não
///    faz.
///
/// Um `if` sobre um campo que o card nem lia antes é exatamente o tipo de
/// condicional que quebra em silêncio numa refatoração futura.

Widget _montar(Map<String, dynamic> item) {
  return MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView(
        child: FinanceiroCard(item: item),
      ),
    ),
  );
}

Map<String, dynamic> _cobranca({
  required String origem,
  String? pix,
  String urlBoleto = 'https://exemplo/2via',
  int pago = 0,
}) {
  return {
    'id': 1,
    'nome': 'Apto 101 Bloco A - Ref. 09/2026',
    'valor': 459.0,
    'valorString': 'R\$ 459,00',
    'tipo': 'C',
    'pago': pago,
    'status': '0',
    'categoria': 'Taxa Condominial',
    'data_vencimento': '30/09/2026',
    'url_boleto': urlBoleto,
    'pix_copia_cola': pix,
    'linha_digitavel': '34191790010104351004791020150008',
    'origem': origem,
  };
}

void main() {
  group('Cobrança da Superlógica', () {
    testWidgets('oferece pagar com cartão', (tester) async {
      await tester.pumpWidget(_montar(_cobranca(origem: 'superlogica', pix: '00020126...')));

      expect(find.text('Pagar com cartão'), findsOneWidget);
    });

    testWidgets('chama o link do ERP de "2ª via", não de boleto', (tester) async {
      await tester.pumpWidget(_montar(_cobranca(origem: 'superlogica', pix: '00020126...')));

      // O link abre a página do ERP. Rotular como "Ver boleto" com ícone de
      // PDF descreve errado o que está do outro lado.
      expect(find.text('Abrir 2ª via'), findsOneWidget);
      expect(find.text('Ver boleto'), findsNothing);
    });

    testWidgets('mantém o Pix em destaque como botão principal', (tester) async {
      await tester.pumpWidget(_montar(_cobranca(origem: 'superlogica', pix: '00020126...')));

      // Pix é instantâneo e não tem taxa de cartão para o condomínio: cartão
      // é alternativa, não o caminho oferecido primeiro.
      expect(find.text('Pagar com Pix (QR Code)'), findsOneWidget);
    });
  });

  group('Lançamento gerado pelo Clique', () {
    testWidgets('NÃO oferece cartão — o link é só um arquivo', (tester) async {
      await tester.pumpWidget(_montar(_cobranca(origem: 'clique')));

      expect(find.text('Pagar com cartão'), findsNothing);
      expect(find.text('Ver boleto'), findsOneWidget);
    });

    testWidgets('origem ausente é tratada como não-Superlógica', (tester) async {
      final item = _cobranca(origem: 'clique')..remove('origem');
      await tester.pumpWidget(_montar(item));

      // Lançamento antigo, anterior à integração, não tem o campo. Na dúvida,
      // não prometer cartão.
      expect(find.text('Pagar com cartão'), findsNothing);
    });
  });

  group('Cobrança já paga', () {
    testWidgets('não oferece nenhuma forma de pagamento', (tester) async {
      await tester.pumpWidget(
        _montar(_cobranca(origem: 'superlogica', pix: '00020126...', pago: 1)),
      );

      expect(find.text('Pagar com cartão'), findsNothing);
      expect(find.text('Pagar com Pix (QR Code)'), findsNothing);
    });
  });

  group('Superlógica sem link de 2ª via', () {
    testWidgets('não oferece cartão quando não há url_boleto', (tester) async {
      await tester.pumpWidget(
        _montar(_cobranca(origem: 'superlogica', pix: '00020126...', urlBoleto: '')),
      );

      expect(find.text('Pagar com cartão'), findsNothing);
    });
  });
}
