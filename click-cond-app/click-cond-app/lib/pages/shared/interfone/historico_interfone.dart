import 'package:click/pages/shared/interfone/tela_chamada.dart';
import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_tag.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Rótulo do tipo de chamada no histórico.
String rotuloTipoChamada(String tipo) {
  switch (tipo) {
    case 'facial_unidade':
      return 'Interfone do portão';
    case 'portaria_unidade':
      return 'A portaria ligou';
    case 'unidade_portaria':
      return 'Ligação para a portaria';
    default:
      return 'Chamada';
  }
}

/// Rótulo do resultado de uma chamada, com quem atendeu quando houver.
String rotuloResultadoChamada(String? resultado, String? atendidaPor) {
  switch (resultado) {
    case 'atendida_morador':
      return atendidaPor == null ? 'Atendida' : 'Atendida por $atendidaPor';
    case 'atendida_portaria':
      return atendidaPor == null ? 'Atendida pela portaria' : 'Atendida pela portaria ($atendidaPor)';
    case 'nao_atendida':
      return 'Não atendida';
    case 'recusada':
      return 'Recusada';
    case 'cancelada':
      return 'Desligou antes de atender';
    case 'falha':
      return 'Falhou';
    case null:
      return 'Em andamento';
    default:
      return resultado;
  }
}

AppSignal _sinalDoResultado(String? resultado) {
  switch (resultado) {
    case 'atendida_morador':
    case 'atendida_portaria':
      return AppSignal.ok;
    case 'nao_atendida':
    case 'recusada':
    case 'falha':
      return AppSignal.danger;
    case null:
      return AppSignal.warn;
    default:
      return AppSignal.neutral;
  }
}

/// Interfone da unidade: botão "Ligar para a portaria" e as chamadas dos
/// últimos 30 dias (data, tipo, foto do visitante, quem atendeu, portão aberto).
class HistoricoInterfonePage extends StatefulWidget {
  final int idApartamento;

  /// "Bloco A · Apto 106", mostrado na ligação para a portaria.
  final String? unidade;

  const HistoricoInterfonePage({super.key, required this.idApartamento, this.unidade});

  @override
  State<HistoricoInterfonePage> createState() => _HistoricoInterfonePageState();
}

class _HistoricoInterfonePageState extends State<HistoricoInterfonePage> {
  List<ItemHistoricoInterfone>? _itens;
  bool _carregando = true;
  bool _ligando = false;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() => _carregando = true);
    final itens = await InterfoneApi.historico(widget.idApartamento);
    if (!mounted) return;
    setState(() {
      _itens = itens;
      _carregando = false;
    });
  }

  Future<void> _ligar() async {
    if (_ligando) return;
    setState(() => _ligando = true);
    await ligarParaPortaria(context, widget.idApartamento, unidade: widget.unidade);
    if (mounted) setState(() => _ligando = false);
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Interfone',
      body: RefreshIndicator(
        onRefresh: _carregar,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.xl),
          children: [
            AppButton(
              label: 'Ligar para a portaria',
              icon: PhosphorIcons.phoneOutgoing,
              fullWidth: true,
              size: AppButtonSize.lg,
              loading: _ligando,
              onPressed: _ligar,
            ),
            AppSpacing.gapXxl,
            Text('Chamadas dos últimos 30 dias'.toUpperCase(), style: AppTypography.section(context)),
            AppSpacing.gapMd,
            ..._conteudo(context),
          ],
        ),
      ),
    );
  }

  List<Widget> _conteudo(BuildContext context) {
    if (_carregando && _itens == null) {
      return [
        Padding(
          padding: const EdgeInsets.all(AppSpacing.xxl),
          child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
        ),
      ];
    }
    final itens = _itens;
    if (itens == null) {
      return [
        Text('Não foi possível carregar as chamadas.', style: AppTypography.bodySecondary(context)),
        AppSpacing.gapMd,
        AppButton(label: 'Tentar de novo', variant: AppButtonVariant.secondary, onPressed: _carregar),
      ];
    }
    if (itens.isEmpty) {
      return [Text('Nenhuma chamada nos últimos 30 dias.', style: AppTypography.bodySecondary(context))];
    }
    return [
      for (final item in itens) ...[
        _LinhaChamada(item: item),
        AppSpacing.gapSm,
      ],
    ];
  }
}

class _LinhaChamada extends StatelessWidget {
  final ItemHistoricoInterfone item;
  const _LinhaChamada({required this.item});

  @override
  Widget build(BuildContext context) {
    final inicio = item.inicio;
    // A API manda UTC (toISOString): mostra no fuso do aparelho.
    final quando = inicio == null ? '' : DateFormat('dd/MM HH:mm').format(inicio.toLocal());
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        border: Border.all(color: AppColors.border(context)),
      ),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Foto(url: item.fotoUrl, tipo: item.tipo),
          AppSpacing.gapMd,
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(rotuloTipoChamada(item.tipo), style: AppTypography.strong(context)),
                if (quando.isNotEmpty) Text(quando, style: AppTypography.tiny(context)),
                AppSpacing.gapXs,
                Row(
                  children: [
                    AppDot(signal: _sinalDoResultado(item.resultado)),
                    AppSpacing.gapSm,
                    Flexible(
                      child: Text(
                        rotuloResultadoChamada(item.resultado, item.atendidaPorNome),
                        style: AppTypography.bodySecondary(context),
                      ),
                    ),
                  ],
                ),
                if (item.portaAberta) ...[
                  AppSpacing.gapSm,
                  const AppTag(label: 'Portão aberto', signal: AppSignal.ok),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Foto extends StatelessWidget {
  final String? url;
  final String tipo;
  const _Foto({required this.url, required this.tipo});

  static const double _lado = 56;

  @override
  Widget build(BuildContext context) {
    final icone = Icon(
      tipo == 'facial_unidade' ? PhosphorIcons.door : PhosphorIcons.phone,
      size: 22,
      color: AppColors.textTertiary(context),
    );
    return Container(
      width: _lado,
      height: _lado,
      alignment: Alignment.center,
      decoration: BoxDecoration(border: Border.all(color: AppColors.border(context))),
      child: url == null
          ? icone
          : Image.network(url!, width: _lado, height: _lado, fit: BoxFit.cover, errorBuilder: (_, __, ___) => icone),
    );
  }
}
