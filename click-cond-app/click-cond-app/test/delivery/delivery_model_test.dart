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

  group('pedido do entregador no portão', () {
    test('lê pedido_portao e origem da lista do morador', () {
      final aviso = DeliveryModel.fromJson({
        'id': 7,
        'status': 'AGUARDANDO_AUTORIZACAO',
        'origem': 'autoatendimento',
        'pedido_portao': {
          'nome': 'Carlos',
          'plataforma': 'iFood',
          'foto': 'https://bucket/delivery-portao/a.jpg?assinado=1',
          'status': 'pendente',
          'portao': 'Portão social',
          'aberto_em': null,
          'saida_aberta_em': null,
        },
      });

      final p = aviso.pedidoPortao!;
      expect(aviso.origem, 'autoatendimento');
      expect(p.nome, 'Carlos');
      expect(p.plataforma, 'iFood');
      expect(p.foto, 'https://bucket/delivery-portao/a.jpg?assinado=1');
      expect(p.status, 'pendente');
      expect(p.portao, 'Portão social');
      expect(p.pendente, isTrue);
      expect(aviso.respondeNoPortao, isTrue);
    });

    test('sem pedido_portao (ou nulo) o modelo fica como antes', () {
      final semChave = DeliveryModel.fromJson({'id': 7, 'status': 'AGUARDANDO_AUTORIZACAO'});
      final nulo = DeliveryModel.fromJson({'id': 7, 'status': 'AGUARDANDO_AUTORIZACAO', 'pedido_portao': null});

      expect(semChave.pedidoPortao, isNull);
      expect(nulo.pedidoPortao, isNull);
      expect(semChave.respondeNoPortao, isFalse);
      expect(semChave.canRespond, isTrue);
    });

    test('pedido que já não está pendente não oferece as respostas do portão', () {
      for (final status in ['liberado', 'vou_buscar', 'recusado', 'expirado']) {
        final aviso = DeliveryModel.fromJson({
          'id': 7,
          'status': 'AGUARDANDO_AUTORIZACAO',
          'pedido_portao': {'nome': 'Carlos', 'status': status, 'portao': 'Portão'},
        });
        expect(aviso.pedidoPortao!.pendente, isFalse, reason: status);
        expect(aviso.respondeNoPortao, isFalse, reason: status);
      }
    });

    test('pedido pendente fora de AGUARDANDO_AUTORIZACAO não oferece as respostas', () {
      final aviso = DeliveryModel.fromJson({
        'id': 7,
        'status': 'CHEGOU',
        'pedido_portao': {'nome': 'Carlos', 'status': 'pendente', 'portao': 'Portão'},
      });
      expect(aviso.respondeNoPortao, isFalse);
    });

    test('foto vazia vira nula e campos ausentes não quebram', () {
      final p = DeliveryPedidoPortao.fromJson({'status': 'pendente', 'foto': '  '});
      expect(p.foto, isNull);
      expect(p.nome, '');
      expect(p.portao, '');
      expect(p.plataforma, isNull);
    });

    test('não materializa a selfie em toResidentJson', () {
      final aviso = DeliveryModel.fromJson({
        'id': 7,
        'status': 'AGUARDANDO_AUTORIZACAO',
        'pedido_portao': {'nome': 'Carlos', 'status': 'pendente', 'portao': 'Portão', 'foto': 'x'},
      });
      expect(aviso.toResidentJson().containsKey('pedido_portao'), isFalse);
    });
  });
}
