import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/visitantes_pessoas.dart';

/// Os chips "Todos / Visitantes / Prestadores" contavam LINHAS de visita:
/// uma pessoa com 20 entradas virava "20". A regra de identidade é a mesma
/// da aba "Cadastrados" e precisa continuar única.
void main() {
  group('deduplicarPessoas', () {
    test('20 visitas da mesma pessoa contam 1', () {
      final linhas = List.generate(
        20,
        (i) => {'nome': 'Maria Souza', 'doc_identificacao': '123.456.789-00'},
      );
      expect(deduplicarPessoas(linhas).length, 1);
    });

    test('mesmo documento com nomes diferentes é a mesma pessoa', () {
      final linhas = [
        {'nome': 'Joao', 'doc_identificacao': '12345678900'},
        {'nome': 'João da Silva', 'doc_identificacao': '123.456.789-00'},
      ];
      expect(deduplicarPessoas(linhas).length, 1);
    });

    test('documento com menos de 4 dígitos não identifica ninguém', () {
      final linhas = [
        {'nome': 'Ana', 'doc_identificacao': '12'},
        {'nome': 'Bia', 'doc_identificacao': '12'},
      ];
      expect(deduplicarPessoas(linhas).length, 2);
    });

    test('mesmo nome, ignorando caixa e espaços repetidos', () {
      final linhas = [
        {'nome': 'Carlos  Lima'},
        {'nome': ' carlos lima '},
      ];
      expect(deduplicarPessoas(linhas).length, 1);
    });

    test('mesma foto http junta; foto não-http não junta', () {
      final http = [
        {'nome': 'A', 'foto_pessoa': 'https://x/y.jpg'},
        {'nome': 'B', 'photo': 'https://x/y.jpg'},
      ];
      expect(deduplicarPessoas(http).length, 1);

      final local = [
        {'nome': 'A', 'foto_pessoa': '/data/y.jpg'},
        {'nome': 'B', 'foto_pessoa': '/data/y.jpg'},
      ];
      expect(deduplicarPessoas(local).length, 2);
    });

    test('pessoas diferentes continuam separadas', () {
      final linhas = [
        {'nome': 'A', 'doc_identificacao': '1111'},
        {'nome': 'B', 'doc_identificacao': '2222'},
        {'nome': 'C'},
      ];
      expect(deduplicarPessoas(linhas).length, 3);
    });

    test('lista vazia resulta em zero', () {
      expect(deduplicarPessoas(const []), isEmpty);
    });

    test('completa foto e documento faltantes sem alterar a entrada', () {
      final primeira = {'nome': 'Rita', 'doc_identificacao': ''};
      final segunda = {
        'nome': 'rita',
        'doc_identificacao': '987654',
        'foto_pessoa': 'https://x/rita.jpg',
      };
      final r = deduplicarPessoas([primeira, segunda]);
      expect(r.length, 1);
      expect(r.first['foto_pessoa'], 'https://x/rita.jpg');
      expect(r.first['photo'], 'https://x/rita.jpg');
      expect(r.first['doc_identificacao'], '987654');
      expect(primeira['doc_identificacao'], '');
      expect(primeira.containsKey('foto_pessoa'), isFalse);
    });
  });
}
