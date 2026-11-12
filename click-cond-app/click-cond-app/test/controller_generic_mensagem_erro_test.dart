import 'package:click/controllers/controller_generic.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('mensagemErroSalvar', () {
    test('404 (API antiga sem a rota) vira texto amigável, sem o corpo cru', () {
      final m = mensagemErroSalvar(404, '{"message":"Cannot POST /ocorrencias/update","statusCode":404}');
      expect(m, 'Esta função ainda não está disponível no servidor. Tente novamente mais tarde.');
      expect(m, isNot(contains('{')));
    });
    test('demais status mantêm a message da API', () {
      expect(mensagemErroSalvar(400, '{"message":"Descrição é obrigatória."}'), 'Descrição é obrigatória.');
      expect(mensagemErroSalvar(400, '{"message":["a","b"]}'), 'a, b');
    });
    test('sem message: Erro HTTP com o corpo', () {
      expect(mensagemErroSalvar(500, 'oops'), 'Erro HTTP 500: oops');
    });
  });
}
