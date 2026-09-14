import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/local_storage.dart';

/// Regressão: "minha sessão cai sozinha depois que eu troco a senha".
///
/// O login devolve o token no campo `token`; `/new-password` devolve no campo
/// `access_token`. As funções de sessão liam só `parsed["token"]`, então trocar
/// a senha gravava `null` por cima do token bom: o request seguinte tomava 401,
/// o ApiClient fazia logout e o usuário via "Sua sessão expirou" do nada.
void main() {
  group('tokenDaResposta', () {
    test('lê o campo token do login', () {
      expect(tokenDaResposta({'token': 'abc.123'}), 'abc.123');
    });

    test('lê o access_token de /new-password (o bug)', () {
      expect(tokenDaResposta({'access_token': 'novo.token'}), 'novo.token');
    });

    test('devolve null quando nenhum dos dois veio', () {
      expect(tokenDaResposta({'id': 7, 'nome': 'Fulano'}), isNull);
    });

    /// A resposta de erro do NestJS chega como Map também. Gravar '' ou 'null'
    /// por cima do token bom é o mesmo desastre de gravar null.
    test('trata vazio e a string "null" como ausência de token', () {
      expect(tokenDaResposta({'token': ''}), isNull);
      expect(tokenDaResposta({'token': '   '}), isNull);
      expect(tokenDaResposta({'access_token': 'null'}), isNull);
    });

    test('ignora o campo vazio e usa o que tem valor', () {
      expect(tokenDaResposta({'token': '', 'access_token': 'bom'}), 'bom');
    });
  });
}
