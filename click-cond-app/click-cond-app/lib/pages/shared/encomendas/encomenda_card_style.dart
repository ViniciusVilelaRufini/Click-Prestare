import 'package:click/models/encomenda_model.dart';
import 'package:click/pages/shared/delivery/delivery_status_style.dart'
    show deliveryDayLabel;
import 'package:click/theme/app_colors.dart';
import 'package:click/utils/rotulo_bloco.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Situação da encomenda para a lista.
enum EncomendaKind { esperando, aguardando, entregue, cancelada }

/// Tom da linha de status do card.
enum EncomendaTier { normal, atrasada, aCaminho, entregue, cancelada }

/// Filtros do seletor da lista.
enum EncomendaFiltro { todas, aguardando, entregues }

/// Seção da lista: cabeçalho opcional + encomendas. [major] distingue as
/// seções principais ('Aguardando retirada (n)', 'Entregues (n)') dos
/// cabeçalhos de dia, que ficam subordinados.
typedef EncomendaSection = ({String? title, bool major, List<EncomendaModel> items});

EncomendaKind encomendaKind(String? status) {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'retirado':
    case 'retirada':
    case 'entregue':
      return EncomendaKind.entregue;
    case 'cancelado':
    case 'cancelada':
    case 'recusado':
    case 'recusada':
      return EncomendaKind.cancelada;
    case 'esperando':
      return EncomendaKind.esperando;
    default:
      return EncomendaKind.aguardando;
  }
}

bool _aguardando(EncomendaModel e) {
  final kind = encomendaKind(e.status);
  return kind == EncomendaKind.aguardando || kind == EncomendaKind.esperando;
}

DateTime? _parse(String? iso) =>
    iso == null ? null : DateTime.tryParse(iso)?.toLocal();

String? _texto(String? value) {
  final s = value?.trim() ?? '';
  return s.isEmpty || s.toUpperCase() == 'N/A' || s == 'null' ? null : s;
}

/// '28/09 às 18:38' (com o ano quando não é o ano corrente).
String _dataHora(DateTime d, DateTime now) =>
    DateFormat(d.year == now.year ? "dd/MM 'às' HH:mm" : "dd/MM/yyyy 'às' HH:mm")
        .format(d);

/// Data usada para entregue/cancelada: retirada, senão chegada.
DateTime? _dataEncerramento(EncomendaModel e) =>
    _parse(e.retiradoEm) ?? _parse(e.recebidoEm);

/// Linha de status do card: 'Na portaria há 6 dias' (vermelha depois de 7
/// dias), 'Chegou agora', 'A caminho — ainda não chegou', 'Retirada por
/// Maria', 'Cancelada'.
({String text, EncomendaTier tier}) encomendaStatusLine(EncomendaModel e,
    {DateTime? now}) {
  final ref = now ?? DateTime.now();
  switch (encomendaKind(e.status)) {
    case EncomendaKind.esperando:
      return (text: 'A caminho — ainda não chegou', tier: EncomendaTier.aCaminho);
    case EncomendaKind.entregue:
      // A data vai numa linha própria (encomendaDoneDate): junto, cortava
      // nomes compridos.
      final quem = _texto(e.retiradoPor);
      return (
        text: quem == null ? 'Retirada' : 'Retirada por $quem',
        tier: EncomendaTier.entregue,
      );
    case EncomendaKind.cancelada:
      return (text: 'Cancelada', tier: EncomendaTier.cancelada);
    case EncomendaKind.aguardando:
      final chegada = _parse(e.recebidoEm);
      if (chegada == null) return (text: 'Na portaria', tier: EncomendaTier.normal);
      final diff = ref.difference(chegada);
      // Dias de calendário: chegou dia 28 às 18:38 e hoje é dia 4 = 6 dias.
      final dias = DateTime(ref.year, ref.month, ref.day)
          .difference(DateTime(chegada.year, chegada.month, chegada.day))
          .inDays;
      final tier = dias > 7 ? EncomendaTier.atrasada : EncomendaTier.normal;
      if (diff.inMinutes < 1) return (text: 'Chegou agora', tier: tier);
      if (diff.inMinutes < 60) {
        return (text: 'Na portaria há ${diff.inMinutes} min', tier: tier);
      }
      if (diff.inHours < 24) {
        return (text: 'Na portaria há ${diff.inHours} h', tier: tier);
      }
      return (
        text: 'Na portaria há $dias ${dias == 1 ? 'dia' : 'dias'}',
        tier: tier,
      );
  }
}

/// Data das encerradas, em linha própria: 'hoje às 10:12', 'ontem às 21:10',
/// '30/09 às 10:12'. A entregue usa a retirada; a cancelada, a retirada ou a
/// chegada. Null para as que aguardam ou sem data.
String? encomendaDoneDate(EncomendaModel e, {DateTime? now}) {
  final kind = encomendaKind(e.status);
  final DateTime? data;
  if (kind == EncomendaKind.entregue) {
    data = _parse(e.retiradoEm);
  } else if (kind == EncomendaKind.cancelada) {
    data = _dataEncerramento(e);
  } else {
    return null;
  }
  if (data == null) return null;
  final ref = now ?? DateTime.now();
  final dias = DateTime(data.year, data.month, data.day)
      .difference(DateTime(ref.year, ref.month, ref.day))
      .inDays;
  final hora = DateFormat('HH:mm').format(data);
  if (dias == 0) return 'hoje às $hora';
  if (dias == -1) return 'ontem às $hora';
  return _dataHora(data, ref);
}

/// Cor da linha de status; mais escura no tema claro para ter contraste.
Color encomendaTierColor(BuildContext context, EncomendaTier tier) {
  final base = switch (tier) {
    EncomendaTier.normal => AppColors.warning,
    EncomendaTier.atrasada => AppColors.error,
    EncomendaTier.aCaminho => AppColors.primary,
    EncomendaTier.entregue => AppColors.success,
    EncomendaTier.cancelada => AppColors.error,
  };
  return Theme.of(context).brightness == Brightness.dark
      ? Color.lerp(base, Colors.white, 0.12)!
      : Color.lerp(base, Colors.black, 0.28)!;
}

/// Linha discreta do card que aguarda: 'Correios · chegou 28/09 às 18:38'
/// (sem remetente vazio ou 'N/A'); null quando não há nada a mostrar.
String? encomendaMetaLine(EncomendaModel e, {DateTime? now}) {
  final ref = now ?? DateTime.now();
  final chegada = _parse(e.recebidoEm);
  final partes = [
    if (_texto(e.recebidoDe) != null) _texto(e.recebidoDe)!,
    if (chegada != null) 'chegou ${_dataHora(chegada, ref)}',
  ];
  return partes.isEmpty ? null : partes.join(' · ');
}

/// 'Bloco A • Apto 106' / 'Apto 106'; null sem apartamento.
String? encomendaUnitLabel(EncomendaModel e) {
  final apto = _texto(e.destinatarioApto);
  if (apto == null) return null;
  final bloco = rotuloBloco(e.destinatarioBloco);
  return bloco.isEmpty ? 'Apto $apto' : '$bloco • Apto $apto';
}

/// O selo da unidade só ajuda quando há o que distinguir: equipe (vê o
/// condomínio todo) ou lista com mais de uma unidade.
bool showUnitBadge(List<EncomendaModel> visiveis, {required bool isStaff}) {
  if (isStaff) return visiveis.isNotEmpty;
  final unidades = visiveis
      .map((e) => '${(e.destinatarioBloco ?? '').trim().toLowerCase()}|'
          '${(e.destinatarioApto ?? '').trim().toLowerCase()}')
      .toSet();
  return unidades.length > 1;
}

bool encomendaNoFiltro(EncomendaModel e, EncomendaFiltro filtro) =>
    switch (filtro) {
      EncomendaFiltro.todas => true,
      EncomendaFiltro.aguardando => _aguardando(e),
      EncomendaFiltro.entregues => !_aguardando(e),
    };

int encomendaCount(List<EncomendaModel> lista, EncomendaFiltro filtro) =>
    lista.where((e) => encomendaNoFiltro(e, filtro)).length;

/// Seções da lista: as que aguardam (a mais antiga primeiro, a caminho no
/// fim) e as encerradas (mais recentes primeiro, sob cabeçalhos de dia).
List<EncomendaSection> encomendaSections(
    List<EncomendaModel> lista, EncomendaFiltro filtro,
    {DateTime? now}) {
  final aguardando = lista.where(_aguardando).toList()
    ..sort((a, b) {
      final da = _parse(a.recebidoEm);
      final db = _parse(b.recebidoEm);
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da.compareTo(db);
    });
  final encerradas = lista.where((e) => !_aguardando(e)).toList()
    ..sort((a, b) {
      final da = _dataEncerramento(a);
      final db = _dataEncerramento(b);
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return db.compareTo(da);
    });

  final porDia = <String, List<EncomendaModel>>{};
  for (final e in encerradas) {
    porDia
        .putIfAbsent(deliveryDayLabel(_dataEncerramento(e), now: now), () => [])
        .add(e);
  }
  final dias = <EncomendaSection>[
    for (final entry in porDia.entries)
      (title: entry.key, major: false, items: entry.value)
  ];

  switch (filtro) {
    case EncomendaFiltro.aguardando:
      return aguardando.isEmpty ? [] : [(title: null, major: true, items: aguardando)];
    case EncomendaFiltro.entregues:
      return dias;
    case EncomendaFiltro.todas:
      return [
        if (aguardando.isNotEmpty)
          (title: 'Aguardando retirada (${aguardando.length})', major: true, items: aguardando),
        // Cabeçalho principal antes dos dias, para eles não parecerem parte
        // da seção de cima.
        if (encerradas.isNotEmpty)
          (title: 'Entregues (${encerradas.length})', major: true, items: const <EncomendaModel>[]),
        ...dias,
      ];
  }
}
