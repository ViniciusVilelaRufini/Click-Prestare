import 'dart:convert';

import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/chat_ia/anexo_ia.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// A API do assistente passou a aceitar só PDF, JPEG, PNG ou WEBP até 5 MB
/// (tipo pelos bytes) e a ter cota diária. O app checa o anexo antes de
/// enviar e mostra as recusas da API como vieram.
void main() {
  group('mimeAceitoAnexoIa', () {
    test('aceita PDF, JPEG, PNG e WEBP pelos bytes', () {
      expect(mimeAceitoAnexoIa([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31]), 'application/pdf');
      expect(mimeAceitoAnexoIa([0xFF, 0xD8, 0xFF, 0xE0]), 'image/jpeg');
      expect(mimeAceitoAnexoIa([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), 'image/png');
      expect(
        mimeAceitoAnexoIa([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
        'image/webp',
      );
    });

    test('recusa GIF, HEIC e arquivo vazio', () {
      expect(mimeAceitoAnexoIa(ascii.encode('GIF89a')), isNull);
      expect(mimeAceitoAnexoIa([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), isNull);
      expect(mimeAceitoAnexoIa([]), isNull);
    });

    test('limite é 5 MB', () {
      final jpeg = List<int>.filled(kMaxAnexoIaBytes, 0)..setAll(0, [0xFF, 0xD8, 0xFF]);
      expect(mimeAceitoAnexoIa(jpeg), 'image/jpeg');
      expect(mimeAceitoAnexoIa([...jpeg, 0]), isNull);
    });

    test('seletor de arquivo oferece só os formatos aceitos', () {
      expect(kExtensoesAnexoIa.toSet(), {'pdf', 'jpg', 'jpeg', 'png', 'webp'});
    });
  });

  group('apiPerguntarChatIa mostra a recusa da API', () {
    setUp(() => Singleton.instance.id_condominio = 22);
    tearDown(() {
      ApiClient.restaurarPadroes();
      Singleton.instance.reset();
    });

    void responder(int status, String message) {
      ApiClient.client = MockClient((_) async => http.Response(
            jsonEncode({'statusCode': status, 'message': message}),
            status,
            headers: {'content-type': 'application/json; charset=utf-8'},
          ));
    }

    test('429 da cota diária', () async {
      const msg = 'Limite diário do assistente atingido. Tente novamente amanhã.';
      responder(429, msg);
      final r = await apiPerguntarChatIa('oi');
      expect(r.texto, msg);
    });

    test('400 do anexo recusado', () async {
      responder(400, kMsgAnexoIaRecusado);
      final r = await apiPerguntarChatIa('veja', arquivo: {'nome': 'a.gif', 'mime_type': 'image/gif', 'base64': 'R0lG'});
      expect(r.texto, kMsgAnexoIaRecusado);
    });

    test('corpo sem JSON cai no texto padrão', () async {
      ApiClient.client = MockClient((_) async => http.Response('<html>', 502));
      final r = await apiPerguntarChatIa('oi');
      expect(r.texto, 'Não consegui responder agora. Tente novamente.');
    });
  });
}
