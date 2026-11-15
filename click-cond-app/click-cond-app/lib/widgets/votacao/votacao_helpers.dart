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

bool _verdadeiro(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  final s = (v ?? '').toString().trim().toLowerCase();
  return s == 'true' || s == '1';
}

/// Se a API escondeu o resultado parcial (`votacao['resultado_oculto']`):
/// votação aberta ou agendada, com os votos zerados em `opcoes`. Campo
/// ausente (API antiga) → falso, e a tela mostra as barras como antes.
bool resultadoOculto(dynamic votacao) => votacao is Map && _verdadeiro(votacao['resultado_oculto']);

/// Se só proprietários votam (`votacao['somente_proprietarios']`, 0|1).
/// Ausente → falso.
bool somenteProprietarios(dynamic votacao) => votacao is Map && _verdadeiro(votacao['somente_proprietarios']);

/// Texto no lugar das barras enquanto o resultado está oculto.
const textoResultadoOculto = 'Resultado disponível ao encerrar';

/// Quórum da votação: unidades que votaram de quantas existem no condomínio.
class Participacao {
  final int votaram;
  final int total;
  const Participacao({required this.votaram, required this.total});
}

/// `votacao['participacao'] = { unidades_votaram, unidades_total }`. Ausente,
/// estranho ou sem total (> 0) → nulo (a tela não mostra o quórum).
Participacao? participacaoDaVotacao(dynamic votacao) {
  if (votacao is! Map) return null;
  final p = votacao['participacao'];
  if (p is! Map) return null;
  final total = _int(p['unidades_total']);
  if (total <= 0) return null;
  return Participacao(votaram: _int(p['unidades_votaram']).clamp(0, total), total: total);
}

/// `'1 de 40 unidades votou'`, `'12 de 40 unidades votaram'`.
String participacaoLabel(Participacao p) =>
    '${p.votaram} de ${p.total} unidades ${p.votaram == 1 ? 'votou' : 'votaram'}';

/// Linha de contagem do card/cabeçalho: a participação quando a API manda;
/// sem ela, o total de votos — exceto com o resultado oculto (os votos vêm
/// zerados), aí nulo e a tela esconde a linha.
String? resumoVotosLabel(dynamic votacao) {
  final p = participacaoDaVotacao(votacao);
  if (p != null) return participacaoLabel(p);
  if (resultadoOculto(votacao)) return null;
  return votosLabel(totalVotos(votacao is Map ? votacao['opcoes'] : null));
}

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

/// Nível do vínculo com a unidade (`tipo_vinculo`/`votado_por` da API):
/// `'proprietario'`, `'inquilino'` ou `'membro'`; aceita acento e caixa.
/// Outro valor, vazio ou ausente → nulo.
String? normalizarNivel(dynamic v) {
  final s = textoLimpo(v).toLowerCase().replaceAll('á', 'a');
  return const {'proprietario', 'inquilino', 'membro'}.contains(s) ? s : null;
}

/// Uma unidade do usuário numa votação, com o voto que vale nela hoje.
/// Vem de `votosPorUnidade` da API (detalhe da enquete e da assembleia):
/// `[{ id_votacao, id_apto, rotulo, opcao, tipo_vinculo?, pode_votar?,
/// motivo?, votado_por?, voto_proprio? }]`, `opcao` nulo = ainda não votou
/// (ou o voto é de alguém de nível acima, que a API não revela). Os cinco
/// últimos são da rodada 5; ausentes (API antiga) = pode votar, sem autor
/// conhecido.
class UnidadeVoto {
  final int idApto;
  final String rotulo;

  /// Id (texto) da opção votada pela unidade, ou nulo.
  final String? opcao;

  /// Vínculo do usuário com a unidade (ver [normalizarNivel]).
  final String? tipoVinculo;

  /// Se o usuário pode votar por esta unidade agora.
  final bool podeVotar;

  /// Texto pronto da API para quando não pode votar.
  final String? motivo;

  /// Nível de quem deu o voto vigente da unidade, ou nulo.
  final String? votadoPor;

  /// Se o voto vigente da unidade é da própria conta (`voto_proprio`). Nulo =
  /// a API não mandou o campo, e [votoDeOutro]/[meuVoto] usam a heurística.
  final bool? votoProprio;

  const UnidadeVoto({
    required this.idApto,
    required this.rotulo,
    this.opcao,
    this.tipoVinculo,
    this.podeVotar = true,
    this.motivo,
    this.votadoPor,
    this.votoProprio,
  });

  /// A unidade tem voto vigente (mesmo que a opção não venha).
  bool get votou => opcao != null || votadoPor != null;

  /// O voto vigente é de outro morador. Com `voto_proprio` decide por ele;
  /// sem o campo (API antiga), heurística: a opção não veio (autor de nível
  /// acima) ou o autor tem outro nível — mesmo nível conta como da própria
  /// conta.
  bool get votoDeOutro {
    if (votoProprio != null) return votadoPor != null && votoProprio == false;
    return votadoPor != null && (opcao == null || (tipoVinculo != null && tipoVinculo != votadoPor));
  }

  /// A opção que a tela marca como "Seu voto" nesta unidade: com
  /// `voto_proprio`, só quando ele é verdadeiro.
  String? get meuVoto {
    if (votoProprio != null) return votoProprio == true ? opcao : null;
    return votoDeOutro ? null : opcao;
  }
}

/// Unidades do usuário na votação [idVotacao], na ordem da API. API antiga
/// (sem `votosPorUnidade`) ou item sem `id_apto` → lista vazia / item ignorado.
List<UnidadeVoto> unidadesDaVotacao(dynamic votosPorUnidade, dynamic idVotacao) {
  if (votosPorUnidade is! List) return const [];
  final alvo = '${idVotacao ?? ''}'.trim();
  final out = <UnidadeVoto>[];
  for (final v in votosPorUnidade) {
    if (v is! Map) continue;
    if ('${v['id_votacao'] ?? ''}'.trim() != alvo) continue;
    final id = int.tryParse('${v['id_apto'] ?? ''}'.trim());
    if (id == null) continue;
    final opcao = textoLimpo(v['opcao']);
    final motivo = textoLimpo(v['motivo']);
    out.add(UnidadeVoto(
      idApto: id,
      rotulo: textoLimpo(v['rotulo']),
      opcao: opcao.isEmpty ? null : opcao,
      tipoVinculo: normalizarNivel(v['tipo_vinculo']),
      // Só um "não" explícito tira o direito: ausente/nulo = API antiga.
      podeVotar: v['pode_votar'] == null || _verdadeiro(v['pode_votar']),
      motivo: motivo.isEmpty ? null : motivo,
      votadoPor: normalizarNivel(v['votado_por']),
      votoProprio: v['voto_proprio'] == null ? null : _verdadeiro(v['voto_proprio']),
    ));
  }
  return out;
}

/// Unidade que a tela mostra escolhida: [atual] se ainda está na lista; senão
/// a primeira que pode votar e não votou; senão a primeira que não votou;
/// senão a primeira. Lista vazia → nulo.
int? unidadePadrao(List<UnidadeVoto> unidades, {int? atual}) {
  if (unidades.isEmpty) return null;
  if (atual != null && unidades.any((u) => u.idApto == atual)) return atual;
  for (final u in unidades) {
    if (!u.votou && u.podeVotar) return u.idApto;
  }
  for (final u in unidades) {
    if (!u.votou) return u.idApto;
  }
  return unidades.first.idApto;
}

/// Opções que a tela marca como "Seu voto" numa votação: com várias unidades,
/// ou quando a API manda `voto_proprio`, o voto próprio da [unidade]; senão
/// (uma unidade, API antiga) o campo antigo `meusVotos`/`meuVoto` da conta.
List<dynamic> meusVotosNaTela({
  required UnidadeVoto? unidade,
  required bool variasUnidades,
  required List<dynamic> meusVotosDaConta,
}) {
  if (unidade != null && (variasUnidades || unidade.votoProprio != null)) {
    final meu = unidade.meuVoto;
    return meu == null ? const [] : [meu];
  }
  return variasUnidades ? const [] : meusVotosDaConta;
}

/// "Votado pelo proprietário" etc. para o nível de quem votou; nulo sem nível.
/// Com [meuNivel] igual ao do autor (outra conta do mesmo nível):
/// "Votado por outro proprietário da unidade".
String? rotuloVotadoPor(String? nivel, {String? meuNivel}) {
  if (nivel != null && meuNivel == nivel) {
    switch (nivel) {
      case 'proprietario':
        return 'Votado por outro proprietário da unidade';
      case 'inquilino':
        return 'Votado por outro inquilino da unidade';
      case 'membro':
        return 'Votado por outro morador da unidade';
    }
  }
  switch (nivel) {
    case 'proprietario':
      return 'Votado pelo proprietário';
    case 'inquilino':
      return 'Votado pelo inquilino';
    case 'membro':
      return 'Votado por morador da unidade';
  }
  return null;
}

String? _nomeOpcao(String? id, List<OpcaoVotacao> opcoes) {
  if (id == null) return null;
  return opcoes.where((o) => o.id == id).map((o) => o.nome).firstOrNull ?? id;
}

/// O que a tela de votação mostra agora.
enum SituacaoVoto {
  /// Ainda não abriu (status 0).
  agendada,

  /// Aberta e a unidade ainda sem voto: escolher e votar.
  aberta,

  /// Trocando o próprio voto.
  alterando,

  /// O voto vigente é da própria conta.
  jaVotou,

  /// O voto vigente é de outro morador e o usuário pode votar por cima.
  votadoPorOutro,

  /// Aberta, mas o usuário não pode votar por esta unidade (`pode_votar`).
  semDireito,

  /// Encerrada (status 2).
  encerrada,

  /// Status desconhecido.
  desconhecida,
}

/// Decide a [SituacaoVoto] a partir do status (0/1/2), de o usuário já ter
/// votado com a própria conta ([jaVotou]), de estar alterando o voto e da
/// [unidade] escolhida (nula na API antiga: sem restrição). Fora do período
/// o status manda; aberta, a falta de direito vem antes de tudo.
SituacaoVoto situacaoVoto({
  required dynamic status,
  required bool jaVotou,
  bool alterando = false,
  UnidadeVoto? unidade,
}) {
  switch (_status(status)) {
    case 0:
      return SituacaoVoto.agendada;
    case 2:
      return SituacaoVoto.encerrada;
    case 1:
      if (unidade != null && !unidade.podeVotar) return SituacaoVoto.semDireito;
      if (jaVotou) return alterando ? SituacaoVoto.alterando : SituacaoVoto.jaVotou;
      if (unidade != null && unidade.votadoPor != null) return SituacaoVoto.votadoPorOutro;
      return SituacaoVoto.aberta;
  }
  return SituacaoVoto.desconhecida;
}

/// Se na [situacao] a tela mostra as opções para escolher e o botão "Votar".
bool podeEscolher(SituacaoVoto situacao) =>
    situacao == SituacaoVoto.aberta || situacao == SituacaoVoto.alterando || situacao == SituacaoVoto.votadoPorOutro;

/// Aviso quando o voto vigente da unidade é de outro morador:
/// `'Votado pelo inquilino: Aprovo. Se votar, o seu voto substitui este.'`
/// (opção visível) ou `'Votado pelo proprietário.'`.
String textoVotadoPorOutro(UnidadeVoto u, List<OpcaoVotacao> opcoes) {
  final rotulo = rotuloVotadoPor(u.votadoPor, meuNivel: u.tipoVinculo) ?? getText('votacao_unidade_ja_votou');
  final nome = _nomeOpcao(u.opcao, opcoes);
  if (nome == null) return '$rotulo.';
  return '$rotulo: $nome. Se votar, o seu voto substitui este.';
}

/// Aviso quando o usuário não pode votar pela unidade: o `motivo` da API
/// como veio (ele já diz quem votou: "O proprietário já votou por esta
/// unidade."); sem motivo, quem votou ou um texto genérico.
String textoSemDireito(UnidadeVoto u) {
  if (u.motivo != null) return u.motivo!;
  final quem = rotuloVotadoPor(u.votadoPor, meuNivel: u.tipoVinculo);
  return quem == null ? 'Esta unidade não pode votar nesta votação.' : '$quem.';
}

/// Título da faixa de bloqueio: com voto vigente de outro (hierarquia: "O
/// proprietário já votou…") o voto da unidade está registrado; sem ele, falta
/// direito (membro em pauta, somente proprietários).
String tituloSemDireito(UnidadeVoto u) =>
    u.votadoPor != null && !u.podeVotar ? 'Voto da unidade já registrado' : 'Sem direito a voto';

/// Linha de uma unidade no seletor: quem votou (outro morador), o voto
/// atual, o motivo de não poder votar ou "Ainda não votou".
String subtituloUnidade(UnidadeVoto u, List<OpcaoVotacao> opcoes) {
  if (u.votoDeOutro) {
    final rotulo = rotuloVotadoPor(u.votadoPor, meuNivel: u.tipoVinculo)!;
    final nome = _nomeOpcao(u.opcao, opcoes);
    return nome == null ? rotulo : '$rotulo: $nome';
  }
  if (u.opcao != null) return '${getText('votacao_unidade_voto_atual')}: ${_nomeOpcao(u.opcao, opcoes)}';
  if (!u.podeVotar) return u.motivo ?? 'Sem direito a voto';
  return getText('votacao_unidade_sem_voto');
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
  static Color get corAgendada => StatusReservaInfo.corPendente;

  /// Verde — em andamento, dá para votar.
  static Color get corAndamento => StatusReservaInfo.corAprovada;

  /// Cinza — finalizada (ou status desconhecido).
  static Color get corFinalizada => StatusReservaInfo.corNeutra;

  final String rotulo;
  final Color cor;
  final IconData icone;

  const StatusVotacaoInfo(this.rotulo, this.cor, this.icone);

  /// Cor para texto/ícone sobre o fundo tingido com [cor]: escurece no tema
  /// claro e clareia um pouco no escuro (mesma regra de
  /// `StatusReservaInfo.corTexto`).
  ///
  /// Se a cor do sinal não atinge contraste 4,5 com o fundo do selo (âmbar no
  /// tema claro), escurece (claro) ou clareia (escuro) até atingir.
  Color corTextoPara(Brightness brilho) {
    final escuro = brilho == Brightness.dark;
    final superficie = escuro ? AppColors.darkSurface : AppColors.lightSurface;
    final fundo = Color.alphaBlend(cor.withValues(alpha: escuro ? 0.2 : 0.1), superficie);
    var hsl = HSLColor.fromColor(cor);
    var c = cor;
    for (var i = 0; i < 20 && _contraste(c, fundo) < 4.5; i++) {
      hsl = hsl.withLightness((hsl.lightness + (escuro ? 0.03 : -0.03)).clamp(0.0, 1.0));
      c = hsl.toColor();
    }
    return c;
  }

  static double _contraste(Color a, Color b) {
    final x = a.computeLuminance(), y = b.computeLuminance();
    return (x > y ? x + 0.05 : y + 0.05) / (x > y ? y + 0.05 : x + 0.05);
  }

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
      return StatusVotacaoInfo('Sem status', StatusVotacaoInfo.corFinalizada, PhosphorIcons.question);
  }
}

/// Cor de destaque (primária) legível nos dois temas: no escuro usa o azul
/// claro `0xFF93B4F8`, o mesmo das telas de Áreas Sociais.
Color corDestaqueVotacao(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark ? AppColors.primary : AppColors.primary;
