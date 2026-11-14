import 'package:click/controllers/controller_delivery.dart';
import 'package:click/models/delivery_model.dart';

/// Respostas do morador a um delivery que aguarda autorização. "Vou buscar"
/// só existe no pedido do entregador pelo QR do portão.
enum RespostaDelivery { autorizar, vouBuscar, recusar }

/// Envia a resposta pela rota certa (detalhes e lista usam a mesma).
Future<DeliveryResult> enviarRespostaDelivery(DeliveryModel delivery, RespostaDelivery resposta) {
  switch (resposta) {
    case RespostaDelivery.autorizar:
      return apiResponderDelivery(delivery, autorizar: true);
    case RespostaDelivery.vouBuscar:
      return apiVouBuscarDelivery(delivery);
    case RespostaDelivery.recusar:
      return apiResponderDelivery(delivery, autorizar: false);
  }
}

/// Texto do aviso depois que a API aceitou a resposta.
String mensagemRespostaDelivery(DeliveryModel delivery, RespostaDelivery resposta) {
  switch (resposta) {
    case RespostaDelivery.autorizar:
      return delivery.respondeNoPortao ? 'Entrada liberada.' : 'Entrega autorizada.';
    case RespostaDelivery.vouBuscar:
      return 'Avisamos o entregador que você vai buscar.';
    case RespostaDelivery.recusar:
      return 'Entrega recusada.';
  }
}

/// Confirmação antes de recusar: no portão quem fica sabendo é o entregador.
String textoConfirmarRecusa(DeliveryModel delivery) => delivery.respondeNoPortao
    ? 'Recusar esta entrega? O entregador será avisado.'
    : 'Recusar esta entrega? A portaria será avisada.';
