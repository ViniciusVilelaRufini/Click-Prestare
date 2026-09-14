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
}
