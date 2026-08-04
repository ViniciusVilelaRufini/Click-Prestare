import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Cadastro/edição de um contato útil (mão de obra do condomínio).
/// Só o síndico chega aqui — a lista esconde o botão para o morador, e o
/// backend revalida com assertStaff.
class NewContato extends StatefulWidget {
  const NewContato({Key? key, this.contato}) : super(key: key);

  /// Quando vem preenchido, a tela entra em modo edição.
  final Map<String, dynamic>? contato;

  @override
  State<NewContato> createState() => _NewContatoPageState();
}

class _NewContatoPageState extends State<NewContato> {
  var _isSaving = false;
  final txtNome = TextEditingController();
  final txtCategoria = TextEditingController();
  final txtTelefone = TextEditingController();
  final txtObservacao = TextEditingController();

  /// Atalhos das especialidades mais pedidas. Só preenchem o campo — a
  /// categoria continua texto livre, porque cada condomínio tem as suas.
  static const _sugestoes = [
    'Eletricista',
    'Encanador',
    'Chaveiro',
    'Pintor',
    'Pedreiro',
    'Marceneiro',
    'Serralheiro',
    'Ar-condicionado',
    'Dedetização',
    'Jardinagem',
    'Piscina',
    'Elevador',
    'Portão / Interfone',
    'Gás',
  ];

  bool get _isEdit => widget.contato != null;

  @override
  void initState() {
    super.initState();
    final c = widget.contato;
    if (c != null) {
      txtNome.text = (c['nome'] ?? '').toString();
      txtCategoria.text = (c['categoria'] ?? '').toString();
      txtTelefone.text = (c['telefone'] ?? '').toString();
      txtObservacao.text = (c['observacao'] ?? '').toString();
    }
  }

  @override
  void dispose() {
    txtNome.dispose();
    txtCategoria.dispose();
    txtTelefone.dispose();
    txtObservacao.dispose();
    super.dispose();
  }

  Future<void> save() async {
    if (txtNome.text.trim().isEmpty ||
        txtCategoria.text.trim().isEmpty ||
        txtTelefone.text.trim().isEmpty) {
      displayMessage(context, getText('alert_error'),
          'Preencha nome, categoria e telefone.');
      return;
    }
    try {
      setState(() => _isSaving = true);
      final contato = {
        if (_isEdit) 'id': widget.contato!['id'],
        'nome': txtNome.text.trim(),
        'categoria': txtCategoria.text.trim(),
        'telefone': txtTelefone.text.trim(),
        'observacao': txtObservacao.text.trim(),
      };
      final message =
          await apiSaveObject('contatos', 'contato', contato, _isEdit);
      if (message == '') {
        if (mounted) Navigator.pop(context);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), message);
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), e.toString());
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: _isEdit ? 'Editar Contato' : getText('contatos_nav_new'),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _section('Serviço'),
            AppInput(
              label: 'Categoria (ex.: Eletricista)',
              controller: txtCategoria,
              prefixIcon: PhosphorIcons.wrench,
              textCapitalization: TextCapitalization.sentences,
            ),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _sugestoes.map((s) {
                final selecionada =
                    txtCategoria.text.trim().toLowerCase() == s.toLowerCase();
                return GestureDetector(
                  onTap: () => setState(() => txtCategoria.text = s),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 7),
                    decoration: BoxDecoration(
                      color: selecionada
                          ? AppColors.primary
                          : AppColors.surface(context),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: selecionada
                            ? AppColors.primary
                            : AppColors.textTertiary(context).withOpacity(0.15),
                      ),
                    ),
                    child: Text(
                      s,
                      style: AppTypography.captionMedium(context).copyWith(
                        color: selecionada
                            ? Colors.white
                            : AppColors.textSecondary(context),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: AppSpacing.xl),
            _section('Contato'),
            AppInput(
              label: 'Nome ou empresa',
              controller: txtNome,
              prefixIcon: PhosphorIcons.user,
              textCapitalization: TextCapitalization.words,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('telefone'),
              controller: txtTelefone,
              prefixIcon: PhosphorIcons.phone,
              keyboard: TextInputType.phone,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: 'Observação (opcional)',
              controller: txtObservacao,
              prefixIcon: PhosphorIcons.note,
              textCapitalization: TextCapitalization.sentences,
              maxLines: 3,
            ),
            const SizedBox(height: AppSpacing.xl),
            AppButton(
              label: getText('btn_save'),
              onPressed: _isSaving ? null : save,
              loading: _isSaving,
              icon: PhosphorIcons.floppyDisk,
            ),
            const SizedBox(height: AppSpacing.xxxl),
          ],
        ),
      ),
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Text(title.toUpperCase(),
            style: AppTypography.captionMedium(context)
                .copyWith(color: AppColors.primary, letterSpacing: 0.8)),
      );
}
