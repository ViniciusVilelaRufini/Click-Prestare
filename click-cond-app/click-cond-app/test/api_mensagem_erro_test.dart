import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/api_client.dart';

/// As três funções de troca de senha faziam
/// `catch (e) { throw "Houve um erro, tente novamente!" }`, o que apagava a
/// mensagem que o NestJS tinha acabado de mandar. Com a senha atual agora
/// obrigatória, "Senha atual incorreta." precisa chegar na tela — senão o
/// usuário só vê "houve um erro" e não tem como descobrir o que fazer.
void main() {
  group('mensagemDeErroApi', () {
    test('usa a message do NestJS', () {
      expect(
        mensagemDeErroApi('{"message":"Senha atual incorreta.","statusCode":401}'),
        'Senha atual incorreta.',
      );
    });

    /// O NestJS manda message como lista quando o ValidationPipe reprova vários campos.
    test('junta a message quando vem como lista', () {
      expect(
        mensagemDeErroApi('{"message":["senha muito curta","senha obrigatória"]}'),
        'senha muito curta\nsenha obrigatória',
      );
    });

    test('cai no fallback quando o corpo não é JSON', () {
      expect(
        mensagemDeErroApi('<html>502 Bad Gateway</html>'),
        'Houve um erro, tente novamente!',
      );
    });

    test('cai no fallback quando não há message', () {
      expect(mensagemDeErroApi('{"statusCode":500}'), 'Houve um erro, tente novamente!');
      expect(mensagemDeErroApi(''), 'Houve um erro, tente novamente!');
    });

    test('aceita um fallback próprio', () {
      expect(
        mensagemDeErroApi('{}', fallback: 'Não foi possível salvar.'),
        'Não foi possível salvar.',
      );
    });
  });
}
