import 'package:click/pages/shared/assembleias/assembleia_helpers.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final agora = DateTime(2026, 10, 6, 15, 30);

  group('dataHoraAssembleia', () {
    test('data e hora', () => expect(dataHoraAssembleia('20/10/2026', '19:30'), '20/10/2026 às 19:30'));
    test('só data', () => expect(dataHoraAssembleia('20/10/2026', ''), '20/10/2026'));
    test('só hora', () => expect(dataHoraAssembleia(null, '19:30'), '19:30'));
    test('nada', () => expect(dataHoraAssembleia(null, 'null'), ''));
  });

  group('dataHoraExtensoAssembleia', () {
    test('por extenso com hora',
        () => expect(dataHoraExtensoAssembleia('11/10/2026', '19:30'), 'Domingo, 11 de outubro de 2026 às 19:30'));
    test('por extenso sem hora', () => expect(dataHoraExtensoAssembleia('11/10/2026', ''), 'Domingo, 11 de outubro de 2026'));
    test('data inválida volta como veio', () => expect(dataHoraExtensoAssembleia('amanhã', '10:00'), 'amanhã às 10:00'));
  });

  group('quandoAssembleia', () {
    test('hoje', () => expect(quandoAssembleia('06/10/2026', agora: agora), 'Hoje'));
    test('amanhã', () => expect(quandoAssembleia('07/10/2026', agora: agora), 'Amanhã'));
    test('em N dias', () => expect(quandoAssembleia('16/10/2026', agora: agora), 'Em 10 dias'));
    test('passada → vazio', () => expect(quandoAssembleia('05/10/2026', agora: agora), ''));
    test('inválida → vazio', () => expect(quandoAssembleia('', agora: agora), ''));
  });

  group('assembleiaPassou / mesCurto', () {
    test('ontem passou, hoje não', () {
      expect(assembleiaPassou('05/10/2026', agora: agora), isTrue);
      expect(assembleiaPassou('06/10/2026', agora: agora), isFalse);
      expect(assembleiaPassou(null, agora: agora), isFalse);
    });
    test('sigla do mês', () {
      expect(mesCurtoAssembleia(DateTime(2026, 5, 20)), 'MAI');
      expect(mesCurtoAssembleia(null), '');
    });
  });
}
