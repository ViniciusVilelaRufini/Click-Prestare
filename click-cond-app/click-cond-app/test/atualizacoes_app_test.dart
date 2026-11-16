import 'package:click/services/atualizacoes_app.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('dominioDoPush', () {
    final casos = <Map<String, dynamic>, DominioApp?>{
      {'type': 'card_portaria', 'origem': 'delivery'}: DominioApp.delivery,
      {'type': 'card_portaria', 'origem': 'visita'}: DominioApp.visitante,
      {'type': 'card_portaria'}: DominioApp.visitante,
      {'type': 'autorizacao_visitante'}: DominioApp.visitante,
      {'type': 'visitante'}: DominioApp.visitante,
      {'type': 'visitante_acesso'}: DominioApp.visitante,
      {'type': 'ocorrencia'}: DominioApp.ocorrencia,
      {'type': 'ocorrencia_chat'}: DominioApp.ocorrencia,
      {'type': 'reserva_status'}: DominioApp.reserva,
      {'type': 'confirmacao_reserva'}: DominioApp.reserva,
      {'type': 'encomenda'}: DominioApp.encomenda,
      {'type': 'comunicado'}: DominioApp.comunicado,
      {'type': 'enquete'}: DominioApp.enquete,
      {'type': 'assembleia'}: DominioApp.enquete,
      {'type': 'tipo_que_nao_existe'}: null,
      {}: null,
    };

    casos.forEach((data, esperado) {
      test('$data → $esperado', () {
        expect(dominioDoPush(data), esperado);
      });
    });
  });

  group('ouvirAtualizacoes', () {
    test('chama só para o domínio assinado ou "tudo", e para depois do cancel', () async {
      var chamadas = 0;
      final sub = ouvirAtualizacoes({DominioApp.delivery}, () => chamadas++);

      AtualizacoesApp.avisar(DominioApp.comunicado);
      await Future<void>.delayed(Duration.zero);
      expect(chamadas, 0);

      AtualizacoesApp.avisar(DominioApp.delivery);
      await Future<void>.delayed(Duration.zero);
      expect(chamadas, 1);

      AtualizacoesApp.avisar(DominioApp.tudo);
      await Future<void>.delayed(Duration.zero);
      expect(chamadas, 2);

      await sub.cancel();
      AtualizacoesApp.avisar(DominioApp.delivery);
      AtualizacoesApp.avisar(DominioApp.tudo);
      await Future<void>.delayed(Duration.zero);
      expect(chamadas, 2);
    });

    test('várias telas ouvem ao mesmo tempo (broadcast)', () async {
      var a = 0, b = 0;
      final s1 = ouvirAtualizacoes({DominioApp.reserva}, () => a++);
      final s2 = ouvirAtualizacoes({DominioApp.reserva, DominioApp.visitante}, () => b++);

      AtualizacoesApp.avisar(DominioApp.reserva);
      AtualizacoesApp.avisar(DominioApp.visitante);
      await Future<void>.delayed(Duration.zero);
      expect(a, 1);
      expect(b, 2);

      await s1.cancel();
      await s2.cancel();
    });
  });
  group('ObservadorVoltaAoApp', () {
    test('emite "tudo" uma vez ao voltar do segundo plano, não ao sair de inactive', () async {
      final recebidos = <DominioApp>[];
      final sub = AtualizacoesApp.stream.listen(recebidos.add);
      final obs = ObservadorVoltaAoApp();

      // Cortina de notificações / diálogo da biometria: só inactive.
      obs.didChangeAppLifecycleState(AppLifecycleState.inactive);
      obs.didChangeAppLifecycleState(AppLifecycleState.resumed);
      await Future<void>.delayed(Duration.zero);
      expect(recebidos, isEmpty);

      obs.didChangeAppLifecycleState(AppLifecycleState.inactive);
      obs.didChangeAppLifecycleState(AppLifecycleState.hidden);
      obs.didChangeAppLifecycleState(AppLifecycleState.paused);
      obs.didChangeAppLifecycleState(AppLifecycleState.hidden);
      obs.didChangeAppLifecycleState(AppLifecycleState.inactive);
      obs.didChangeAppLifecycleState(AppLifecycleState.resumed);
      await Future<void>.delayed(Duration.zero);
      expect(recebidos, [DominioApp.tudo]);

      await sub.cancel();
    });
  });
}
