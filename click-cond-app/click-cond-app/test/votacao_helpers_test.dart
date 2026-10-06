import 'package:click/widgets/votacao/votacao_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

void main() {
  group('parseOpcoes', () {
    test('lê o formato "id;nome;votos" da API', () {
      final ops = parseOpcoes(['1;Esteira;5', '2;Bicicleta;3']);
      expect(ops.length, 2);
      expect(ops[0].id, '1');
      expect(ops[0].nome, 'Esteira');
      expect(ops[0].votos, 5);
      expect(ops[1].id, '2');
      expect(ops[1].votos, 3);
    });

    test('nome com ";" não quebra (id é o primeiro, votos o último)', () {
      final ops = parseOpcoes(['7;Sim; com ressalvas;4']);
      expect(ops.single.id, '7');
      expect(ops.single.nome, 'Sim; com ressalvas');
      expect(ops.single.votos, 4);
    });

    test('tolera votos ausentes/ inválidos, nulo e itens estranhos', () {
      expect(parseOpcoes(null), isEmpty);
      expect(parseOpcoes('x'), isEmpty);
      final ops = parseOpcoes(['3;Talvez', '4;Não;abc', '', null, 5]);
      expect(ops.length, 2);
      expect(ops[0].nome, 'Talvez');
      expect(ops[0].votos, 0);
      expect(ops[1].votos, 0);
    });

    test('aceita também mapas {id, nome, votos}', () {
      final ops = parseOpcoes([
        {'id': 9, 'nome': 'A', 'votos': '2'},
      ]);
      expect(ops.single.id, '9');
      expect(ops.single.nome, 'A');
      expect(ops.single.votos, 2);
    });
  });

  group('totalVotos', () {
    test('soma strings cruas da API', () {
      expect(totalVotos(['1;A;5', '2;B;3']), 8);
    });

    test('soma OpcaoVotacao já parseadas', () {
      expect(totalVotos(const [OpcaoVotacao(id: '1', nome: 'A', votos: 2), OpcaoVotacao(id: '2', nome: 'B', votos: 1)]), 3);
    });

    test('vazio ou nulo é 0', () {
      expect(totalVotos(null), 0);
      expect(totalVotos([]), 0);
    });
  });

  group('percentual', () {
    test('0 quando total é 0', () {
      expect(percentual(0, 0), 0);
      expect(percentual(3, 0), 0);
    });

    test('arredonda', () {
      expect(percentual(1, 3), 33);
      expect(percentual(2, 3), 67);
      expect(percentual(5, 8), 63);
      expect(percentual(8, 8), 100);
    });

    test('limita entre 0 e 100', () {
      expect(percentual(-1, 3), 0);
      expect(percentual(5, 3), 100);
    });
  });

  group('percentuais (soma coerente)', () {
    test('sempre soma 100 quando há votos', () {
      expect(percentuais([1, 1, 1]), [34, 33, 33]);
      expect(percentuais([1, 1, 1]).reduce((a, b) => a + b), 100);
      expect(percentuais([2, 1]), [67, 33]);
      expect(percentuais([5, 3]), [63, 37]);
      expect(percentuais([1, 1, 1, 1, 1, 1, 1]).reduce((a, b) => a + b), 100);
    });

    test('sem votos é tudo 0', () {
      expect(percentuais([0, 0]), [0, 0]);
      expect(percentuais([]), isEmpty);
    });

    test('opção sem voto fica em 0', () {
      expect(percentuais([4, 0]), [100, 0]);
    });
  });

  group('votouNaOpcao', () {
    test('compara id como texto', () {
      expect(votouNaOpcao('1', ['1']), isTrue);
      expect(votouNaOpcao(1, ['1']), isTrue);
      expect(votouNaOpcao('2', ['1']), isFalse);
      expect(votouNaOpcao('1', null), isFalse);
      expect(votouNaOpcao('1', [1]), isTrue);
    });
  });

  group('prazoLabel', () {
    final agora = DateTime(2026, 10, 6, 15, 30);

    test('finalizada é "Encerrada"', () {
      expect(prazoLabel('10/10/2026', 2, agora: agora), 'Encerrada');
      expect(prazoLabel('', 2, agora: agora), 'Encerrada');
    });

    test('em andamento conta os dias até o término', () {
      expect(prazoLabel('06/10/2026', 1, agora: agora), 'Encerra hoje');
      expect(prazoLabel('07/10/2026', 1, agora: agora), 'Encerra amanhã');
      expect(prazoLabel('09/10/2026', 1, agora: agora), 'Encerra em 3 dias');
      expect(prazoLabel('05/11/2026', 1, agora: agora), 'Encerra em 30 dias');
    });

    test('em andamento com término já passado é "Encerrada"', () {
      expect(prazoLabel('01/10/2026', 1, agora: agora), 'Encerrada');
    });

    test('agendada usa a data de início', () {
      expect(prazoLabel('30/10/2026', 0, dataInicio: '08/10/2026', agora: agora), 'Começa em 2 dias');
      expect(prazoLabel('30/10/2026', 0, dataInicio: '07/10/2026', agora: agora), 'Começa amanhã');
      expect(prazoLabel('30/10/2026', 0, dataInicio: '06/10/2026', agora: agora), 'Começa hoje');
    });

    test('status como texto também funciona', () {
      expect(prazoLabel('09/10/2026', '1', agora: agora), 'Encerra em 3 dias');
      expect(prazoLabel('09/10/2026', '2', agora: agora), 'Encerrada');
    });

    test('data inválida devolve vazio (sem exceção)', () {
      expect(prazoLabel('', 1, agora: agora), '');
      expect(prazoLabel(null, 1, agora: agora), '');
      expect(prazoLabel('31/02/2026', 1, agora: agora), '');
      expect(prazoLabel('2026-10-09', 1, agora: agora), '');
      expect(prazoLabel('30/10/2026', 0, agora: agora), '');
      expect(prazoLabel('09/10/2026', null, agora: agora), '');
    });
  });

  group('statusVotacaoInfo', () {
    test('agendada: âmbar, rótulo da chave votacao_agendado', () {
      final i = statusVotacaoInfo(0);
      expect(i.rotulo, 'Agendado');
      expect(i.cor, StatusVotacaoInfo.corAgendada);
      expect(i.icone, PhosphorIcons.hourglassMedium);
    });

    test('em andamento: verde', () {
      final i = statusVotacaoInfo(1);
      expect(i.rotulo, 'Em andamento');
      expect(i.cor, StatusVotacaoInfo.corAndamento);
      expect(i.icone, PhosphorIcons.playCircle);
    });

    test('finalizada: cinza com cadeado', () {
      final i = statusVotacaoInfo('2');
      expect(i.rotulo, 'Finalizado');
      expect(i.cor, StatusVotacaoInfo.corFinalizada);
      expect(i.icone, PhosphorIcons.lockSimple);
    });

    test('desconhecido: cinza, sem quebrar', () {
      final i = statusVotacaoInfo(null);
      expect(i.rotulo, 'Sem status');
      expect(i.cor, StatusVotacaoInfo.corFinalizada);
    });

    test('corTexto contrasta nos dois temas', () {
      final i = statusVotacaoInfo(1);
      expect(i.corTextoPara(Brightness.light), isNot(i.cor));
      expect(i.corTextoPara(Brightness.dark), isNot(i.cor));
    });
  });

  group('votosLabel', () {
    test('singular/plural', () {
      expect(votosLabel(0), '0 votos');
      expect(votosLabel(1), '1 voto');
      expect(votosLabel(12), '12 votos');
    });
  });
}
