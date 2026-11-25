import 'package:click/services/destino_push.dart';
import 'package:flutter_test/flutter_test.dart';

/// F9/F10/F11: o toque no push precisa abrir a tela do assunto. Vários tipos
/// que a API manda caíam no `default` e o app só abria na tela inicial; o
/// push comum do delivery nem tem `type`.
void main() {
  group('tipoDoPush', () {
    test('usa o type quando vem', () {
      expect(tipoDoPush({'type': 'encomenda'}), 'encomenda');
    });

    test('push comum do delivery (só id_delivery/status) é delivery', () {
      expect(tipoDoPush({'id_delivery': '12', 'status': 'CHEGOU'}), 'delivery');
    });

    test('sem type e sem id_delivery: nada', () {
      expect(tipoDoPush({}), isNull);
      expect(tipoDoPush({'type': ''}), isNull);
    });
  });

  DestinoPush? destino(Map<String, dynamic> data) => destinoDoPush(tipoDoPush(data)!, data);

  test('delivery leva o condomínio do push e o id do atendimento', () {
    final d = destino({'id_delivery': '12', 'status': 'CHEGOU', 'id_condominio': '7'})!;
    expect(d.tela, TelaPush.delivery);
    expect(d.idCondominio, 7);
    expect(d.id, 12);
    expect(destino({'type': 'delivery'})!.idCondominio, isNull);
  });

  test('ocorrência com id abre o detalhe; chat abre o chat; sem id, a lista', () {
    expect(destino({'type': 'ocorrencia', 'id': '12'})!.tela, TelaPush.ocorrencia);
    expect(destino({'type': 'ocorrencia', 'id': '12'})!.id, 12);
    expect(destino({'type': 'ocorrencia_atribuida', 'id': '12'})!.tela, TelaPush.ocorrencia);
    expect(destino({'type': 'ocorrencia_chat', 'id': '12'})!.tela, TelaPush.ocorrenciaChat);
    expect(destino({'type': 'ocorrencia_chat'})!.tela, TelaPush.ocorrencias);
    expect(destino({'type': 'ocorrencia_chat', 'id_condominio': '3'})!.idCondominio, 3);
  });

  test('reservas: confirmação, status e cancelamentos abrem as reservas', () {
    for (final t in [
      'confirmacao_reserva',
      'reserva_status',
      'reserva_cancelada_confirmacao',
      'reserva_cancelada_manutencao',
    ]) {
      expect(destino({'type': t, 'id': '5'})!.tela, TelaPush.reservas, reason: t);
    }
    // A API passa a mandar o condomínio: a aba abre nele mesmo com o app fechado.
    expect(destino({'type': 'confirmacao_reserva', 'id': '5', 'id_condominio': '7'})!.idCondominio, 7);
  });

  test('comunicado, assembleia e enquete abrem o detalhe pelo id; sem id, a lista', () {
    expect(destino({'type': 'comunicado', 'id': '9'})!.tela, TelaPush.comunicado);
    expect(destino({'type': 'comunicado', 'id': '9'})!.id, 9);
    expect(destino({'type': 'comunicado'})!.tela, TelaPush.comunicados);
    expect(destino({'type': 'assembleia', 'id': '4'})!.tela, TelaPush.assembleia);
    expect(destino({'type': 'assembleia', 'id': ''})!.tela, TelaPush.assembleias);
    expect(destino({'type': 'enquete', 'id': '8'})!.tela, TelaPush.enquete);
    expect(destino({'type': 'enquete'})!.tela, TelaPush.enquetes);
  });

  test('ATA: o id é da ata, não da assembleia — abre a lista de assembleias', () {
    expect(destino({'type': 'ata', 'id': '33'})!.tela, TelaPush.assembleias);
  });

  test('os que já funcionavam continuam iguais', () {
    expect(destino({'type': 'autorizacao_visitante', 'id': '1', 'id_condominio': '42'})!.tela, TelaPush.pendentes);
    expect(destino({'type': 'autorizacao_visitante', 'id_condominio': '42'})!.idCondominio, 42);
    expect(destino({'type': 'visitante'})!.tela, TelaPush.historicoAcessos);
    expect(destino({'type': 'visitante_acesso'})!.tela, TelaPush.historicoAcessos);
    expect(destino({'type': 'encomenda', 'id': '3'})!.tela, TelaPush.encomendas);
    expect(destino({'type': 'encomenda', 'id': '3'})!.id, 3);
    expect(destino({'type': 'financeiro', 'id_condominio': '42'})!.idCondominio, 42);
    expect(destino({'type': 'convite_visita'})!.tela, TelaPush.convites);
  });

  test('tipo desconhecido não navega', () {
    expect(destinoDoPush('ping', {}), isNull);
    expect(destinoDoPush('morador', {}), isNull);
  });
}
