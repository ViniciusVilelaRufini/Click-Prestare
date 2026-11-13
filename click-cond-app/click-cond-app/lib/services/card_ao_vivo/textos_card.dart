import 'package:intl/intl.dart';

/// Textos da notificação fixa do card ao vivo da portaria remota (Android).
///
/// `conteudo` é o JSON que o servidor manda (mesmas chaves do ContentState
/// da Live Activity no iPhone): fase, nome, tipo, unidade, chegouEm, expiraEm,
/// respondidoPor, voceRespondeu, pelaPortaria, horaResposta, horaEntrada.
/// Datas em epoch (segundos). Textos: seção 3 do spec
/// docs/superpowers/specs/2026-11-13-card-ao-vivo-portaria-remota-design.md.
class TextosCard {
  final String titulo;
  final String corpo;

  /// Aguardando ou liberado: notificação fixa (não sai no deslizar).
  final bool emAndamento;

  /// Só aguardando tem NEGAR/AUTORIZAR.
  final bool comBotoes;

  const TextosCard({
    required this.titulo,
    required this.corpo,
    required this.emAndamento,
    required this.comBotoes,
  });
}

String horaDoEpoch(dynamic epochSeg) {
  final n = epochSeg is num ? epochSeg : num.tryParse('$epochSeg');
  if (n == null) return '';
  return DateFormat('HH:mm').format(DateTime.fromMillisecondsSinceEpoch((n * 1000).round()).toLocal());
}

TextosCard textosCard(Map<String, dynamic> c) {
  final fase = '${c['fase'] ?? ''}';
  final nome = '${c['nome'] ?? 'Visitante'}';
  final tipo = '${c['tipo'] ?? 'Visitante'}';
  final unidade = '${c['unidade'] ?? ''}';
  final voce = c['voceRespondeu'] == true;
  final portaria = c['pelaPortaria'] == true;
  final quem = (c['respondidoPor'] ?? '').toString();
  final horaResposta = horaDoEpoch(c['horaResposta']);
  final linhaTipo = unidade.isEmpty ? tipo : '$tipo · $unidade';

  switch (fase) {
    case 'aguardando':
      return TextosCard(
        titulo: '$nome · na portaria',
        corpo: '$linhaTipo · responda até ${horaDoEpoch(c['expiraEm'])}',
        emAndamento: true,
        comBotoes: true,
      );
    case 'liberado':
      final autor = voce
          ? 'Você autorizou'
          : portaria
              ? 'Liberado pela portaria'
              : 'Autorizado por ${quem.isEmpty ? 'outro morador' : quem}';
      return TextosCard(
        titulo: '$nome · liberado',
        corpo: '$autor às $horaResposta. Aguardando a entrada.',
        emAndamento: true,
        comBotoes: false,
      );
    case 'entrou':
      return TextosCard(
        titulo: '$nome · no local',
        corpo: 'Entrou às ${horaDoEpoch(c['horaEntrada'])} · $tipo',
        emAndamento: false,
        comBotoes: false,
      );
    case 'negado':
      final autor = voce ? 'Você negou a entrada' : 'Negado por ${quem.isEmpty ? 'outro morador' : quem}';
      return TextosCard(
        titulo: '$nome · negado',
        corpo: '$autor às $horaResposta.',
        emAndamento: false,
        comBotoes: false,
      );
    case 'expirado':
      return TextosCard(
        titulo: '$nome · sem resposta',
        corpo: 'Sem resposta. A portaria decide a entrada.',
        emAndamento: false,
        comBotoes: false,
      );
    default:
      return TextosCard(titulo: '$tipo na portaria', corpo: nome, emAndamento: false, comBotoes: false);
  }
}
