import 'package:click/pages/shared/areas%20sociais/widgets/reserva_helpers.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

// Funções puras das telas de Enquetes e Assembleias (votações). Nada aqui
// toca em rede, Singleton ou storage — tudo é testável sem montar tela.
//
// Formato real da API (assembleias.service.ts → getVotacoesFormatadas):
//   votacao = { id, titulo, descricao, data_inicio: 'dd/MM/yyyy',
//               data_termino: 'dd/MM/yyyy', status: 0|1|2,
//               opcoes: ['id;nome;votos', ...] }
// e o detalhe da enquete devolve também `meuVoto: ['<id da opção>']`
// (no detalhe da assembleia é `meusVotos`, mesma forma).

/// Uma opção de votação já separada do texto `'id;nome;votos'`.
class OpcaoVotacao {
  /// Id da opção, como texto (é assim que vem em `meuVoto`).
  final String id;

  /// Texto da opção.
  final String nome;

  /// Votos apurados (o mais recente de cada usuário).
  final int votos;

  const OpcaoVotacao({required this.id, required this.nome, required this.votos});

  /// Id numérico para `insertVoto`/`onPressedChoice` (nulo se não for número).
  int? get idInt => int.tryParse(id);
}

int _int(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  return int.tryParse((v ?? '').toString().trim()) ?? 0;
}

/// Converte `votacao['opcoes']` em [OpcaoVotacao]. Aceita o formato da API
/// (`'id;nome;votos'` — o id é o primeiro campo, os votos o último e o resto é
/// o nome, então um nome com `;` não quebra) e também mapas
/// `{id, nome|texto, votos}`. Itens vazios ou estranhos são ignorados; votos
/// ausentes ou inválidos valem 0.
List<OpcaoVotacao> parseOpcoes(dynamic opcoes) {
  if (opcoes is! List) return const [];
  final out = <OpcaoVotacao>[];
  for (final o in opcoes) {
    if (o is OpcaoVotacao) {
      out.add(o);
    } else if (o is String) {
      final partes = o.split(';');
      if (partes.length < 2 || partes[0].trim().isEmpty) continue;
      if (partes.length == 2) {
        out.add(OpcaoVotacao(id: partes[0].trim(), nome: partes[1], votos: 0));
      } else {
        out.add(OpcaoVotacao(
          id: partes.first.trim(),
          nome: partes.sublist(1, partes.length - 1).join(';'),
          votos: _int(partes.last),
        ));
      }
    } else if (o is Map) {
      final id = (o['id'] ?? '').toString().trim();
      if (id.isEmpty) continue;
      out.add(OpcaoVotacao(
        id: id,
        nome: (o['nome'] ?? o['texto'] ?? '').toString(),
        votos: _int(o['votos']),
      ));
    }
  }
  return out;
}

/// Total de votos das [opcoes] (texto cru da API ou [OpcaoVotacao]).
int totalVotos(dynamic opcoes) => parseOpcoes(opcoes).fold(0, (s, o) => s + o.votos);

/// Percentual inteiro (0–100, arredondado) de [votos] em [total]; 0 quando
/// [total] é 0. Para várias opções que precisam somar 100, use [percentuais].
int percentual(int votos, int total) {
  if (total <= 0 || votos <= 0) return 0;
  return (votos * 100 / total).round().clamp(0, 100);
}

/// Percentuais inteiros de cada opção que somam exatamente 100 quando há
/// votos (método do maior resto; empate vai para a opção que vem primeiro).
/// Sem votos, tudo 0.
List<int> percentuais(List<int> votos) {
  final total = votos.fold<int>(0, (s, v) => s + (v > 0 ? v : 0));
  if (total == 0) return List.filled(votos.length, 0);
  final exatos = [for (final v in votos) (v > 0 ? v : 0) * 100 / total];
  final base = [for (final e in exatos) e.floor()];
  var falta = 100 - base.fold<int>(0, (s, v) => s + v);
  final ordem = List.generate(votos.length, (i) => i)
    ..sort((a, b) {
      final c = (exatos[b] - base[b]).compareTo(exatos[a] - base[a]);
      return c != 0 ? c : a.compareTo(b);
    });
  for (final i in ordem) {
    if (falta <= 0) break;
    if (exatos[i] - base[i] <= 0) continue;
    base[i]++;
    falta--;
  }
  return base;
}

/// Se a opção [opcaoId] está em [meusVotos] (`obj['meuVoto']` da enquete ou
/// `meusVotos` da assembleia — lista de ids em texto). Compara como texto.
bool votouNaOpcao(dynamic opcaoId, List<dynamic>? meusVotos) {
  if (meusVotos == null) return false;
  final id = opcaoId.toString();
  return meusVotos.any((v) => v.toString() == id);
}

/// `'1 voto'`, `'12 votos'`, `'0 votos'`.
String votosLabel(int votos) => votos == 1 ? '1 voto' : '$votos votos';

int? _status(dynamic status) {
  if (status is int) return status;
  return int.tryParse((status ?? '').toString().trim());
}

int _diasAte(DateTime data, DateTime agora) {
  final hoje = DateTime(agora.year, agora.month, agora.day);
  // Diferença em dias de calendário (UTC evita o pulo do horário de verão).
  return DateTime.utc(data.year, data.month, data.day)
      .difference(DateTime.utc(hoje.year, hoje.month, hoje.day))
      .inDays;
}

/// Texto curto de prazo para o chip do card/cabeçalho:
/// - finalizada (2) → `''` (o selo "Finalizado" já diz; sem chip duplicado);
/// - em andamento (1) → `'Encerra hoje'`, `'Encerra amanhã'`,
///   `'Encerra em 3 dias'` (término já passado → `'Encerrada'`);
/// - agendada (0) → `'Começa hoje'`, `'Começa amanhã'`, `'Começa em 2 dias'`
///   a partir de [dataInicio].
///
/// Datas no formato da API (`'dd/MM/yyyy'`). Data inválida/ausente ou status
/// desconhecido devolve `''` (esconda o chip). [agora] é para testes.
String prazoLabel(String? dataTermino, dynamic status, {String? dataInicio, DateTime? agora}) {
  final s = _status(status);
  final now = agora ?? DateTime.now();
  if (s == 0) {
    final ini = parseDataReserva(dataInicio);
    if (ini == null) return '';
    final d = _diasAte(ini, now);
    if (d <= 0) return 'Começa hoje';
    if (d == 1) return 'Começa amanhã';
    return 'Começa em $d dias';
  }
  if (s == 1) {
    final fim = parseDataReserva(dataTermino);
    if (fim == null) return '';
    final d = _diasAte(fim, now);
    if (d < 0) return 'Encerrada';
    if (d == 0) return 'Encerra hoje';
    if (d == 1) return 'Encerra amanhã';
    return 'Encerra em $d dias';
  }
  return '';
}

/// Se o prazo pede atenção (destaque em âmbar): votação em andamento que
/// encerra hoje ou amanhã. Finalizada, agendada, término passado ou data
/// inválida → falso. [agora] é para testes.
bool prazoUrgente(String? dataTermino, dynamic status, {DateTime? agora}) {
  if (_status(status) != 1) return false;
  final fim = parseDataReserva(dataTermino);
  if (fim == null) return false;
  final d = _diasAte(fim, agora ?? DateTime.now());
  return d == 0 || d == 1;
}

/// Texto de um campo da API: nulo, `'null'` (de `null.toString()`) e só
/// espaços viram `''`; o resto vem sem espaços nas pontas.
String textoLimpo(dynamic v) {
  final s = (v ?? '').toString().trim();
  return s == 'null' ? '' : s;
}

/// Rótulo, cor semântica e ícone de um status de votação.
class StatusVotacaoInfo {
  /// Âmbar — agendada (mesma cor de "Pendente" das Áreas Sociais).
  static const Color corAgendada = StatusReservaInfo.corPendente;

  /// Verde — em andamento, dá para votar.
  static const Color corAndamento = StatusReservaInfo.corAprovada;

  /// Cinza — finalizada (ou status desconhecido).
  static const Color corFinalizada = StatusReservaInfo.corNeutra;

  final String rotulo;
  final Color cor;
  final IconData icone;

  const StatusVotacaoInfo(this.rotulo, this.cor, this.icone);

  /// Cor para texto/ícone sobre o fundo tingido com [cor]: escurece no tema
  /// claro e clareia um pouco no escuro (mesma regra de
  /// `StatusReservaInfo.corTexto`).
  Color corTextoPara(Brightness brilho) => brilho == Brightness.dark
      ? Color.lerp(cor, Colors.white, 0.18)!
      : Color.lerp(cor, Colors.black, 0.4)!;

  /// [corTextoPara] com o brilho do tema atual.
  Color corTexto(BuildContext context) => corTextoPara(Theme.of(context).brightness);
}

/// Mapeia o status inteiro (0 agendada, 1 em andamento, 2 finalizada; aceita
/// texto `'1'`) para rótulo (chaves `votacao_agendado`/`votacao_andamento`/
/// `votacao_finalizado`), cor e ícone. Desconhecido: "Sem status" em cinza.
StatusVotacaoInfo statusVotacaoInfo(dynamic status) {
  switch (_status(status)) {
    case 0:
      return StatusVotacaoInfo(
          getText('votacao_agendado'), StatusVotacaoInfo.corAgendada, PhosphorIcons.hourglassMedium);
    case 1:
      return StatusVotacaoInfo(
          getText('votacao_andamento'), StatusVotacaoInfo.corAndamento, PhosphorIcons.playCircle);
    case 2:
      return StatusVotacaoInfo(
          getText('votacao_finalizado'), StatusVotacaoInfo.corFinalizada, PhosphorIcons.lockSimple);
    default:
      return const StatusVotacaoInfo('Sem status', StatusVotacaoInfo.corFinalizada, PhosphorIcons.question);
  }
}

/// Cor de destaque (primária) legível nos dois temas: no escuro usa o azul
/// claro `0xFF93B4F8`, o mesmo das telas de Áreas Sociais.
Color corDestaqueVotacao(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark ? const Color(0xFF93B4F8) : AppColors.primary;
