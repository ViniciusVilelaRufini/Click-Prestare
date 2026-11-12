import 'package:click/pages/shared/ocorrencias/ocorrencia_form_utils.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/localizable/localizable_al.dart';
import 'package:click/utils/localizable/localizable_en_us.dart';
import 'package:click/utils/localizable/localizable_es.dart';
import 'package:click/utils/localizable/localizable_pt_br.dart';
import 'package:click/utils/localizable/localizable_pt_pt.dart';
import 'package:flutter_test/flutter_test.dart';

/// Tela de edição da ocorrência: `fileFromImageUrl` sempre devolve null e
/// `''.split(';')` dá `['']`, então a lista de anexos recebia null e o
/// `uploadFile` estourava (tela vermelha); ao salvar, `convertToBase64(null)`
/// devolvia null e `List<String>.add(null)` lançava.
void main() {
  group('contarAnexos', () {
    test('conta só as partes não vazias', () {
      expect(contarAnexos('https://a/1.jpg;https://a/2.jpg'), 2);
      expect(contarAnexos('https://a/1.jpg;; ;'), 1);
    });

    test('vazio, nulo ou outro tipo: zero', () {
      expect(contarAnexos(''), 0);
      expect(contarAnexos(null), 0);
      expect(contarAnexos(42), 0);
    });
  });

  group('anexosParaEnvio', () {
    test('ignora arquivo nulo e conversão que devolve nulo', () {
      final enviados = anexosParaEnvio(
        [null, 'a', 'falha', 'b'],
        (f) => f == 'falha' ? null : 'data:image/png;base64,$f',
      );
      expect(enviados, ['data:image/png;base64,a', 'data:image/png;base64,b']);
    });

    test('lista só de nulos vira lista vazia (o servidor mantém os anexos atuais)', () {
      expect(anexosParaEnvio([null, null], (f) => 'x'), isEmpty);
    });
  });

  group('validarDescricaoOcorrencia', () {
    test('só espaços: "Descrição é obrigatória."', () {
      expect(validarDescricaoOcorrencia('   \n '), 'Descrição é obrigatória.');
      expect(validarDescricaoOcorrencia(''), 'Descrição é obrigatória.');
    });

    test('com texto: sem erro', () {
      expect(validarDescricaoOcorrencia('  Vazamento  '), isNull);
    });
  });

  group('aviso de anexos mantidos', () {
    test('singular e plural', () {
      expect(avisoAnexosMantidos(1), '1 anexo atual será mantido se você não enviar novos.');
      expect(avisoAnexosMantidos(3), '3 anexos atuais serão mantidos se você não enviar novos.');
    });
  });

  group('título da edição (ocorrencia_nav_edit)', () {
    String texto(List<LocalizableModel> lista) =>
        lista.firstWhere((m) => m.key == 'ocorrencia_nav_edit').text;

    test('cada idioma diz "Editar Ocorrência", não "Selecione o tipo"', () {
      expect(texto(Localizable_PtBr().strings), 'Editar Ocorrência');
      expect(texto(Localizable_PtPt().strings), 'Editar Ocorrência');
      expect(texto(Localizable_EnUs().strings), 'Edit Incident');
      expect(texto(Localizable_Es().strings), 'Editar Ocurrencia');
      expect(texto(Localizable_Al().strings), 'Vorkommnis bearbeiten');
    });
  });
}
