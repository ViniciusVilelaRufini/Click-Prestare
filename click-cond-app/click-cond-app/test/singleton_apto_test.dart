import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:click/pages/singleton.dart';

/// Regressão: "type 'Null' is not a subtype of type 'String'".
///
/// `bloco` e `apartamento` só são preenchidos ao ABRIR um condomínio. Quatro
/// telas (visitante, prestador, reserva, mudança) jogam esses valores direto em
/// `TextEditingController.text`, que não aceita null — então quem chegava nelas
/// direto da home, clicando num evento em "Meus Eventos", quebrava a tela.
void main() {
  test('bloco e apartamento nascem vazios, nunca nulos', () {
    expect(Singleton.instance.bloco, isNotNull);
    expect(Singleton.instance.apartamento, isNotNull);
    expect(Singleton.instance.bloco, '');
    expect(Singleton.instance.apartamento, '');
  });

  test('valem como texto de um controller sem condomínio aberto', () {
    final bloco = TextEditingController();
    final apto = TextEditingController();
    addTearDown(bloco.dispose);
    addTearDown(apto.dispose);

    // Exatamente o que new_visitante.dart faz no initState do morador.
    expect(() {
      bloco.text = Singleton.instance.bloco;
      apto.text = Singleton.instance.apartamento;
    }, returnsNormally);
  });

  test('continuam válidos depois de abrir um condomínio', () {
    Singleton.instance.bloco = 'A';
    Singleton.instance.apartamento = '101';

    final c = TextEditingController();
    addTearDown(c.dispose);
    c.text = Singleton.instance.bloco;
    expect(c.text, 'A');

    Singleton.instance.bloco = '';
    Singleton.instance.apartamento = '';
  });
}
