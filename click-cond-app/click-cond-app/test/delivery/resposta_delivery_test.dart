import 'package:click/models/delivery_model.dart';
import 'package:click/pages/shared/delivery/resposta_delivery.dart';
import 'package:flutter_test/flutter_test.dart';

/// Texto do aviso depois da resposta: "Autorizar" num aviso "Na portaria"
/// é gravado como RETIRADA_NA_PORTARIA, e o texto acompanha o status que a
/// API devolveu.
void main() {
  const aguardando = DeliveryModel(id: 1, status: 'AGUARDANDO_AUTORIZACAO', modoEntrega: 'PORTARIA');

  test('autorizar gravado como RETIRADA_NA_PORTARIA → "Combinado: a entrega fica na portaria."', () {
    expect(
      mensagemRespostaDelivery(aguardando, RespostaDelivery.autorizar, statusGravado: 'RETIRADA_NA_PORTARIA'),
      'Combinado: a entrega fica na portaria.',
    );
  });

  test('autorizar gravado como AUTORIZADA (ou sem status) → "Entrega autorizada."', () {
    expect(mensagemRespostaDelivery(aguardando, RespostaDelivery.autorizar, statusGravado: 'AUTORIZADA'),
        'Entrega autorizada.');
    expect(mensagemRespostaDelivery(aguardando, RespostaDelivery.autorizar), 'Entrega autorizada.');
  });

  test('recusar e vou buscar não mudam', () {
    expect(mensagemRespostaDelivery(aguardando, RespostaDelivery.recusar, statusGravado: 'RECUSADA'), 'Entrega recusada.');
    expect(mensagemRespostaDelivery(aguardando, RespostaDelivery.vouBuscar, statusGravado: 'RETIRADA_NA_PORTARIA'),
        'Avisamos o entregador que você vai buscar.');
  });

  test('mensagemAutorizacaoDelivery (card do Android)', () {
    expect(mensagemAutorizacaoDelivery('RETIRADA_NA_PORTARIA'), 'Combinado: a entrega fica na portaria.');
    expect(mensagemAutorizacaoDelivery('AUTORIZADA'), 'Entrega autorizada.');
    expect(mensagemAutorizacaoDelivery(null), 'Entrega autorizada.');
  });
}
