import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:click/widgets/cells/cell_financeiro_card.dart';

const _aviso = 'Aguardando dados de pagamento (Pix ou boleto) do condomínio.';

Widget _montar(Map<String, dynamic> item) => MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(child: FinanceiroCard(item: item)),
      ),
    );

Map<String, dynamic> _conta({required String tipo, int? idUsuario}) => {
      'id': 1,
      'nome': 'Luz',
      'valor': 120.0,
      'valorString': 'R\$ 120,00',
      'tipo': tipo,
      'pago': 0,
      'status': '0',
      'categoria': tipo == 'D' ? 'Luz' : 'Taxa Condominial',
      'data_vencimento': '30/12/2026',
      'id_usuario': idUsuario,
    };

void main() {
  testWidgets('conta pessoal (D + id_usuario) sem Pix/boleto não mostra o aviso do condomínio',
      (tester) async {
    await tester.pumpWidget(_montar(_conta(tipo: 'D', idUsuario: 7)));
    expect(find.text(_aviso), findsNothing);
  });

  testWidgets('cobrança do condomínio sem dados de pagamento mostra o aviso', (tester) async {
    await tester.pumpWidget(_montar(_conta(tipo: 'C')));
    expect(find.text(_aviso), findsOneWidget);
  });

  testWidgets('cobrança C que também traz id_usuario continua mostrando o aviso', (tester) async {
    await tester.pumpWidget(_montar(_conta(tipo: 'C', idUsuario: 7)));
    expect(find.text(_aviso), findsOneWidget);
  });
}
