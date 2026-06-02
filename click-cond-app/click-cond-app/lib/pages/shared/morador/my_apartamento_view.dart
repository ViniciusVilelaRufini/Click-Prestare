import 'package:click/controllers/controller_moradores.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'new_morador.dart';

/// Tela "Meu Apartamento" do morador: mostra o apartamento em que está cadastrado,
/// seu vínculo (proprietário/inquilino/membro) e os moradores do apto. O proprietário
/// pode cadastrar novos familiares (tipo "Membro").
class MyApartamentoView extends StatefulWidget {
  const MyApartamentoView({Key? key}) : super(key: key);

  @override
  _MyApartamentoViewState createState() => _MyApartamentoViewState();
}

class _MyApartamentoViewState extends State<MyApartamentoView> {
  bool _isLoading = false;
  List<dynamic> listProprietarios = [];
  List<dynamic> listInquilinos = [];
  List<dynamic> listMembros = [];

  String get _idApto => Singleton.instance.getIdApartamento();
  String get _apto => (Singleton.instance.apartamento ?? '').toString();
  String get _bloco => (Singleton.instance.bloco ?? '').toString();

  /// O usuário logado é o "dono" do apto (pode cadastrar familiares)?
  /// Fonte autoritativa: o vínculo (apto_tipo) carregado no login/seleção do condomínio.
  bool get _isProprietario => Singleton.instance.isProprietarioApto();

  /// O usuário logado é explicitamente inquilino?
  bool get _isInquilino =>
      (Singleton.instance.apto_tipo ?? '').toString().toLowerCase().trim() == 'inquilino';

  @override
  void initState() {
    super.initState();
    loadMoradores();
  }

  Future<void> loadMoradores() async {
    if (_idApto.isEmpty) return;
    try {
      setState(() => _isLoading = true);
      final resProps = await apiGetAllMoradores('Proprietário', _idApto);
      final resInqui = await apiGetAllMoradores('Inquilino', _idApto);
      final resMembros = await apiGetAllMoradores('Membro', _idApto);
      listProprietarios = resProps is List ? resProps : [];
      listInquilinos = resInqui is List ? resInqui : [];
      listMembros = resMembros is List ? resMembros : [];
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _addMembro() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => NewMorador(
          isEdit: false,
          apto: _apto,
          bloco: _bloco,
          tipo: 'Membro',
          id_apto: _idApto,
        ),
      ),
    ).then((_) => loadMoradores());
  }

  String get _badgeText {
    if (_isProprietario) return getText('apto_voce_proprietario');
    if (_isInquilino) return getText('apto_voce_inquilino');
    return getText('apto_voce_membro');
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('lb_meu_apartamento'),
      showBackButton: true,
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: loadMoradores,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildHeaderCard(context),
                    const SizedBox(height: AppSpacing.xl),
                    _MoradorSection(
                      title: getText('apto_proprietarios'),
                      roleName: 'Proprietário',
                      list: listProprietarios,
                      canAdd: false,
                      onAdd: () {},
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    _MoradorSection(
                      title: getText('apto_inquilinos'),
                      roleName: 'Inquilino',
                      list: listInquilinos,
                      canAdd: false,
                      onAdd: () {},
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    _MoradorSection(
                      title: getText('apto_membros'),
                      roleName: getText('lb_membro'),
                      list: listMembros,
                      // Só o proprietário pode cadastrar familiares.
                      canAdd: _isProprietario,
                      onAdd: _addMembro,
                    ),
                    if (!_isProprietario) ...[
                      const SizedBox(height: AppSpacing.lg),
                      Row(
                        children: [
                          Icon(PhosphorIcons.info, size: 14, color: AppColors.textTertiary(context)),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              getText('apto_so_proprietario_add'),
                              style: AppTypography.caption(context)
                                  .copyWith(color: AppColors.textTertiary(context)),
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: AppSpacing.xxxl),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildHeaderCard(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isDark
              ? [AppColors.primary, AppColors.primary.withOpacity(0.7)]
              : [AppColors.primary, AppColors.primary.withOpacity(0.85)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withOpacity(0.25),
            blurRadius: 16,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              shape: BoxShape.circle,
            ),
            child: const Icon(PhosphorIcons.door, color: Colors.white, size: 28),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${getText('lb_apartamento')} $_apto',
                  style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 2),
                Text(
                  '${getText('lb_bloco')} $_bloco',
                  style: TextStyle(color: Colors.white.withOpacity(0.9), fontSize: 15, fontWeight: FontWeight.w500),
                ),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        _isProprietario ? PhosphorIcons.crown : PhosphorIcons.user,
                        size: 12,
                        color: Colors.white,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        _badgeText,
                        style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Seção de lista de moradores de um determinado papel (proprietário/inquilino/membro).
class _MoradorSection extends StatelessWidget {
  final String title;
  final String roleName;
  final List<dynamic> list;
  final bool canAdd;
  final VoidCallback onAdd;

  const _MoradorSection({
    Key? key,
    required this.title,
    required this.roleName,
    required this.list,
    required this.canAdd,
    required this.onAdd,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              title.toUpperCase(),
              style: AppTypography.captionMedium(context).copyWith(
                color: AppColors.primary,
                fontWeight: FontWeight.bold,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                list.length.toString(),
                style: AppTypography.tiny(context).copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const Spacer(),
            if (canAdd && list.isNotEmpty)
              Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: onAdd,
                  borderRadius: BorderRadius.circular(20),
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withOpacity(0.08),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(PhosphorIcons.plus, color: AppColors.primary, size: 16),
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
              color: isDark ? Colors.white.withOpacity(0.01) : Colors.black.withOpacity(0.005),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: isDark ? Colors.white.withOpacity(0.04) : Colors.black.withOpacity(0.03),
              ),
            ),
            child: Column(
              children: [
                Icon(
                  PhosphorIcons.users,
                  size: 28,
                  color: (isDark ? Colors.white : Colors.black).withOpacity(0.25),
                ),
                const SizedBox(height: 10),
                Text(
                  'Nenhum $roleName cadastrado',
                  style: AppTypography.bodySecondary(context).copyWith(
                    fontWeight: FontWeight.w500,
                    fontSize: 13,
                  ),
                ),
                if (canAdd) ...[
                  const SizedBox(height: 10),
                  TextButton.icon(
                    onPressed: onAdd,
                    icon: const Icon(PhosphorIcons.plus, size: 14),
                    label: Text(getText('apto_add_membro')),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.primary,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      backgroundColor: AppColors.primary.withOpacity(0.08),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
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
                color: isDark ? Colors.white.withOpacity(0.03) : Colors.black.withOpacity(0.015),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: isDark ? Colors.white.withOpacity(0.05) : Colors.black.withOpacity(0.03),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.primary.withOpacity(0.1),
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
                              color: isDark ? Colors.white : Colors.black87,
                            ),
                          ),
                          if (telefone.isNotEmpty) ...[
                            const SizedBox(height: 2),
                            Text(
                              telefone,
                              style: AppTypography.caption(context).copyWith(
                                color: isDark ? Colors.white60 : Colors.black54,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          }).toList(),
      ],
    );
  }
}
