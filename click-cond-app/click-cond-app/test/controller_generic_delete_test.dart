import 'package:click/controllers/controller_generic.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  tearDown(ApiClient.restaurarPadroes);

  test('considera remoção bem-sucedida quando a API responde 201 Created', () async {
    ApiClient.tokenProvider = () => 'token-de-teste';
    ApiClient.client = MockClient((request) async {
      expect(request.method, 'POST');
      expect(request.url.path, endsWith('/api/moradores/remove'));
      return http.Response('{"ok":true}', 201);
    });

    expect(await apiDeleteObject('moradores', 42), isTrue);
  });
}
