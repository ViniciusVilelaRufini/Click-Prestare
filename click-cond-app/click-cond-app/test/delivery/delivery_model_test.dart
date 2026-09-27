import 'package:click/models/delivery_model.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('serializa um novo aviso somente com os campos aceitos pela API', () {
    const aviso = DeliveryDraft(
      estabelecimento: 'Pizzaria Central',
      previsaoEm: '2026-09-27T20:30:00.000',
      observacaoMorador: 'Interfone desligado',
      nomeEntregador: '  João da Silva  ',
      telefoneEntregador: '  (11) 99999-9999  ',
      modoEntrega: DeliveryModoEntrega.portaria,
    );

    expect(aviso.toCreateJson(idCondominio: 9, idApartamento: 42), {
      'id_condominio': 9,
      'id_apartamento': 42,
      'estabelecimento': 'Pizzaria Central',
      'previsao_em': '2026-09-27T20:30:00.000',
      'observacao_morador': 'Interfone desligado',
      'nome_entregador': 'João da Silva',
      'telefone_entregador': '(11) 99999-9999',
      'modo_entrega': 'PORTARIA',
    });
  });

  test('omite nome e telefone do entregador quando estiverem em branco', () {
    const aviso = DeliveryDraft(
      nomeEntregador: '   ',
      telefoneEntregador: '',
    );

    expect(aviso.toCreateJson(idCondominio: 9, idApartamento: 42), {
      'id_condominio': 9,
      'id_apartamento': 42,
      'modo_entrega': 'UNIDADE',
    });
  });

  test('dados usados pelo morador não expõem documento ou bloqueio do entregador', () {
    final aviso = DeliveryModel.fromJson({
      'id': 7,
      'status': 'CHEGOU',
      'estabelecimento': 'Mercado',
      'entregador': {
        'id': 50,
        'nome': 'João',
        'documento': '123.456.789-00',
        'status': 'BLOQUEADO',
        'motivo_bloqueio': 'Registro interno',
      },
    });

    expect(aviso.toResidentJson(), {
      'id': 7,
      'status': 'CHEGOU',
      'estabelecimento': 'Mercado',
    });
  });
}
