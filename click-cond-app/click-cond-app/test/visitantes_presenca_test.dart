import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/visitantes_presenca.dart';

/// "Está no prédio" e "pode entrar no prédio" não são a mesma coisa.
///
/// O app contava as duas na mesma aba, rotulada "No Local / Ativos". Como
/// todo visitante nasce com `liberado = 1` — default da tabela, necessário
/// para o PIN funcionar —, a regra de autorização capturava praticamente todo
/// mundo que ainda não tinha saído. O síndico via "1 no local" com o prédio
/// vazio.
///
/// É a lista que alguém consulta numa evacuação. Estes testes existem para
/// ela não voltar a contar autorização como presença.
void main() {
  final agora = DateTime(2026, 9, 11, 14, 0);

  group('estaNoLocal', () {
    test('entrou e não saiu', () {
      expect(estaNoLocal({'data_entrada': '2026-09-11T09:00:00', 'data_saida': null}), isTrue);
    });

    test('entrou e já saiu', () {
      expect(
        estaNoLocal({'data_entrada': '2026-09-11T09:00:00', 'data_saida': '2026-09-11T11:00:00'}),
        isFalse,
      );
    });

    test('autorizado mas sem entrada NÃO está no local — o bug original', () {
      // Exatamente o registro que o convite cria: liberado=1, data_entrada
      // nula. Ele aparecia como "No Local".
      expect(estaNoLocal({'liberado': 1, 'data_entrada': null, 'data_saida': null}), isFalse);
    });

    test('vaga liberada também não implica presença', () {
      expect(estaNoLocal({'vaga': 3, 'data_entrada': null, 'data_saida': null}), isFalse);
    });
  });
}
