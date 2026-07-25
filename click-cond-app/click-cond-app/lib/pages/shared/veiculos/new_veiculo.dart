import 'package:click/controllers/controller_veiculos.dart';
import 'package:click/models/veiculo_model.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewVeiculo extends StatefulWidget {
  final VeiculoModel? veiculo;
  const NewVeiculo({Key? key, this.veiculo}) : super(key: key);

  @override
  State<NewVeiculo> createState() => _NewVeiculoState();
}

class _NewVeiculoState extends State<NewVeiculo> {
  final _formKey = GlobalKey<FormState>();
  final _placa = TextEditingController();
  final _cor = TextEditingController();
  final _modelo = TextEditingController();
  final _tag = TextEditingController();
  bool _saving = false;

  bool get _isEdit => widget.veiculo != null;

  @override
  void initState() {
    super.initState();
    if (widget.veiculo != null) {
      _placa.text = widget.veiculo!.placa ?? '';
      _cor.text = widget.veiculo!.cor ?? '';
      _modelo.text = widget.veiculo!.marcaModelo ?? '';
      _tag.text = widget.veiculo!.tagCodigo ?? '';
    }
  }

  @override
  void dispose() {
    _placa.dispose();
    _cor.dispose();
    _modelo.dispose();
    _tag.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);

    final obj = VeiculoModel(
      id: widget.veiculo?.id,
      placa: _placa.text.trim().toUpperCase(),
      cor: _cor.text.trim(),
      marcaModelo: _modelo.text.trim(),
      tagCodigo: _tag.text.trim(),
    ).toJson(incluirTag: true);

    final err = await apiSaveVeiculo(obj, _isEdit);
    if (!mounted) return;
    setState(() => _saving = false);

    if (err.isEmpty) {
      displayMessageWithReturn(context, 'Sucesso',
              _isEdit ? 'Veículo atualizado!' : 'Veículo cadastrado!')
          .then((_) {
        if (mounted) Navigator.pop(context);
      });
    } else {
      displayMessage(context, 'Erro', err);
    }
  }

  InputDecoration _dec(String label) => InputDecoration(
        labelText: label,
        labelStyle: AppTypography.caption(context),
        border: const OutlineInputBorder(),
        focusedBorder: const OutlineInputBorder(
          borderSide: BorderSide(color: AppColors.primary, width: 1.5),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: _isEdit ? 'Editar Veículo' : 'Novo Veículo',
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            TextFormField(
              controller: _placa,
              textCapitalization: TextCapitalization.characters,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp('[a-zA-Z0-9- ]')),
                UpperCaseTextFormatter(),
              ],
              style: AppTypography.body(context),
              decoration: _dec('Placa *'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Informe a placa' : null,
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _cor,
              textCapitalization: TextCapitalization.words,
              style: AppTypography.body(context),
              decoration: _dec('Cor'),
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _modelo,
              textCapitalization: TextCapitalization.words,
              style: AppTypography.body(context),
              decoration: _dec('Marca / Modelo'),
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _tag,
              textCapitalization: TextCapitalization.characters,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp('[a-zA-Z0-9-]')),
                UpperCaseTextFormatter(),
              ],
              style: AppTypography.body(context),
              decoration: _dec('Tag de acesso (opcional)').copyWith(
                prefixIcon: Icon(PhosphorIcons.identificationCard,
                    size: 18, color: AppColors.primary),
              ),
            ),
            const SizedBox(height: 6),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(PhosphorIcons.info,
                    size: 14, color: AppColors.textTertiary(context)),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Digite o código impresso na sua tag/adesivo veicular para '
                    'liberar a entrada pelo leitor de antena. Deixe em branco '
                    'para não usar tag.',
                    style: AppTypography.tiny(context),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xl),
            SizedBox(
              height: 50,
              child: ElevatedButton(
                onPressed: _saving ? null : _save,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                  elevation: 0,
                ),
                child: _saving
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : Text(_isEdit ? 'Salvar alterações' : 'Cadastrar veículo',
                        style: AppTypography.button(context)
                            .copyWith(color: Colors.white)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Formata a placa em maiúsculas conforme digita.
class UpperCaseTextFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
      TextEditingValue oldValue, TextEditingValue newValue) {
    return TextEditingValue(
      text: newValue.text.toUpperCase(),
      selection: newValue.selection,
    );
  }
}
