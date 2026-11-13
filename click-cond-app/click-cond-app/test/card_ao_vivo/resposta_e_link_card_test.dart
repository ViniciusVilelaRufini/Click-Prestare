import 'package:click/services/card_ao_vivo/card_android.dart';
import 'package:click/services/card_ao_vivo/link_card.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('RECUSAR recusado pelo servidor: só 400/409 fecham o card; sem rede ou 401 ele fica', () {
    expect(respostaRecusadaFechaCard(400), isTrue);
    expect(respostaRecusadaFechaCard(409), isTrue);
    expect(respostaRecusadaFechaCard(null), isFalse); // sem rede / timeout
    expect(respostaRecusadaFechaCard(401), isFalse);
    expect(respostaRecusadaFechaCard(500), isFalse);
  });

  test('toque no card do iPhone abre a tela certa', () {
    expect(telaDoLinkCard(Uri.parse('clickprestare://solicitacoes')), 'autorizacao_visitante');
    expect(telaDoLinkCard(Uri.parse('clickprestare://delivery')), 'delivery');
    expect(telaDoLinkCard(Uri.parse('clickprestare://redefinir-senha?token=x')), isNull);
    expect(telaDoLinkCard(Uri.parse('https://delivery')), isNull);
  });
}
