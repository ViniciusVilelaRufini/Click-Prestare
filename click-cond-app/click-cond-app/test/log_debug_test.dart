import 'package:click/utils/log.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

/// `print()` NÃO é removido no build de release do Android: tudo continua indo
/// para o logcat, legível por ferramentas de diagnóstico e por bug reports.
///
/// Os controllers despejavam ali o corpo inteiro das respostas — a lista de
/// visitantes, por exemplo, carrega nome, doc_identificacao (CPF/RG),
/// codigo_acesso (o PIN da portaria) e foto_pessoa (biometria). Isso é dado
/// pessoal sensível saindo de qualquer controle, sem finalidade.
void main() {
  final linhas = <String>[];

  setUp(() {
    linhas.clear();
    logDebugSaida = linhas.add;
  });

  tearDown(() {
    logDebugSaida = null;
  });

  test('em debug, escreve a mensagem', () {
    logDebug('[apiGetAllVisitantes] status 200');
    // O teste roda em modo debug; em release a saída é suprimida.
    expect(kDebugMode, isTrue, reason: 'flutter test roda em debug');
    expect(linhas, ['[apiGetAllVisitantes] status 200']);
  });

  test('não escreve nada quando a mensagem é vazia', () {
    logDebug('');
    expect(linhas, isEmpty);
  });

  /// A mensagem é montada preguiçosamente: em release, nem o custo de
  /// interpolar o corpo da resposta deve ser pago.
  test('não avalia a mensagem quando o log está desligado', () {
    logDebugHabilitado = false;
    addTearDown(() => logDebugHabilitado = true);

    var avaliou = false;
    logDebugLazy(() {
      avaliou = true;
      return 'corpo gigante';
    });

    expect(avaliou, isFalse);
    expect(linhas, isEmpty);
  });

  test('avalia e escreve quando o log está ligado', () {
    logDebugLazy(() => 'detalhe caro');
    expect(linhas, ['detalhe caro']);
  });
}
