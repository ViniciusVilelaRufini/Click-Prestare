import 'package:click/controllers/controller_generic.dart';
import 'package:click/controllers/controller_moradores.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'new_morador.dart';

class NewApto extends StatefulWidget {
  const NewApto({super.key, required this.isEdit, this.obj});
  final bool isEdit;
  final dynamic obj;

  @override
  _NewAptoPageState createState() => _NewAptoPageState();
}

class _NewAptoPageState extends State<NewApto> {
  var isEdit = false;
  var _isLoading = false;
  var _isSaving = false;
  var idObj = -1;
  final txtBloco = TextEditingController();
  final txtApto = TextEditingController();
  final txtFracao = TextEditingController();
  final txtVagas = TextEditingController();
  List<dynamic> listProprietarios = [];
  List<dynamic> listInquilinos = [];
  List<dynamic> listMembros = [];

  @override
  void dispose() {
    txtBloco.dispose(); txtApto.dispose(); txtFracao.dispose(); txtVagas.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.isEdit) {
      isEdit = widget.isEdit;
      idObj = widget.obj['id'];
      load();
    }
  }

  Future<void> load() async {
    txtApto.text = widget.obj['apto'];
    txtBloco.text = widget.obj['bloco'];
    txtFracao.text = widget.obj['fracao'] ?? '';
    txtVagas.text = (widget.obj['qtd_vagas'] ?? '').toString() == 'null'
        ? ''
        : (widget.obj['qtd_vagas']?.toString() ?? '');
    await loadMoradores();
  }

  Future<void> loadMoradores() async {
    try {
      setState(() => _isLoading = true);
      var resProps = await apiGetAllMoradores('Proprietário', idObj.toString());
      var resInqui = await apiGetAllMoradores('Inquilino', idObj.toString());
      var resMembros = await apiGetAllMoradores('Membro', idObj.toString());
      listProprietarios = resProps;
      listInquilinos = resInqui;
      listMembros = resMembros is List ? resMembros : [];
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> save() async {
    try {
      setState(() => _isSaving = true);
      var obj = AptoModel(id: idObj, bloco: txtBloco.text, apto: txtApto.text, fracao: txtFracao.text, qtdVagas: int.tryParse(txtVagas.text.trim()) ?? 0);
      var res = await apiSaveApto('apartamentos', getText('lb_apartamento'), obj, isEdit);
      if (!mounted) return;
      await displayMessage(context, getText('alert_success'), 'Apartamento salvo com sucesso!');
      idObj = res['id'];
      isEdit = true;
      await loadMoradores();
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), e.toString());
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> delete() async {
    // Apagar a unidade é a operação mais destrutiva do sistema: no banco,
    // todas as chaves estrangeiras para Apartamentos são ON DELETE CASCADE,
    // então somem junto os vínculos dos moradores, o histórico de visitantes,
    // as vagas, as reservas de área e as mudanças. Um "tem certeza?" genérico
    // não deixa isso claro para quem clica.
    var choice = await showConfirmDialog(
      context,
      text: 'Excluir o apartamento ${txtBloco.text.isNotEmpty ? '${txtBloco.text} ' : ''}'
          '${txtApto.text}?\n\n'
          'Isso remove também os moradores vinculados, o histórico de visitantes, '
          'as vagas, as reservas de áreas e as mudanças desta unidade. '
          'Não é possível desfazer.',
    );
    if (choice != null && choice) {
      setState(() => _isSaving = true);
      var res = await apiDeleteObject('apartamentos', idObj);
      if (mounted) setState(() => _isSaving = false);
      if (res) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
    }
  }

  bool get canEdit => getUserType() == 'sindico' || getUserPermission('apartamentos') == 1;

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('lb_apartamento'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (!isEdit) ...[
                    Container(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: AppColors.primaryLight,
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        border: Border.all(
                          color: AppColors.primaryLight,
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(PhosphorIcons.info, color: AppColors.primary, size: 20),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Text(
                              getText('apto_desc'),
                              style: AppTypography.body(context).copyWith(
                                color: AppColors.primary,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                  ] else ...[
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppColors.surface(context),
                        border: Border.all(color: AppColors.borderStrong(context)),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 52,
                            height: 52,
                            decoration: BoxDecoration(
                              color: AppColors.accentGhost(context),
                              border: Border.all(color: AppColors.border(context)),
                            ),
                            child: Icon(
                              PhosphorIcons.door,
                              color: AppColors.textPrimary(context),
                              size: 24,
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Apartamento ${txtApto.text}'.toUpperCase(),
                                  style: AppTypography.title(context),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Bloco ${txtBloco.text}',
                                  style: AppTypography.bodySecondary(context),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                  ],
                  
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.surface(context),
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      border: Border.all(
                        color: AppColors.border(context),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                              PhosphorIcons.info,
                              size: 16,
                              color: AppColors.primary,
                            ),
                            const SizedBox(width: 8),
                            Text(
                              getText('lb_infos_apto').toUpperCase(),
                              style: AppTypography.label(context),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: AppInput(
                                label: getText('lb_bloco'),
                                controller: txtBloco,
                                prefixIcon: PhosphorIcons.buildings,
                                readOnly: !canEdit,
                              ),
                            ),
                            const SizedBox(width: AppSpacing.md),
                            Expanded(
                              child: AppInput(
                                label: getText('lb_apartamento'),
                                controller: txtApto,
                                prefixIcon: PhosphorIcons.door,
                                readOnly: !canEdit,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        AppInput(
                          label: 'Quantidade de vagas',
                          controller: txtVagas,
                          prefixIcon: PhosphorIcons.carSimple,
                          keyboard: TextInputType.number,
                          readOnly: !canEdit,
                        ),
                      ],
                    ),
                  ),
                  
                  if (isEdit) ...[
                    const SizedBox(height: AppSpacing.xl),
                    _MoradorSection(
                      title: getText('apto_proprietarios'),
                      roleName: 'Proprietário',
                      canEdit: canEdit,
                      list: listProprietarios,
                      onAdd: () => Navigator.push(
                        context,
                        MaterialPageRoute(builder: (_) => NewMorador(
                          isEdit: false, apto: txtApto.text, bloco: txtBloco.text,
                          tipo: 'Proprietário', id_apto: idObj.toString(),
                        )),
                      ).then((_) => loadMoradores()),
                      onTap: (item) {
                        if (canEdit) {
                          Navigator.push(
                            context,
                            MaterialPageRoute(builder: (_) => NewMorador(
                              obj: item, isEdit: true, apto: txtApto.text, bloco: txtBloco.text,
                              tipo: 'Proprietário', id_apto: idObj.toString(),
                            )),
                          ).then((_) => loadMoradores());
                        }
                      },
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    _MoradorSection(
                      title: getText('apto_inquilinos'),
                      roleName: 'Inquilino',
                      canEdit: canEdit,
                      list: listInquilinos,
                      onAdd: () => Navigator.push(
                        context,
                        MaterialPageRoute(builder: (_) => NewMorador(
                          isEdit: false, apto: txtApto.text, bloco: txtBloco.text,
                          tipo: 'Inquilino', id_apto: idObj.toString(),
                        )),
                      ).then((_) => loadMoradores()),
                      onTap: (item) {
                        if (canEdit) {
                          Navigator.push(
                            context,
                            MaterialPageRoute(builder: (_) => NewMorador(
                              obj: item, isEdit: true, apto: txtApto.text, bloco: txtBloco.text,
                              tipo: 'Inquilino', id_apto: idObj.toString(),
                            )),
                          ).then((_) => loadMoradores());
                        }
                      },
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    _MoradorSection(
                      title: getText('apto_membros'),
                      roleName: getText('lb_membro'),
                      canEdit: canEdit,
                      list: listMembros,
                      onAdd: () => Navigator.push(
                        context,
                        MaterialPageRoute(builder: (_) => NewMorador(
                          isEdit: false, apto: txtApto.text, bloco: txtBloco.text,
                          tipo: 'Membro', id_apto: idObj.toString(),
                        )),
                      ).then((_) => loadMoradores()),
                      onTap: (item) {
                        if (canEdit) {
                          Navigator.push(
                            context,
                            MaterialPageRoute(builder: (_) => NewMorador(
                              obj: item, isEdit: true, apto: txtApto.text, bloco: txtBloco.text,
                              tipo: 'Membro', id_apto: idObj.toString(),
                            )),
                          ).then((_) => loadMoradores());
                        }
                      },
                    ),
                  ],
                  if (canEdit) ...[
                    const SizedBox(height: AppSpacing.xl),
                    AppButton(
                      label: getText('btn_save'),
                      onPressed: _isSaving ? null : save,
                      loading: _isSaving,
                      icon: PhosphorIcons.floppyDisk,
                    ),
                    if (widget.isEdit) ...[
                      const SizedBox(height: AppSpacing.md),
                      AppButton(
                        label: getText('btn_delete'),
                        onPressed: _isSaving ? null : delete,
                        variant: AppButtonVariant.danger,
                        icon: PhosphorIcons.trash,
                      ),
                    ],
                  ],
                  const SizedBox(height: AppSpacing.xxxl),
                ],
              ),
            ),
    );
  }
}

class _MoradorSection extends StatelessWidget {
  final String title;
  final String roleName;
  final bool canEdit;
  final List<dynamic> list;
  final VoidCallback onAdd;
  final void Function(dynamic item) onTap;

  const _MoradorSection({
    super.key,
    required this.title,
    required this.roleName,
    required this.canEdit,
    required this.list,
    required this.onAdd,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              title.toUpperCase(),
              style: AppTypography.label(context),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.borderStrong(context)),
                borderRadius: BorderRadius.circular(AppRadius.tag),
              ),
              child: Text(
                list.length.toString(),
                style: AppTypography.label(context).copyWith(
                  color: AppColors.textSecondary(context),
                ),
              ),
            ),
            const Spacer(),
            if (canEdit && list.isNotEmpty)
              Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: onAdd,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      border: Border.all(color: AppColors.borderStrong(context)),
                    ),
                    child: Icon(
                      PhosphorIcons.plus,
                      color: AppColors.textPrimary(context),
                      size: 16,
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        if (list.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
            decoration: BoxDecoration(
              color: AppColors.surface(context),
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(
                color: AppColors.border(context),
              ),
            ),
            child: Column(
              children: [
                Icon(
                  PhosphorIcons.users,
                  size: 28,
                  color: AppColors.textTertiary(context),
                ),
                const SizedBox(height: 10),
                Text(
                  'Nenhum $roleName cadastrado',
                  style: AppTypography.bodySecondary(context).copyWith(
                    fontWeight: FontWeight.w500,
                    fontSize: 13,
                  ),
                ),
                if (canEdit) ...[
                  const SizedBox(height: 10),
                  TextButton.icon(
                    onPressed: onAdd,
                    icon: const Icon(PhosphorIcons.plus, size: 14),
                    label: Text('Adicionar $roleName'),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.primary,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      backgroundColor: AppColors.primaryLight,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppRadius.md),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          )
        else
          ...list.map((item) {
            final String? photoUrl = (item['foto_pessoa'] ?? item['photo'])?.toString();
            final String name = item['nome'] ?? 'Sem Nome';
            final String telefone = item['celular'] ?? item['telefone'] ?? '';

            return Container(
              margin: const EdgeInsets.only(bottom: AppSpacing.sm),
              decoration: BoxDecoration(
                color: AppColors.surface(context),
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(
                  color: AppColors.border(context),
                ),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.md),
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: () => onTap(item),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Row(
                        children: [
                          Container(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: AppColors.surfaceElevated(context),
                              image: (photoUrl != null && photoUrl.isNotEmpty)
                                  ? DecorationImage(image: NetworkImage(photoUrl), fit: BoxFit.cover)
                                  : null,
                            ),
                            child: (photoUrl == null || photoUrl.isEmpty)
                                ? Center(
                                    child: Text(
                                      name.isNotEmpty ? name[0].toUpperCase() : '?',
                                      style: TextStyle(
                                        color: AppColors.primary,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 18,
                                      ),
                                    ),
                                  )
                                : null,
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  name,
                                  style: AppTypography.body(context).copyWith(
                                    fontWeight: FontWeight.bold,
                                    color: AppColors.textPrimary(context),
                                  ),
                                ),
                                if (telefone.isNotEmpty) ...[
                                  const SizedBox(height: 2),
                                  Text(
                                    telefone,
                                    style: AppTypography.caption(context).copyWith(
                                      color: AppColors.textSecondary(context),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          if (canEdit)
                            Icon(
                              PhosphorIcons.caretRight,
                              color: AppColors.textTertiary(context),
                              size: 18,
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            );
          }),
      ],
    );
  }
}

class AptoModel {
  int? id;
  String? bloco;
  String? apto;
  String? fracao;
  int? qtdVagas;

  AptoModel({this.id, this.bloco, this.apto, this.fracao, this.qtdVagas});

  Map toJson() => {'id': id, 'bloco': bloco, 'apto': apto, 'fracao': fracao, 'qtd_vagas': qtdVagas ?? 0};
}
