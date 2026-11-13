import 'package:click/services/card_ao_vivo/textos_card.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const chegou = 1794580080; // 13/11/2026
  final base = <String, dynamic>{
    'nome': 'Vinicius Vilela',
    'tipo': 'Visitante',
    'unidade': 'Bloco A · Apto 106',
    'chegouEm': chegou,
    'expiraEm': chegou + 180,
    'respondidoPor': null,
    'voceRespondeu': false,
    'pelaPortaria': false,
    'horaResposta': chegou + 60,
    'horaEntrada': chegou + 300,
  };
  Map<String, dynamic> com(Map<String, dynamic> m) => {...base, ...m};

  test('aguardando: fixa, com botões e hora limite', () {
    final t = textosCard(com({'fase': 'aguardando'}));
    expect(t.titulo, 'Vinicius Vilela · na portaria');
    expect(t.corpo, 'Visitante · Bloco A · Apto 106 · responda até ${horaDoEpoch(chegou + 180)}');
    expect(t.emAndamento, isTrue);
    expect(t.comBotoes, isTrue);
  });

  test('liberado por mim, por outro e pela portaria', () {
    final hora = horaDoEpoch(chegou + 60);
    expect(textosCard(com({'fase': 'liberado', 'voceRespondeu': true})).corpo,
        'Você autorizou às $hora. Aguardando a entrada.');
    expect(textosCard(com({'fase': 'liberado', 'respondidoPor': 'Marina'})).corpo,
        'Autorizado por Marina às $hora. Aguardando a entrada.');
    expect(textosCard(com({'fase': 'liberado', 'pelaPortaria': true})).corpo,
        'Liberado pela portaria às $hora. Aguardando a entrada.');
    final t = textosCard(com({'fase': 'liberado'}));
    expect(t.emAndamento, isTrue);
    expect(t.comBotoes, isFalse);
  });

  test('entrou', () {
    final t = textosCard(com({'fase': 'entrou'}));
    expect(t.titulo, 'Vinicius Vilela · no local');
    expect(t.corpo, 'Entrou às ${horaDoEpoch(chegou + 300)} · Visitante');
    expect(t.emAndamento, isFalse);
  });

  test('negado por mim e por outro', () {
    final hora = horaDoEpoch(chegou + 60);
    expect(textosCard(com({'fase': 'negado', 'voceRespondeu': true})).corpo, 'Você negou a entrada às $hora.');
    expect(textosCard(com({'fase': 'negado', 'respondidoPor': 'Marina'})).corpo, 'Negado por Marina às $hora.');
  });

  test('expirado', () {
    final t = textosCard(com({'fase': 'expirado'}));
    expect(t.titulo, 'Vinicius Vilela · sem resposta');
    expect(t.corpo, 'Sem resposta. A portaria decide a entrada.');
    expect(t.comBotoes, isFalse);
  });

  test('prestador sem unidade', () {
    final t = textosCard(com({'fase': 'aguardando', 'tipo': 'Prestador', 'unidade': ''}));
    expect(t.corpo.startsWith('Prestador · responda até'), isTrue);
  });
}
