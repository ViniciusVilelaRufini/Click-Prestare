import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/localizable/localizable_al.dart';
import 'package:click/utils/localizable/localizable_en_us.dart';
import 'package:click/utils/localizable/localizable_es.dart';
import 'package:click/utils/localizable/localizable_pt_br.dart';
import 'package:click/utils/localizable/localizable_pt_pt.dart';
import 'package:flutter_test/flutter_test.dart';

/// Duas falhas distintas do i18n, cobertas juntas porque uma esconde a outra.
///
/// 1. `getText` fazia `.where(...).first` e, no StateError da chave ausente,
///    devolvia STRING VAZIA. Em inglês e alemão faltavam ~10 chaves da tela
///    "Meu Apartamento": títulos, botões e mensagens renderizavam em branco,
///    sem erro, sem log, sem nada que indicasse o que aconteceu.
///
/// 2. As listas eram mantidas à mão, sem nenhuma verificação de sincronia —
///    por isso as chaves sumiram sem ninguém notar, e por isso alguém chegou a
///    traduzir o IDENTIFICADOR `dias` para `days`/`días`/`Tage`.
void main() {
  group('resolverTexto', () {
    final idioma = {'lb_ok': 'OK', 'lb_vazio': ''};
    final padrao = {'lb_ok': 'Certo', 'lb_vazio': 'Tem texto', 'lb_so_no_padrao': 'Padrão'};

    test('usa o texto do idioma escolhido', () {
      expect(resolverTexto('lb_ok', idioma, padrao), 'OK');
    });

    test('cai no pt_BR quando a chave falta no idioma (o bug do texto em branco)', () {
      expect(resolverTexto('lb_so_no_padrao', idioma, padrao), 'Padrão');
    });

    /// Devolver a chave é feio, mas é visível: alguém percebe "lb_inexistente"
    /// na tela e conserta. String vazia ninguém percebe.
    test('devolve a própria chave quando falta nos dois, nunca string vazia', () {
      expect(resolverTexto('lb_inexistente', idioma, padrao), 'lb_inexistente');
    });

    test('tradução vazia também cai no fallback', () {
      expect(resolverTexto('lb_vazio', idioma, padrao), 'Tem texto');
    });

    test('resolve o rótulo do botão de nova reserva', () {
      final ptBr = indiceDe(Localizable_PtBr().strings);
      expect(resolverTexto('nova_reserva', ptBr, ptBr), 'Nova reserva');
    });
  });

  group('indiceDe', () {
    test('indexa por chave', () {
      final i = indiceDe([
        LocalizableModel(key: 'a', text: 'A'),
        LocalizableModel(key: 'b', text: 'B'),
      ]);
      expect(i['a'], 'A');
      expect(i['b'], 'B');
    });

    /// As listas têm chaves duplicadas (`email` e `senha` aparecem duas vezes
    /// em todos os idiomas). O `.first` de antes pegava a primeira; manter
    /// isso evita mudar texto de tela sem querer.
    test('chave duplicada mantém a primeira ocorrência', () {
      final i = indiceDe([
        LocalizableModel(key: 'email', text: 'E-mail'),
        LocalizableModel(key: 'email', text: 'Email duplicado'),
      ]);
      expect(i['email'], 'E-mail');
    });
  });

  group('sincronia entre os idiomas', () {
    final idiomas = {
      'pt_PT': indiceDe(Localizable_PtPt().strings),
      'en_US': indiceDe(Localizable_EnUs().strings),
      'es': indiceDe(Localizable_Es().strings),
      'de': indiceDe(Localizable_Al().strings),
    };
    final ptBr = indiceDe(Localizable_PtBr().strings);

    for (final entry in idiomas.entries) {
      test('${entry.key} tem todas as chaves do pt_BR', () {
        final faltando = ptBr.keys.where((k) => !entry.value.containsKey(k)).toList()..sort();
        expect(faltando, isEmpty, reason: 'chaves sem tradução em ${entry.key}: $faltando');
      });

      /// Chave órfã denuncia identificador traduzido por engano — foi assim
      /// que `dias` virou `days`, `días` e `Tage`.
      test('${entry.key} não tem chave que o pt_BR desconhece', () {
        final orfas = entry.value.keys.where((k) => !ptBr.containsKey(k)).toList()..sort();
        expect(orfas, isEmpty, reason: 'chaves órfãs em ${entry.key}: $orfas');
      });
    }
  });
}
