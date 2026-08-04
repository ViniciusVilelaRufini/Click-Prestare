import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/docs/new_contato.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/bottom_sheet_phone.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Agenda de mão de obra do condomínio (eletricista, encanador, chaveiro...).
/// O síndico cadastra; o morador só consulta e liga — mesma relação que já
/// vale para os documentos/atas, por isso a tela vive junto de ListDocs.
class ListContatos extends StatefulWidget {
  const ListContatos({Key? key}) : super(key: key);
  @override
  State<ListContatos> createState() => _ListContatosPageState();
}

class _ListContatosPageState extends State<ListContatos> {
  List<dynamic> list = [];
  bool _isLoading = false;
  String _busca = '';

  @override
  void initState() {
    super.initState();
    loadList();
  }

  Future<void> loadList() async {
    try {
      setState(() => _isLoading = true);
      list = await apiGetAll('contatos');
    } catch (e) {
      if (mounted) {
        displayMessage(
            context, getText('alert_error'), getText('alert_generic_error'));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> delete(int id) async {
    final choice = await showConfirmDialog(context);
    if (choice != true) return;
    setState(() => _isLoading = true);
    final res = await apiDeleteObject('contatos', id);
    if (mounted) setState(() => _isLoading = false);
    if (res) {
      loadList();
    } else {
      if (mounted) {
        displayMessage(
            context, getText('alert_error'), getText('alert_generic_error'));
      }
    }
  }

  List<dynamic> _filtrada() {
    final q = _busca.trim().toLowerCase();
    if (q.isEmpty) return list;
    return list.where((c) {
      final nome = (c['nome'] ?? '').toString().toLowerCase();
      final cat = (c['categoria'] ?? '').toString().toLowerCase();
      return nome.contains(q) || cat.contains(q);
    }).toList();
  }

  /// Agrupa por categoria preservando a ordem que veio do backend
  /// (categoria asc, nome asc).
  Map<String, List<dynamic>> _agrupada(List<dynamic> itens) {
    final mapa = <String, List<dynamic>>{};
    for (final c in itens) {
      final cat = (c['categoria'] ?? 'Outros').toString();
      mapa.putIfAbsent(cat, () => []).add(c);
    }
    return mapa;
  }

  /// WhatsApp/tel não aceitam máscara — manda só os dígitos.
  String _somenteDigitos(String telefone) =>
      telefone.replaceAll(RegExp(r'[^0-9]'), '');

  @override
  Widget build(BuildContext context) {
    final isSindico = getUserType() == 'sindico';
    final itens = _filtrada();
    final grupos = _agrupada(itens);

    return AppScaffold(
      title: getText('contatos_nav'),
      floatingActionButton: isSindico
          ? FloatingActionButton(
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => const NewContato()))
                  .then((_) => loadList()),
              backgroundColor: AppColors.primary,
              child: const Icon(PhosphorIcons.plus, color: Colors.white),
            )
          : null,
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: 6,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : Column(
              children: [
                // Busca
                Padding(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.lg,
                      AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
                  child: TextField(
                    onChanged: (v) => setState(() => _busca = v),
                    style: AppTypography.bodyMedium(context),
                    decoration: InputDecoration(
                      hintText: 'Buscar por nome ou serviço...',
                      hintStyle: AppTypography.caption(context),
                      prefixIcon: Icon(PhosphorIcons.magnifyingGlass,
                          size: 18, color: AppColors.textTertiary(context)),
                      filled: true,
                      fillColor: AppColors.surface(context),
                      contentPadding:
                          const EdgeInsets.symmetric(vertical: 12),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide.none,
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: loadList,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0,
                          AppSpacing.lg, AppSpacing.xxxl),
                      children: [
                        if (itens.isEmpty)
                          Center(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                  vertical: AppSpacing.xl),
                              child: Column(children: [
                                Icon(PhosphorIcons.wrench,
                                    size: 56,
                                    color: AppColors.textTertiary(context)),
                                const SizedBox(height: AppSpacing.md),
                                Text(
                                  _busca.isEmpty
                                      ? (isSindico
                                          ? 'Nenhum contato cadastrado.\nToque em + para adicionar o eletricista, encanador e outros profissionais de confiança.'
                                          : 'Nenhum contato cadastrado pelo síndico ainda.')
                                      : 'Nenhum contato encontrado para esta busca.',
                                  textAlign: TextAlign.center,
                                  style: AppTypography.caption(context),
                                ),
                              ]),
                            ),
                          ),
                        for (final entry in grupos.entries) ...[
                          Padding(
                            padding: const EdgeInsets.only(
                                top: AppSpacing.md, bottom: AppSpacing.sm),
                            child: Text(
                              entry.key.toUpperCase(),
                              style: AppTypography.captionMedium(context)
                                  .copyWith(
                                      color: AppColors.primary,
                                      letterSpacing: 0.8),
                            ),
                          ),
                          for (final c in entry.value)
                            Padding(
                              padding:
                                  const EdgeInsets.only(bottom: AppSpacing.sm),
                              child: _ContatoCard(
                                contato: c,
                                onTap: () => bottomSheetPhone(context,
                                    _somenteDigitos((c['telefone'] ?? '').toString())),
                                onEdit: isSindico
                                    ? () => Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                                builder: (_) => NewContato(
                                                    contato: Map<String,
                                                        dynamic>.from(c))))
                                        .then((_) => loadList())
                                    : null,
                                onDelete: isSindico
                                    ? () => delete(c['id'] as int)
                                    : null,
                              ),
                            ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

class _ContatoCard extends StatelessWidget {
  final dynamic contato;
  final VoidCallback? onTap;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;
  const _ContatoCard(
      {required this.contato, this.onTap, this.onEdit, this.onDelete});

  @override
  Widget build(BuildContext context) {
    final nome = (contato['nome'] ?? '').toString();
    final telefone = (contato['telefone'] ?? '').toString();
    final obs = (contato['observacao'] ?? '').toString();

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              alignment: Alignment.center,
              child: Text(
                nome.isEmpty ? '?' : nome.substring(0, 1).toUpperCase(),
                style: AppTypography.bodyMedium(context)
                    .copyWith(color: AppColors.primary, fontWeight: FontWeight.w700),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(nome,
                      style: AppTypography.bodyMedium(context),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Icon(PhosphorIcons.phone,
                          size: 12, color: AppColors.textTertiary(context)),
                      const SizedBox(width: 4),
                      Text(telefone, style: AppTypography.caption(context)),
                    ],
                  ),
                  if (obs.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(obs,
                        style: AppTypography.caption(context),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis),
                  ],
                ],
              ),
            ),
            if (onEdit != null)
              IconButton(
                icon: Icon(PhosphorIcons.pencilSimple,
                    size: 18, color: AppColors.textTertiary(context)),
                onPressed: onEdit,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 32),
              ),
            if (onDelete != null)
              IconButton(
                icon: Icon(PhosphorIcons.trash, size: 18, color: AppColors.error),
                onPressed: onDelete,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 32),
              ),
            if (onEdit == null && onDelete == null)
              Icon(PhosphorIcons.caretRight,
                  size: 16, color: AppColors.textTertiary(context)),
          ],
        ),
      ),
    );
  }
}
