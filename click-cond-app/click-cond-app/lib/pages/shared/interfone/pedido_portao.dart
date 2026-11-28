import 'dart:async';

import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/log.dart';
import 'package:click/utils/navigation_service.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_filtro_chip.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_tag.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Respostas rápidas que vão ao visitante junto da decisão.
const List<String> mensagensRapidasDoPedido = ['Já desço', 'Deixe na portaria', 'Volte mais tarde'];

const int limiteMensagemDoPedido = 120;

String rotuloDoTipoDoPedido(String? tipo) {
  switch (tipo) {
    case 'visita':
      return 'Visita';
    case 'entrega':
      return 'Entrega';
    case 'servico':
      return 'Serviço';
    case 'outro':
      return 'Outro';
    default:
      return '';
  }
}

/// Tela do pedido de abertura do portão (portaria autônoma): quem está na
/// portaria, o que diz querer e os botões Autorizar / Negar, com resposta
/// rápida opcional. Abre pelo push `interfone_pedido` ou pelo toque no aviso
/// e fecha sozinha no `interfone_pedido_fim`.
class PedidoPortaoPage extends StatefulWidget {
  final int id;

  /// O que o push trouxe (nome, motivo, foto, portão...), mostrado enquanto o
  /// estado não chega da API.
  final PedidoPortao? inicial;

  /// Quanto a tela espera com o resultado antes de fechar sozinha.
  final Duration esperaAoFechar;

  const PedidoPortaoPage({
    super.key,
    required this.id,
    this.inicial,
    this.esperaAoFechar = const Duration(seconds: 3),
  });

  /// Telas abertas por id (o `interfone_pedido_fim` fecha a certa).
  static final Map<int, _PedidoPortaoPageState> _abertas = {};

  /// Ids com a rota sendo empurrada (o mesmo push duas vezes não abre duas).
  static final Set<int> _abrindo = {};

  /// Push `interfone_pedido`: abre a tela por cima do que estiver aberto.
  /// Nunca lança; sem navegador pronto (isolate de segundo plano) não faz nada.
  static Future<void> abrir(Map<String, dynamic> data) async {
    final id = int.tryParse('${data['id'] ?? ''}');
    if (id == null || id <= 0) return;
    if (_abertas.containsKey(id) || _abrindo.contains(id)) return;
    final nav = NavigationService.navigatorKey.currentState;
    if (nav == null) return;
    _abrindo.add(id);
    try {
      await nav.push(MaterialPageRoute<void>(
        builder: (_) => PedidoPortaoPage(id: id, inicial: PedidoPortao.doPush(data)),
      ));
    } catch (e) {
      logDebug('[Pedido] abrir: ${e.runtimeType}');
    } finally {
      _abrindo.remove(id);
    }
  }

  /// Toque no aviso: o app pode estar abrindo, então espera o navegador.
  static Future<void> abrirPeloAviso(Map<String, dynamic> data) async {
    for (var i = 0; i < 25 && NavigationService.navigatorKey.currentState == null; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 200));
    }
    await abrir(data);
  }

  /// Push `interfone_pedido_fim`: fecha a tela do pedido, se aberta.
  static void aoFim(int id) {
    _abertas[id]?._fecharPeloFim();
  }

  @override
  State<PedidoPortaoPage> createState() => _PedidoPortaoPageState();
}

class _PedidoPortaoPageState extends State<PedidoPortaoPage> {
  late PedidoPortao _pedido;
  final TextEditingController _texto = TextEditingController();
  bool _enviando = false;

  /// A decisão foi tocada aqui (o resultado é "Portão aberto"/"Negado", não
  /// "Respondido por").
  bool _respondiLocal = false;
  String? _erro;
  bool _indisponivel = false;
  bool _semAtualizar = false;
  bool _fechando = false;

  @override
  void initState() {
    super.initState();
    PedidoPortaoPage._abertas[widget.id] = this;
    _pedido = widget.inicial ?? PedidoPortao(id: widget.id);
    unawaited(_carregar());
  }

  @override
  void dispose() {
    if (PedidoPortaoPage._abertas[widget.id] == this) PedidoPortaoPage._abertas.remove(widget.id);
    _texto.dispose();
    super.dispose();
  }

  Future<void> _carregar() async {
    try {
      final novo = await InterfoneApi.pedido(widget.id);
      if (!mounted) return;
      setState(() => _pedido = _pedido.mesclar(novo));
      _agendarFechamentoSeFinal();
      if (mounted && _semAtualizar) setState(() => _semAtualizar = false);
    } on PedidoPortaoErro catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.status == 403 || e.status == 404) {
          _indisponivel = true;
        } else {
          _semAtualizar = true;
        }
      });
    }
  }

  void _fecharPeloFim() {
    if (_fechando || !mounted) return;
    _fechando = true;
    // Só a rota do pedido: um diálogo por cima dela não é fechado aqui.
    final rota = ModalRoute.of(context);
    if (rota == null) return;
    if (rota.isCurrent) {
      Navigator.of(context).pop();
    } else if (rota.isActive) {
      Navigator.of(context).removeRoute(rota);
    }
  }

  void _agendarFechamentoSeFinal() {
    if (_pedido.pendente || _fechando) return;
    Future<void>.delayed(widget.esperaAoFechar, () {
      if (mounted && !_fechando) _fecharPeloFim();
    });
  }

  Future<void> _responder(String decisao) async {
    if (_enviando || !_pedido.pendente) return;
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      final novo = await InterfoneApi.responderPedido(widget.id, decisao, mensagem: _texto.text);
      if (!mounted) return;
      setState(() {
        _pedido = _pedido.mesclar(novo);
        _respondiLocal = true;
        _enviando = false;
      });
      _agendarFechamentoSeFinal();
    } on PedidoPortaoErro catch (e) {
      if (!mounted) return;
      setState(() => _enviando = false);
      if (e.status == 409) {
        // Já respondido (por outro morador) ou expirado: mostra o estado real.
        await _carregar();
        if (mounted && _pedido.pendente) {
          setState(() => _pedido = PedidoPortao(
                id: _pedido.id,
                estado: e.motivo == 'pedido_expirado' ? 'expirado' : 'respondido',
                nome: _pedido.nome,
                motivo: _pedido.motivo,
                tipo: _pedido.tipo,
                unidade: _pedido.unidade,
                condominio: _pedido.condominio,
                portao: _pedido.portao,
                fotoUrl: _pedido.fotoUrl,
              ));
          _agendarFechamentoSeFinal();
        }
      } else {
        setState(() => _erro = e.status == 403
            ? 'Você não pode responder a este pedido.'
            : 'Não foi possível enviar a resposta. Tente de novo.');
      }
    }
  }

  bool get _livre => !_enviando && _pedido.pendente && !_indisponivel;

  String get _rotuloFinal {
    final por = !_respondiLocal ? _pedido.respondidoPorNome : null;
    switch (_pedido.estado) {
      case 'autorizado':
        return por != null ? 'Respondido por $por · Portão aberto' : 'Portão aberto';
      case 'negado':
        return por != null ? 'Respondido por $por · Negado' : 'Negado';
      case 'expirado':
        return 'Expirado';
      case 'respondido':
        return 'Já respondido';
      default:
        return '';
    }
  }

  AppSignal get _sinalFinal {
    switch (_pedido.estado) {
      case 'autorizado':
        return AppSignal.ok;
      case 'negado':
        return AppSignal.danger;
      default:
        return AppSignal.warn;
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _pedido;
    final tipo = rotuloDoTipoDoPedido(p.tipo);
    final local = [p.portao, p.condominio].whereType<String>().where((t) => t.isNotEmpty).join(' · ');
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('PEDIDO NO PORTÃO', style: AppTypography.label(context)),
              AppSpacing.gapMd,
              _foto(context, p.fotoUrl),
              AppSpacing.gapXl,
              Text(
                'Na portaria: ${p.nome ?? 'visitante'}'.toUpperCase(),
                key: const Key('pedido-nome'),
                style: AppTypography.title(context),
              ),
              if (p.motivo != null) ...[
                AppSpacing.gapSm,
                Text(p.motivo!, key: const Key('pedido-motivo'), style: AppTypography.body(context)),
              ],
              AppSpacing.gapMd,
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (tipo.isNotEmpty) AppTag(label: tipo),
                  if (p.unidade != null) AppTag(label: p.unidade!),
                ],
              ),
              if (local.isNotEmpty) ...[
                AppSpacing.gapSm,
                Text(local, style: AppTypography.bodySecondary(context)),
              ],
              AppSpacing.gapXl,
              if (_indisponivel) ...[
                Text('PEDIDO INDISPONÍVEL', key: const Key('pedido-indisponivel'), style: AppTypography.strong(context)),
                AppSpacing.gapXl,
              ] else if (!p.pendente) ...[
                _resultado(context),
                AppSpacing.gapXl,
              ],
              if (_semAtualizar && p.pendente) ...[
                Text('Não foi possível atualizar', key: const Key('pedido-sem-atualizar'), style: AppTypography.caption(context)),
                AppSpacing.gapMd,
              ],
              ..._acoes(context),
              if (_erro != null) ...[
                AppSpacing.gapMd,
                Text(_erro!, key: const Key('pedido-erro'), style: AppTypography.strong(context)),
              ],
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _acoes(BuildContext context) {
    return [
      Text('RESPOSTA RÁPIDA', style: AppTypography.label(context)),
      AppSpacing.gapSm,
      ListenableBuilder(
        listenable: _texto,
        builder: (context, _) => Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final m in mensagensRapidasDoPedido)
              AppFiltroChip(
                label: m,
                selected: _texto.text == m,
                onTap: !_livre ? () {} : () => _texto.text = _texto.text == m ? '' : m,
              ),
          ],
        ),
      ),
      AppSpacing.gapMd,
      AppInput(
        label: 'Mensagem ao visitante',
        hint: 'Opcional',
        controller: _texto,
        formatters: [LengthLimitingTextInputFormatter(limiteMensagemDoPedido)],
        readOnly: !_livre,
      ),
      AppSpacing.gapXl,
      AppButton(
        label: 'Autorizar',
        icon: PhosphorIcons.lockOpen,
        loading: _enviando,
        onPressed: !_livre ? null : () => _responder('autorizar'),
      ),
      AppSpacing.gapXs,
      Text(
        'Abre o portão uma vez',
        textAlign: TextAlign.center,
        style: AppTypography.caption(context),
      ),
      AppSpacing.gapMd,
      AppButton(
        label: 'Negar',
        icon: PhosphorIcons.x,
        variant: AppButtonVariant.danger,
        onPressed: !_livre ? null : () => _responder('negar'),
      ),
    ];
  }

  Widget _resultado(BuildContext context) {
    return Row(
      children: [
        AppDot(signal: _sinalFinal),
        AppSpacing.gapSm,
        Expanded(
          child: Text(
            _rotuloFinal.toUpperCase(),
            key: const Key('pedido-resultado'),
            style: AppTypography.strong(context),
          ),
        ),
      ],
    );
  }

  Widget _foto(BuildContext context, String? url) {
    return Container(
      height: 220,
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: ClipRect(
        child: url == null
            ? _semFoto(context)
            : Image.network(url, fit: BoxFit.contain, errorBuilder: (_, __, ___) => _semFoto(context)),
      ),
    );
  }

  Widget _semFoto(BuildContext context) =>
      Center(child: Icon(PhosphorIcons.user, size: 48, color: AppColors.textTertiary(context)));
}
