import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// C2: a API respondia 201 e o app exigia 200 — mostrava falha depois de
/// enviar, e o reenvio duplicava push e e-mail. Vale qualquer 2xx; quem
/// decide é o `success` do corpo.
void main() {
  tearDown(() {
    ApiClient.restaurarPadroes();
    Singleton.instance.reset();
  });

  Future<dynamic> notificarCom(int status, String corpo) {
    Singleton.instance.id_condominio = 5;
    ApiClient.client = MockClient((_) async => http.Response(corpo, status));
    return apiNotificarInadimplente('A', '101');
  }

  test('201 com success: true é sucesso', () async {
    final r = await notificarCom(201, '{"success": true, "pushEnviados": 1}');
    expect(r['success'], isTrue);
  });

  test('2xx com success: false traz o motivo do servidor', () async {
    final r = await notificarCom(200, '{"success": false, "message": "Nenhuma fatura em atraso encontrada."}');
    expect(r['success'], isFalse);
    expect(r['message'], contains('Nenhuma fatura'));
  });

  test('403 segue como falha com a mensagem', () async {
    final r = await notificarCom(403, '{"message": "Sem permissão."}');
    expect(r['success'], isFalse);
    expect(r['message'], 'Sem permissão.');
  });
}
