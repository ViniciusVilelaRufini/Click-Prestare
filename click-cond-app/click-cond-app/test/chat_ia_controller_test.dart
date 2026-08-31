import 'package:flutter_test/flutter_test.dart';
import 'package:click/controllers/controller_generic.dart';

void main() {
  test('apiPerguntarChatIa aceita parametro arquivo opcional sem quebrar', () async {
    // Verifica que a assinatura do método aceita arquivo
    expect(
      () => apiPerguntarChatIa(
        'Analise minha conta de luz',
        conversaId: 'conv-123',
        arquivo: {
          'nome': 'fatura.jpg',
          'mime_type': 'image/jpeg',
          'base64': 'dGVzdGU=',
        },
      ),
      returnsNormally,
    );
  });
}
