import 'package:click/pages/shared/visitantes/compartilhar_passe.dart';
import 'package:flutter_test/flutter_test.dart';

/// Ao cadastrar um visitante, o diálogo "Liberação Gerada!" mandava pelo
/// WhatsApp o convite antigo (só o PIN). O convite do cadastro tem de levar o
/// link do passe, como o "Compartilhar passe" do detalhe já leva.
void main() {
  const url = 'https://www.prestarecondominios.com.br/#passe=1b.assinatura';
  late List<int> pedidos;

  setUp(() {
    pedidos = [];
    CompartilharPasse.pedirLink = (id) async {
      pedidos.add(id);
      return {'url': url, 'valido_ate': null};
    };
  });

  test('o convite do cadastro pede o link da visita recém-criada e o inclui', () async {
    // Resposta do POST /visitantes/insert (sem bloco/apto nem nome do morador).
    final resposta = {
      'id': 1000057,
      'nome': 'Marina Oliveira',
      'is_prestador': 0,
      'codigo_acesso': '637981',
      'data_hora_inicio': '2026-11-14T22:13:00.000Z',
      'data_hora_termino': '2026-11-15T22:13:00.000Z',
    };
    final item = CompartilharPasse.itemDoCadastro(
      resposta,
      bloco: 'A',
      apartamento: '106',
      morador: 'Vinicius',
      condominio: 'Boa vista',
    );

    final texto = await CompartilharPasse.mensagem(item);

    expect(pedidos, [1000057]);
    expect(texto, contains(url));
    expect(texto, contains('637-981'));
    expect(texto, contains('Boa vista'));
    expect(texto, contains('106'));
    expect(texto, contains('Vinicius'));
  });

  test('sem id na resposta, o convite sai só com o PIN, sem pedir link', () async {
    final item = CompartilharPasse.itemDoCadastro(
      {'codigo_acesso': '637981', 'nome': 'Marina'},
      bloco: 'A',
      apartamento: '106',
      morador: 'Vinicius',
      condominio: 'Boa vista',
    );

    final texto = await CompartilharPasse.mensagem(item);

    expect(pedidos, isEmpty);
    expect(texto, contains('637-981'));
    expect(texto, isNot(contains('#passe=')));
  });
}
