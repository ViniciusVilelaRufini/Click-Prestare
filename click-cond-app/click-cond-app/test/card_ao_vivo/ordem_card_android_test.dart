import 'dart:async';

import 'package:click/services/card_ao_vivo/card_android.dart';
import 'package:click/utils/fila_por_chave.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  /// A8: dois pushes do mesmo card rodavam em paralelo e o mais lento vencia
  /// (o `encerrado` cancelava antes de o `show` do `aguardando` sair).
  group('FilaPorChave', () {
    test('tarefas da mesma chave rodam na ordem de chegada, mesmo a primeira sendo lenta', () async {
      final fila = FilaPorChave<int>();
      final ordem = <String>[];
      final lenta = Completer<void>();
      final a = fila.rodar(1, () async {
        await lenta.future;
        ordem.add('aguardando');
      });
      final b = fila.rodar(1, () async => ordem.add('encerrado'));
      await Future<void>.delayed(Duration.zero);
      expect(ordem, isEmpty, reason: 'a segunda espera a primeira');
      lenta.complete();
      await Future.wait([a, b]);
      expect(ordem, ['aguardando', 'encerrado']);
      expect(fila.chavesAtivas, 0);
    });

    test('chaves diferentes não esperam uma pela outra', () async {
      final fila = FilaPorChave<int>();
      final ordem = <int>[];
      final lenta = Completer<void>();
      final a = fila.rodar(1, () async {
        await lenta.future;
        ordem.add(1);
      });
      await fila.rodar(2, () async => ordem.add(2));
      expect(ordem, [2]);
      lenta.complete();
      await a;
      expect(ordem, [2, 1]);
    });

    test('falha não vaza e não trava a próxima da mesma chave', () async {
      final erros = <Object>[];
      final fila = FilaPorChave<int>(aoFalhar: (e, _) => erros.add(e));
      var rodou = false;
      await fila.rodar(1, () async => throw StateError('plugin'));
      await fila.rodar(1, () async => rodou = true);
      expect(erros, hasLength(1));
      expect(rodou, isTrue);
    });
  });

  /// F16: o FCM não garante ordem. Um `aguardando` atrasado depois de
  /// `liberado`/`encerrado` ressuscitava AUTORIZAR/NEGAR por até 10 min.
  group('faseCardAvanca (portaria)', () {
    test('sem card na tela, qualquer fase entra', () {
      expect(faseCardAvanca(null, 'aguardando', origem: 'visita'), isTrue);
      expect(faseCardAvanca(null, 'liberado', origem: 'visita'), isTrue);
    });

    test('para frente entra; repetir a mesma fase também (atualização)', () {
      expect(faseCardAvanca('aguardando', 'liberado', origem: 'visita'), isTrue);
      expect(faseCardAvanca('liberado', 'entrou', origem: 'visita'), isTrue);
      expect(faseCardAvanca('aguardando', 'aguardando', origem: 'visita'), isTrue);
      expect(faseCardAvanca('aguardando', 'encerrado', origem: 'visita'), isTrue);
    });

    test('não volta de fase final para aguardando, nem de entrou para liberado', () {
      for (final fim in ['liberado', 'negado', 'expirado', 'entrou']) {
        expect(faseCardAvanca(fim, 'aguardando', origem: 'visitante'), isFalse, reason: fim);
      }
      expect(faseCardAvanca('entrou', 'liberado', origem: 'visita'), isFalse);
    });

    test('encerrado é o fim: nada depois dele', () {
      expect(faseCardAvanca('encerrado', 'aguardando', origem: 'visita'), isFalse);
      expect(faseCardAvanca('encerrado', 'liberado', origem: 'visita'), isFalse);
      expect(faseCardAvanca('encerrado', 'encerrado', origem: 'visita'), isFalse);
    });
  });

  /// O delivery vai e volta entre autorizado e retirar (o entregador pede no
  /// portão depois de o morador dizer "vou buscar"): só o fim é definitivo.
  group('faseCardAvanca (delivery)', () {
    test('idas e voltas do meio do atendimento entram', () {
      expect(faseCardAvanca('chegou', 'aguardando', origem: 'delivery'), isTrue);
      expect(faseCardAvanca('retirar', 'autorizado', origem: 'delivery'), isTrue);
      expect(faseCardAvanca('autorizado', 'retirar', origem: 'delivery'), isTrue);
      expect(faseCardAvanca('retirar', 'aguardando', origem: 'delivery'), isTrue);
    });

    test('depois de entregue, recusado ou encerrado não volta', () {
      for (final fim in ['entregue', 'recusado', 'encerrado']) {
        expect(faseCardAvanca(fim, 'aguardando', origem: 'delivery'), isFalse, reason: fim);
        expect(faseCardAvanca(fim, 'chegou', origem: 'delivery'), isFalse, reason: fim);
      }
      expect(faseCardAvanca('recusado', 'encerrado', origem: 'delivery'), isTrue);
    });

    test('a confirmação do servidor da mesma fase final entra (RECUSAR mostrado na hora)', () {
      expect(faseCardAvanca('recusado', 'recusado', origem: 'delivery'), isTrue);
      expect(faseCardAvanca('negado', 'negado', origem: 'visita'), isTrue);
    });
  });
}
