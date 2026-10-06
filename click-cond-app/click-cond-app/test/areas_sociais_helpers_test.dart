import 'package:click/pages/shared/areas%20sociais/widgets/reserva_helpers.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> reserva(String bloco, String apto, String status, {int id = 0}) => {
      'id': id,
      'bloco': bloco,
      'apto': apto,
      'data': '11/10/2026',
      'horaDe': '10:00',
      'horaAte': '16:00',
      'status': status,
    };

void main() {
  group('reservasVisiveis', () {
    final lista = [
      reserva('A', '101', 'pendente', id: 1),
      reserva('A', '101', 'aprovado', id: 2),
      reserva('A', '101', 'recusado', id: 3),
      reserva('A', '101', 'cancelado', id: 4),
      reserva('B', '202', 'pendente', id: 5),
      reserva('B', '202', 'recusado', id: 6),
      reserva('A', '101', ' APROVADO ', id: 7),
    ];

    List<int> ids(List<dynamic> l) => l.map((e) => e['id'] as int).toList();

    test('quem pode ver todas recebe pendente e aprovado de todos os aptos', () {
      expect(ids(reservasVisiveis(lista, podeVerTodas: true)), [1, 2, 5, 7]);
    });

    test('morador recebe só as do seu apto, incluindo recusadas, sem canceladas', () {
      expect(
        ids(reservasVisiveis(lista, podeVerTodas: false, bloco: 'A', apto: '101')),
        [1, 2, 3, 7],
      );
      expect(
        ids(reservasVisiveis(lista, podeVerTodas: false, bloco: 'B', apto: '202')),
        [5, 6],
      );
    });

    test('compara bloco e apto ignorando espaços', () {
      expect(
        ids(reservasVisiveis(lista, podeVerTodas: false, bloco: ' A ', apto: '101 ')),
        [1, 2, 3, 7],
      );
    });

    test('morador sem bloco/apto ou lista inválida não vê nada', () {
      expect(reservasVisiveis(lista, podeVerTodas: false), isEmpty);
      expect(reservasVisiveis(lista, podeVerTodas: false, bloco: 'A', apto: ''), isEmpty);
      expect(reservasVisiveis(null, podeVerTodas: true), isEmpty);
    });

    test('compara bloco e apto sem diferenciar maiúsculas', () {
      final l = [
        {'bloco': 'Torre a', 'apto': '12b', 'status': 'pendente'},
      ];
      expect(reservasVisiveis(l, podeVerTodas: false, bloco: 'TORRE A', apto: '12B'), hasLength(1));
      expect(reservasVisiveis(l, podeVerTodas: false, bloco: 'Torre B', apto: '12B'), isEmpty);
    });

    test('bloco/apto numéricos vindos da API também casam', () {
      final l = [
        {'bloco': 1, 'apto': 101, 'status': 'pendente'},
      ];
      expect(reservasVisiveis(l, podeVerTodas: false, bloco: '1', apto: '101'), hasLength(1));
    });
  });

  group('statusReservaInfo', () {
    test('pendente é âmbar', () {
      final s = statusReservaInfo('pendente');
      expect(s.rotulo, 'Pendente');
      expect(s.cor, StatusReservaInfo.corPendente);
    });

    test('aprovado é verde', () {
      final s = statusReservaInfo('aprovado');
      expect(s.rotulo, 'Aprovada');
      expect(s.cor, StatusReservaInfo.corAprovada);
    });

    test('recusado é vermelho', () {
      final s = statusReservaInfo('recusado');
      expect(s.rotulo, 'Recusada');
      expect(s.cor, StatusReservaInfo.corRecusada);
    });

    test('cancelado é cinza', () {
      final s = statusReservaInfo('cancelado');
      expect(s.rotulo, 'Cancelada');
      expect(s.cor, StatusReservaInfo.corNeutra);
    });

    test('ignora maiúsculas e espaços', () {
      expect(statusReservaInfo('  APROVADO ').rotulo, 'Aprovada');
      expect(statusReservaInfo('Pendente').rotulo, 'Pendente');
    });

    test('desconhecido mantém o texto original em cinza', () {
      final s = statusReservaInfo('em análise');
      expect(s.rotulo, 'em análise');
      expect(s.cor, StatusReservaInfo.corNeutra);
    });

    test('nulo ou vazio vira "Sem status" em cinza', () {
      expect(statusReservaInfo(null).rotulo, 'Sem status');
      expect(statusReservaInfo('  ').cor, StatusReservaInfo.corNeutra);
    });

    test('cada status tem ícone próprio', () {
      final icones = {
        statusReservaInfo('pendente').icone,
        statusReservaInfo('aprovado').icone,
        statusReservaInfo('recusado').icone,
        statusReservaInfo('cancelado').icone,
      };
      expect(icones, hasLength(4));
    });
  });

  group('duracaoHorario', () {
    test('horas cheias', () {
      expect(duracaoHorario('10:00', '16:00'), '6 h');
      expect(duracaoHorario('08:00', '09:00'), '1 h');
    });

    test('horas com minutos', () {
      expect(duracaoHorario('10:00', '11:30'), '1 h 30');
      expect(duracaoHorario('09:15', '12:20'), '3 h 05');
    });

    test('menos de uma hora', () {
      expect(duracaoHorario('10:00', '10:45'), '45 min');
    });

    test('inválido, igual ou invertido devolve vazio', () {
      expect(duracaoHorario('abc', '16:00'), '');
      expect(duracaoHorario('10:00', '10:00'), '');
      expect(duracaoHorario('16:00', '10:00'), '');
    });

    test('aceita hora com segundos', () {
      expect(duracaoHorario('10:00:00', '12:00:00'), '2 h');
    });
  });

  group('separarHorario / faixaHorario', () {
    test('separa "10:00 - 16:00"', () {
      final p = separarHorario('10:00 - 16:00');
      expect(p, isNotNull);
      expect(p!.de, '10:00');
      expect(p.ate, '16:00');
    });

    test('aceita traço longo e sem espaços', () {
      expect(separarHorario('10:00 – 16:00')!.ate, '16:00');
      expect(separarHorario('10:00-16:00')!.de, '10:00');
    });

    test('texto sem faixa devolve nulo', () {
      expect(separarHorario(' - '), isNull);
      expect(separarHorario(''), isNull);
      expect(separarHorario(null), isNull);
    });

    test('faixaHorario usa traço longo', () {
      expect(faixaHorario('10:00', '16:00'), '10:00 – 16:00');
      expect(faixaHorario('10:00:00', '16:00:00'), '10:00 – 16:00');
    });
  });

  group('dataPorExtenso', () {
    test('formata em pt-BR com dia da semana', () {
      expect(dataPorExtenso('11/10/2026'), 'Domingo, 11 de outubro de 2026');
      expect(dataPorExtenso('01/01/2027'), 'Sexta-feira, 1 de janeiro de 2027');
    });

    test('data inválida volta como veio', () {
      expect(dataPorExtenso('amanhã'), 'amanhã');
    });
  });

  group('resumoReserva', () {
    test('monta data por extenso, faixa, duração e convidados', () {
      final r = resumoReserva('11/10/2026', '10:00 - 16:00', 12);
      expect(r.dataExtenso, 'Domingo, 11 de outubro de 2026');
      expect(r.horario, '10:00 – 16:00');
      expect(r.duracao, '6 h');
      expect(r.convidados, '12 convidados');
      expect(r.linha, 'Domingo, 11 de outubro de 2026 · 10:00 – 16:00 · 12 convidados');
    });

    test('singular para um convidado', () {
      expect(resumoReserva('11/10/2026', '10:00 - 16:00', 1).convidados, '1 convidado');
    });

    test('sem convidados informados', () {
      final r = resumoReserva('11/10/2026', '10:00 - 16:00', null);
      expect(r.convidados, 'Sem convidados informados');
      expect(r.linha, 'Domingo, 11 de outubro de 2026 · 10:00 – 16:00');
      expect(resumoReserva('11/10/2026', '10:00 - 16:00', 0).convidados, 'Sem convidados informados');
    });

    test('horário inválido não quebra', () {
      final r = resumoReserva('11/10/2026', ' - ', null);
      expect(r.horario, '');
      expect(r.duracao, '');
      expect(r.linha, 'Domingo, 11 de outubro de 2026');
    });
  });

  group('parseDataReserva / convidadosDaReserva', () {
    test('parseDataReserva aceita dd/MM/yyyy e rejeita data impossível', () {
      expect(parseDataReserva('11/10/2026'), DateTime(2026, 10, 11));
      expect(parseDataReserva('31/02/2026'), isNull);
      expect(parseDataReserva(null), isNull);
    });

    test('convidadosDaReserva aceita int, string e nulo', () {
      expect(convidadosDaReserva(5), 5);
      expect(convidadosDaReserva('12'), 12);
      expect(convidadosDaReserva('0'), isNull);
      expect(convidadosDaReserva(''), isNull);
      expect(convidadosDaReserva(null), isNull);
    });
  });
}
