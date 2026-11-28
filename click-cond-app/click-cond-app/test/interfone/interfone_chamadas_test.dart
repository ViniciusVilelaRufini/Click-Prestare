import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/services/interfone/interfone_chamadas.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_test/flutter_test.dart';

EstadoChamada _estado(String estado, {bool porMim = false}) => EstadoChamada(
      id: 41,
      tipo: 'facial_unidade',
      estado: estado,
      unidade: 'Bloco A · Apto 106',
      portao: 'Portão social',
      atendidaPorMim: porMim,
    );

void main() {
  group('deveFecharTela', () {
    test('chamando → continua tocando', () {
      expect(deveFecharTela(_estado('chamando')), isFalse);
    });
    test('atendida por outro → fecha', () {
      expect(deveFecharTela(_estado('atendida')), isTrue);
    });
    test('atendida por mim → não derruba a minha chamada', () {
      expect(deveFecharTela(_estado('atendida', porMim: true)), isFalse);
    });
    test('encerrada → fecha', () {
      expect(deveFecharTela(_estado('encerrada')), isTrue);
    });
    test('portaria → fecha (foi para a portaria)', () {
      expect(deveFecharTela(_estado('portaria')), isTrue);
    });
  });

  group('uuid da chamada', () {
    test('é determinístico e igual ao do iPhone (AppDelegate)', () {
      expect(uuidDaChamada(123), '00000000-0000-4000-8000-00000000007b');
      expect(uuidDaChamada(0), '00000000-0000-4000-8000-000000000000');
    });
    test('volta para o id', () {
      expect(idDaChamadaPeloUuid(uuidDaChamada(98765)), 98765);
      expect(idDaChamadaPeloUuid(uuidDaChamada(98765).toUpperCase()), 98765);
      expect(idDaChamadaPeloUuid('44d915e1-5ff4-4bed-bf13-c423048ec97a'), isNull);
    });
    test('id do evento: extra.id primeiro, senão o uuid', () {
      expect(idDaChamadaDoParams(const CallKitParams(id: 'x', extra: {'id': '7'})), 7);
      expect(idDaChamadaDoParams(CallKitParams(id: uuidDaChamada(9))), 9);
      expect(idDaChamadaDoParams(const CallKitParams(id: 'x')), isNull);
    });
  });

  group('parametrosDaChamada', () {
    test('monta a tela de ligação a partir do push', () {
      final p = parametrosDaChamada({
        'type': 'interfone_chamada',
        'id': '41',
        'tipo': 'facial_unidade',
        'unidade': 'Bloco A · Apto 106',
        'portao': 'Portão social',
        'condominio': 'Boa Vista',
      })!;
      expect(p.id, uuidDaChamada(41));
      expect(p.nameCaller, 'Portão social');
      expect(p.handle, 'Bloco A · Apto 106');
      expect(p.appName, 'Prestare');
      expect(p.type, 0);
      expect(p.duration, 60000);
      expect(p.extra?['id'], '41');
      expect(p.android?.isShowFullLockedScreen, isTrue);
      expect(p.android?.ringtonePath, 'system_ringtone_default');
      expect(p.android?.textAccept, 'Atender');
      expect(p.android?.textDecline, 'Recusar');
      expect(p.missedCallNotification?.showNotification, isFalse);
      expect(p.ios?.supportsVideo, isFalse);
    });
    test('sem id válido não mostra nada', () {
      expect(parametrosDaChamada({'type': 'interfone_chamada'}), isNull);
      expect(parametrosDaChamada({'type': 'interfone_chamada', 'id': 'abc'}), isNull);
    });
    test('sem portão usa "Interfone"', () {
      expect(parametrosDaChamada({'id': '5'})!.nameCaller, 'Interfone');
    });
  });

  group('InterfoneChamadas', () {
    late List<String> encerradas;
    late List<int> recusadas;
    late List<int> abertas;
    late List<CallKitParams> mostradas;
    late Map<int, EstadoChamada?> estados;

    setUp(() {
      encerradas = [];
      recusadas = [];
      abertas = [];
      mostradas = [];
      estados = {};
      InterfoneChamadas.redefinirParaTeste(
        mostrar: (p) async => mostradas.add(p),
        encerrar: (uuid) async => encerradas.add(uuid),
        consultar: (id) async => estados[id],
        recusar: (id) async {
          recusadas.add(id);
          return true;
        },
        abrirTela: (id) async => abertas.add(id),
        intervalo: const Duration(milliseconds: 10),
      );
    });

    tearDown(InterfoneChamadas.redefinirParaTeste);

    test('mostra e fecha quando outro aparelho atende', () async {
      estados[41] = _estado('chamando');
      await InterfoneChamadas.mostrarEntrando({'id': '41', 'portao': 'P', 'unidade': 'U'});
      expect(mostradas.single.id, uuidDaChamada(41));
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(encerradas, isEmpty);
      estados[41] = _estado('atendida');
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(encerradas, [uuidDaChamada(41)]);
    });

    test('a tela fechada pelo app não vira "recusar" na API', () async {
      estados[41] = _estado('encerrada');
      await InterfoneChamadas.mostrarEntrando({'id': '41'});
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(encerradas, [uuidDaChamada(41)]);
      // O iPhone manda DECLINE ao encerrar uma chamada não atendida.
      await InterfoneChamadas.tratarEvento(CallEventActionCallDecline(CallKitParams(id: uuidDaChamada(41))));
      expect(recusadas, isEmpty);
    });

    test('recusar na tela de ligação avisa a API', () async {
      await InterfoneChamadas.tratarEvento(
          CallEventActionCallDecline(CallKitParams(id: uuidDaChamada(41), extra: const {'id': '41'})));
      expect(recusadas, [41]);
    });

    test('atender abre a tela da chamada uma vez só', () async {
      final ev = CallEventActionCallAccept(CallKitParams(id: uuidDaChamada(41)));
      await InterfoneChamadas.tratarEvento(ev);
      await InterfoneChamadas.tratarEvento(ev);
      expect(abertas, [41]);
    });

    test('encerrarTela (push interfone_fim) fecha sem recusar', () async {
      await InterfoneChamadas.encerrarTela(41);
      expect(encerradas, [uuidDaChamada(41)]);
      await InterfoneChamadas.tratarEvento(CallEventActionCallDecline(CallKitParams(id: uuidDaChamada(41))));
      expect(recusadas, isEmpty);
    });

    test('chamada mostrada pelo iPhone (VoIP) também é vigiada', () async {
      estados[41] = _estado('portaria');
      await InterfoneChamadas.tratarEvento(CallEventActionCallIncoming(CallKitParams(id: uuidDaChamada(41))));
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(encerradas, [uuidDaChamada(41)]);
    });

    test('atender para a vigia', () async {
      estados[41] = _estado('chamando');
      await InterfoneChamadas.mostrarEntrando({'id': '41'});
      await InterfoneChamadas.tratarEvento(CallEventActionCallAccept(CallKitParams(id: uuidDaChamada(41))));
      estados[41] = _estado('atendida');
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(encerradas, isEmpty);
    });
  });
}
