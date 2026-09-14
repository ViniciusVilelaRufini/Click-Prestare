import 'package:click/utils/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// O `Authorization` era montado à mão em cada chamada: quatro cópias de um
/// `_authHeaders()` idêntico nos controllers, mais 39 mapas inline. Trocar o
/// esquema de autenticação (um prefixo `Bearer`, por exemplo) exigiria editar
/// ~50 lugares, e qualquer rota nova podia simplesmente esquecer o header.
///
/// O lugar disso é o ApiClient, junto do timeout e do tratamento de 401.
void main() {
  late http.Request capturada;

  setUp(() {
    ApiClient.tokenProvider = () => 'token-do-usuario';
    ApiClient.client = MockClient((req) async {
      capturada = req;
      return http.Response('{}', 200);
    });
  });

  tearDown(ApiClient.restaurarPadroes);

  final url = Uri.parse('https://exemplo.test/financeiro/get-all');

  test('injeta o Authorization sem o call site pedir', () async {
    await ApiClient.get(url);
    expect(capturada.headers['Authorization'], 'token-do-usuario');
  });

  test('injeta também no post, put e delete', () async {
    await ApiClient.post(url, body: '{}');
    expect(capturada.headers['Authorization'], 'token-do-usuario');
    await ApiClient.put(url, body: '{}');
    expect(capturada.headers['Authorization'], 'token-do-usuario');
    await ApiClient.delete(url);
    expect(capturada.headers['Authorization'], 'token-do-usuario');
  });

  /// Login e cadastro rodam sem sessão. Mandar `Authorization: ""` é pior que
  /// não mandar nada: dá a um guard a chance de tratar como token inválido.
  test('não manda o header quando não há token', () async {
    ApiClient.tokenProvider = () => '';
    await ApiClient.get(url);
    expect(capturada.headers.containsKey('Authorization'), isFalse);
  });

  test('o header do call site tem precedência', () async {
    await ApiClient.get(url, headers: {'Authorization': 'token-especifico'});
    expect(capturada.headers['Authorization'], 'token-especifico');
  });

  test('preserva os demais headers do call site', () async {
    await ApiClient.post(url, headers: {'X-Origem': 'portaria'}, body: '{}');
    expect(capturada.headers['X-Origem'], 'portaria');
    expect(capturada.headers['Authorization'], 'token-do-usuario');
  });

  test('define Content-Type json no corpo, se o call site não definiu', () async {
    await ApiClient.post(url, body: '{"a":1}');
    expect(capturada.headers['Content-Type'], contains('application/json'));
  });

  test('não sobrescreve o Content-Type do call site', () async {
    await ApiClient.post(
      url,
      headers: {'Content-Type': 'text/plain; charset=utf-8'},
      body: 'texto',
    );
    expect(capturada.headers['Content-Type'], contains('text/plain'));
  });

  test('em produção o token vem do storage da sessão', () {
    ApiClient.restaurarPadroes();
    // Sem sessão no ambiente de teste, o provider devolve string vazia — o que
    // importa é que ele exista e não estoure.
    expect(ApiClient.tokenProvider(), isA<String>());
  });
}
