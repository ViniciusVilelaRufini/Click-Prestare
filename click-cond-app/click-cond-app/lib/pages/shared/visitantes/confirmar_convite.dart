import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/modal_cupertino.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Confirmação de um convite que o visitante já preencheu.
///
/// A divisão da tela reflete quem sabe o quê: em cima, só leitura, o que o
/// VISITANTE informou (nome, CPF, foto) — o morador confere, não digita de
/// novo. Embaixo, o que só o MORADOR sabe: quando a pessoa entra, até quando
/// fica e, se for prestador, em que dias volta.
///
/// Observações não está aqui de propósito: o formulário de cadastro manual
/// tem o campo, mas a API não o persiste (não existe coluna em `Visitantes`),
/// então ele seria um campo de mentira.
class ConfirmarConvitePage extends StatefulWidget {
  const ConfirmarConvitePage({Key? key, required this.convite}) : super(key: key);

  final dynamic convite;

  @override
  State<ConfirmarConvitePage> createState() => _ConfirmarConvitePageState();
}

class _ConfirmarConvitePageState extends State<ConfirmarConvitePage> {
  final txtInicio = TextEditingController();
  final txtTermino = TextEditingController();
  final Set<int> _dias = {};
  bool _enviando = false;

  bool get _ehPrestador => widget.convite['is_prestador'] == 1;

  static const _nomesDias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  @override
  void dispose() {
    txtInicio.dispose();
    txtTermino.dispose();
    super.dispose();
  }

  String _cpfFormatado(dynamic cpf) {
    final d = (cpf ?? '').toString();
    if (d.length != 11) return d;
    return '${d.substring(0, 3)}.${d.substring(3, 6)}.${d.substring(6, 9)}-${d.substring(9)}';
  }

  Future<void> _confirmar() async {
    if (_enviando) return;

    // O servidor revalida; isto é só para não gastar uma ida até lá.
    final inicio = convertStringToDateTimeFormat(txtInicio.text);
    final termino = convertStringToDateTimeFormat(txtTermino.text);
    if (inicio != null && termino != null && termino.isBefore(inicio)) {
      displayMessage(context, 'Ops', 'A saída não pode ser antes da entrada.');
      return;
    }

    String? dataInicioFormatada;
    if (txtInicio.text.trim().isNotEmpty) {
      try {
        dataInicioFormatada = convertStringToDateTime(txtInicio.text.trim());
      } catch (_) {
        dataInicioFormatada = txtInicio.text.trim();
      }
    }

    String? dataTerminoFormatada;
    if (txtTermino.text.trim().isNotEmpty) {
      try {
        dataTerminoFormatada = convertStringToDateTime(txtTermino.text.trim());
      } catch (_) {
        dataTerminoFormatada = txtTermino.text.trim();
      }
    }

    setState(() => _enviando = true);
    final res = await apiResponderConvite(
      widget.convite['id'] is int
          ? widget.convite['id']
          : int.tryParse('${widget.convite['id']}') ?? 0,
      confirmar: true,
      dataInicio: dataInicioFormatada,
      dataTermino: dataTerminoFormatada,
      diasSemana: _ehPrestador && _dias.isNotEmpty ? (_dias.toList()..sort()).join(',') : null,
    );
    if (!mounted) return;
    setState(() => _enviando = false);

    if (res is Map && res['ok'] == true) {
      Navigator.pop(context, true);
    } else {
      displayMessage(context, 'Ops',
          (res is Map ? res['erro'] : null)?.toString() ?? 'Não foi possível confirmar.');
    }
  }

  Future<void> _recusar() async {
    final ok = await showConfirmDialog(
      context,
      text: 'Recusar o cadastro de ${widget.convite['nome']}? A foto enviada será apagada.',
    );
    if (ok != true) return;

    setState(() => _enviando = true);
    final res = await apiResponderConvite(
      widget.convite['id'] is int
          ? widget.convite['id']
          : int.tryParse('${widget.convite['id']}') ?? 0,
      confirmar: false,
    );
    if (!mounted) return;
    setState(() => _enviando = false);

    if (res is Map && res['ok'] == true) {
      Navigator.pop(context, true);
    } else {
      displayMessage(context, 'Ops',
          (res is Map ? res['erro'] : null)?.toString() ?? 'Não foi possível recusar.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Confirmar entrada',
      showBackButton: true,
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
        child: Row(children: [
          Expanded(
            child: OutlinedButton(
              onPressed: _enviando ? null : _recusar,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 48),
                side: BorderSide(color: AppColors.error.withOpacity(0.5)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text('Recusar', style: TextStyle(color: AppColors.error)),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            flex: 2,
            child: ElevatedButton(
              onPressed: _enviando ? null : _confirmar,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                minimumSize: const Size(0, 48),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: _enviando
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Confirmar entrada'),
            ),
          ),
        ]),
      ),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          _dadosDoVisitante(),
          const SizedBox(height: AppSpacing.xl),
          _secao('PERÍODO DA VISITA'),
          const SizedBox(height: AppSpacing.sm),
          AppInput(
            label: getText('visitantes_data_hora_inicio'),
            controller: txtInicio,
            prefixIcon: PhosphorIcons.calendarBlank,
            readOnly: true,
            onTap: () => showCupertinoModalPopup(
              context: context,
              builder: (_) => ModalCupertino(
                onPressed: (text) => setState(() => txtInicio.text = text),
                initialDate: DateTime.now(),
                type: 'datetime',
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          AppInput(
            label: getText('visitantes_data_hora_termino'),
            controller: txtTermino,
            prefixIcon: PhosphorIcons.calendarCheck,
            readOnly: true,
            onTap: () => showCupertinoModalPopup(
              context: context,
              builder: (_) => ModalCupertino(
                onPressed: (text) => setState(() => txtTermino.text = text),
                initialDate: convertStringToDateTimeFormat(txtInicio.text) ?? DateTime.now(),
                type: 'datetime',
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.sm),
            child: Text(
              'Pode deixar em branco — a entrada fica valendo a partir de agora.',
              style: AppTypography.tiny(context).copyWith(color: AppColors.textTertiary(context)),
            ),
          ),
          if (_ehPrestador) ...[
            const SizedBox(height: AppSpacing.xl),
            _secao('DIAS EM QUE O PRESTADOR VOLTA'),
            const SizedBox(height: AppSpacing.sm),
            _seletorDias(),
          ],
        ],
      ),
    );
  }

  Widget _secao(String texto) {
    return Text(
      texto,
      style: AppTypography.tiny(context).copyWith(
        color: AppColors.textTertiary(context),
        fontWeight: FontWeight.w700,
        letterSpacing: 1.2,
      ),
    );
  }

  Widget _dadosDoVisitante() {
    final foto = (widget.convite['foto_url'] ?? '').toString();

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: foto.isNotEmpty
              ? Image.network(foto, width: double.infinity, height: 200, fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => _semFoto())
              : _semFoto(),
        ),
        const SizedBox(height: AppSpacing.md),
        Text('${widget.convite['nome'] ?? ''}',
            textAlign: TextAlign.center,
            style: AppTypography.title(context).copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 2),
        Text(_cpfFormatado(widget.convite['cpf']),
            style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context))),
        const SizedBox(height: AppSpacing.sm),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: AppColors.primary.withOpacity(0.1),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            _ehPrestador ? 'Prestador de serviço' : 'Visitante',
            style: AppTypography.tiny(context)
                .copyWith(color: AppColors.primary, fontWeight: FontWeight.bold),
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'Enviado pela própria pessoa, pelo link.',
          style: AppTypography.tiny(context).copyWith(color: AppColors.textTertiary(context)),
        ),
      ]),
    );
  }

  Widget _seletorDias() {
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: List.generate(7, (i) {
        final marcado = _dias.contains(i);
        return GestureDetector(
          onTap: () => setState(() => marcado ? _dias.remove(i) : _dias.add(i)),
          child: Container(
            width: 46,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: marcado ? AppColors.primary : AppColors.surface(context),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: marcado ? AppColors.primary : AppColors.border(context),
              ),
            ),
            child: Text(
              _nomesDias[i],
              style: AppTypography.tiny(context).copyWith(
                color: marcado ? Colors.white : AppColors.textSecondary(context),
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        );
      }),
    );
  }

  Widget _semFoto() {
    return Container(
      width: double.infinity,
      height: 200,
      color: AppColors.bg(context),
      child: Icon(PhosphorIcons.user, size: 48, color: AppColors.textTertiary(context)),
    );
  }
}
