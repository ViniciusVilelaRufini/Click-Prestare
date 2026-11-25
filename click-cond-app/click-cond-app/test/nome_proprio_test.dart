import 'package:click/utils/nome_proprio.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('nulo e vazio viram texto vazio', () {
    expect(nomeProprio(null), '');
    expect(nomeProprio(''), '');
    expect(nomeProprio('   '), '');
  });

  test('tudo maiúsculo vira nome próprio', () {
    expect(nomeProprio('VINICIUS VILELA RUFINI'), 'Vinicius Vilela Rufini');
  });

  test('já normal permanece', () {
    expect(nomeProprio('Vinicius Familia'), 'Vinicius Familia');
  });

  test('partículas ficam em minúsculas, menos na primeira palavra', () {
    expect(nomeProprio('MARIA DA SILVA E SOUZA'), 'Maria da Silva e Souza');
    expect(nomeProprio('joão dos santos de oliveira'), 'João dos Santos de Oliveira');
    expect(nomeProprio('DE SOUZA'), 'De Souza');
  });

  test('acentos, hífen, apóstrofo e espaços repetidos', () {
    expect(nomeProprio('ÁLVARO  D\'ÁVILA'), 'Álvaro D\'Ávila');
    expect(nomeProprio('ana-maria LIMA'), 'Ana-Maria Lima');
  });
}
