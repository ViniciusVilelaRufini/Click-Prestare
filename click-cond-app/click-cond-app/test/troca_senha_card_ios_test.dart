import 'package:click/pages/singleton.dart';
import 'package:click/services/firebase_service.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter_test/flutter_test.dart';

/// F12: o card ao vivo do iPhone guarda a própria cópia da sessão no
/// keychain. Depois da troca de senha a API recusa o JWT antigo (401) e os
/// botões do card paravam: a cópia precisa receber o token novo.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final original = FirebaseService.instance.definirSessaoCard;

  setUp(() async {
    await ensureStorageReady();
    storageMorador({'token': 'velho', 'user': {'id': 1, 'nome': 'Ana'}});
  });

  tearDown(() async {
    FirebaseService.instance.definirSessaoCard = original;
    await storageLogout();
    Singleton.instance.reset();
  });

  test('trocar a senha entrega o token novo ao card do iPhone', () async {
    final entregues = <String>[];
    FirebaseService.instance.definirSessaoCard = (jwt, base) async => entregues.add(jwt);

    atualizarTokenSessao({'token': 'novo'});
    await Future<void>.delayed(Duration.zero);

    expect(getToken(), 'novo');
    expect(entregues, ['novo']);
  });

  test('resposta sem token não mexe na sessão do card', () async {
    final entregues = <String>[];
    FirebaseService.instance.definirSessaoCard = (jwt, base) async => entregues.add(jwt);

    atualizarTokenSessao({'message': 'ok'});
    await Future<void>.delayed(Duration.zero);

    expect(getToken(), 'velho');
    expect(entregues, isEmpty);
  });

  test('falha da ponte com o Swift não lança', () async {
    FirebaseService.instance.definirSessaoCard = (_, __) async => throw Exception('canal fechado');
    await FirebaseService.instance.atualizarSessaoDoCard('novo');
  });
}
