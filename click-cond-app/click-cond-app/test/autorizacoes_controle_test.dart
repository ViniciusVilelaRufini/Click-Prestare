import 'package:click/utils/autorizacoes_controle.dart';
import 'package:flutter_test/flutter_test.dart';

/// O pedido de autorização chega por DUAS superfícies ao mesmo tempo: o push
/// (que abre um diálogo por cima de qualquer tela) e a PendentesVisitantePage,
/// que faz poll a cada 10s. Nenhuma das duas sabia da outra.
///
/// Os três jeitos de isso dar errado, todos com o visitante esperando no
/// portão enquanto o porteiro não recebe resposta:
///   - o FCM reentrega a mesma mensagem e abre um segundo diálogo idêntico;
///   - dois visitantes chegam juntos e os diálogos se empilham;
///   - o morador decide pelo diálogo e a página decide de novo pelo mesmo id.
void main() {
  late ControleAutorizacoes controle;

  setUp(() => controle = ControleAutorizacoes());

  test('o primeiro pedido pode abrir', () {
    expect(controle.podeAbrirDialogo(10), isTrue);
  });

  test('a reentrega do mesmo push não abre um segundo diálogo', () {
    controle.abriu(10);
    expect(controle.podeAbrirDialogo(10), isFalse);
  });

  test('outro visitante não empilha diálogo sobre o aberto', () {
    controle.abriu(10);
    expect(controle.podeAbrirDialogo(99), isFalse);
  });

  test('depois de fechar sem decidir, outro pedido pode abrir', () {
    controle.abriu(10);
    controle.fechou(10);
    expect(controle.podeAbrirDialogo(99), isTrue);
  });

  /// O morador tocou "Decidir depois": a solicitação continua pendente e ele
  /// deve poder reabri-la pela tela de pendentes.
  test('fechar sem decidir não marca o id como decidido', () {
    controle.abriu(10);
    controle.fechou(10);
    expect(controle.jaDecidido(10), isFalse);
    expect(controle.podeAbrirDialogo(10), isTrue);
  });

  test('id decidido não volta a abrir', () {
    controle.abriu(10);
    controle.decidiu(10);
    expect(controle.jaDecidido(10), isTrue);
    expect(controle.podeAbrirDialogo(10), isFalse);
  });

  /// A corrida que importa: o diálogo do push e o poll da tela de pendentes
  /// respondendo o MESMO id. Quem chega primeiro decide; o segundo desiste.
  test('só a primeira superfície consegue assumir a decisão', () {
    expect(controle.assumirDecisao(10), isTrue);
    expect(controle.assumirDecisao(10), isFalse);
  });

  test('assumir a decisão de um id não bloqueia outro', () {
    expect(controle.assumirDecisao(10), isTrue);
    expect(controle.assumirDecisao(11), isTrue);
  });

  /// Se o POST falhar, o morador precisa poder tentar de novo — senão a
  /// solicitação fica travada para sempre nas duas superfícies.
  test('desistir da decisão devolve o id', () {
    controle.assumirDecisao(10);
    controle.desistiuDaDecisao(10);
    expect(controle.assumirDecisao(10), isTrue);
  });

  test('decidido de fato não é devolvido por desistência posterior', () {
    controle.assumirDecisao(10);
    controle.decidiu(10);
    controle.desistiuDaDecisao(10);
    expect(controle.jaDecidido(10), isTrue);
  });

  /// F3: a API reaproveita o id da visita quando o porteiro pede de novo para
  /// o mesmo visitante. O pedido novo tem outra rodada (auth_solicitado_em) e
  /// precisa aparecer — antes ficava invisível até reiniciar o app.
  group('rodada do pedido (id reaproveitado)', () {
    test('rodadaDoPedido lê segundos, milissegundos, texto e ISO', () {
      expect(rodadaDoPedido(1764000000), 1764000000);
      expect(rodadaDoPedido(1764000000123), 1764000000);
      expect(rodadaDoPedido('1764000000'), 1764000000);
      expect(rodadaDoPedido('2025-11-24T16:00:00.000Z'),
          DateTime.utc(2025, 11, 24, 16).millisecondsSinceEpoch ~/ 1000);
      expect(rodadaDoPedido(null), isNull);
      expect(rodadaDoPedido(''), isNull);
      expect(rodadaDoPedido('null'), isNull);
      expect(rodadaDoPedido('xyz'), isNull);
      expect(rodadaDoPedido(0), isNull);
    });

    test('pedido novo com o mesmo id volta a abrir e a aparecer', () {
      controle.decidiu(10, rodada: 1000);
      expect(controle.jaDecidido(10, rodada: 1000), isTrue);
      expect(controle.jaDecidido(10, rodada: 2000), isFalse);
      expect(controle.podeAbrirDialogo(10, rodada: 2000), isTrue);
      // Depois de renovado, a decisão velha não bloqueia mais nem sem rodada.
      expect(controle.jaDecidido(10), isFalse);
    });

    test('resposta atrasada da mesma rodada (ou mais antiga) continua decidida', () {
      controle.decidiu(10, rodada: 2000);
      expect(controle.jaDecidido(10, rodada: 2000), isTrue);
      expect(controle.jaDecidido(10, rodada: 1500), isTrue);
      expect(controle.podeAbrirDialogo(10, rodada: 2000), isFalse);
      expect(controle.assumirDecisao(10, rodada: 2000), isFalse);
    });

    test('decidido sem saber a rodada: vale o instante da decisão', () {
      controle.agora = () => DateTime.fromMillisecondsSinceEpoch(5000 * 1000);
      controle.decidiu(10);
      expect(controle.jaDecidido(10, rodada: 4000), isTrue, reason: 'pedido feito antes da decisão');
      expect(controle.jaDecidido(10, rodada: 6000), isFalse, reason: 'pedido feito depois: é outro');
    });

    test('rodada nova também libera a decisão (assumirDecisao)', () {
      controle.decidiu(10, rodada: 1000);
      expect(controle.assumirDecisao(10, rodada: 3000), isTrue);
    });
  });

  /// F13: outro morador da unidade respondeu, o prazo venceu ou a portaria
  /// encerrou: o diálogo do primeiro morador fecha sozinho.
  group('pedido encerrado por fora', () {
    test('fase final fecha o diálogo aberto e marca a rodada decidida', () {
      String? fechouCom;
      controle.abriu(10, fechar: (f) => fechouCom = f);
      controle.pedidoEncerrado(10, 'liberado', rodada: 1000);
      expect(fechouCom, 'liberado');
      expect(controle.dialogoAbertoPara(10), isFalse);
      expect(controle.jaDecidido(10, rodada: 1000), isTrue);
      expect(controle.podeAbrirDialogo(99), isTrue, reason: 'não segura outro pedido');
    });

    test('encerrado só fecha: não marca como decidido', () {
      var fechou = false;
      controle.abriu(10, fechar: (_) => fechou = true);
      controle.pedidoEncerrado(10, 'encerrado');
      expect(fechou, isTrue);
      expect(controle.jaDecidido(10), isFalse);
    });

    test('push de outro pedido não fecha o diálogo aberto', () {
      var fechou = false;
      controle.abriu(10, fechar: (_) => fechou = true);
      controle.pedidoEncerrado(11, 'negado');
      expect(fechou, isFalse);
      expect(controle.dialogoAbertoPara(10), isTrue);
    });

    test('fecharDialogoDe (AUTORIZAR pela notificação) fecha sem decidir', () {
      var fechou = false;
      controle.abriu(10, fechar: (_) => fechou = true);
      controle.fecharDialogoDe(10);
      expect(fechou, isTrue);
      expect(controle.jaDecidido(10), isFalse);
      expect(controle.assumirDecisao(10), isTrue);
    });

    test('decidir pelo próprio diálogo não chama o fechamento por fora', () {
      var fechou = false;
      controle.abriu(10, fechar: (_) => fechou = true);
      controle.assumirDecisao(10);
      controle.decidiu(10);
      controle.pedidoEncerrado(10, 'liberado');
      expect(fechou, isFalse);
    });
  });
}
