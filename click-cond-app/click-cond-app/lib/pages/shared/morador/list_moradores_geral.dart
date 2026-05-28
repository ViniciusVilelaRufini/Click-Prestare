import 'package:click/controllers/controller_moradores.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'list_moradores.dart';
import 'new_morador.dart';

class ListMoradoresGeral extends StatefulWidget {
  const ListMoradoresGeral({Key? key}) : super(key: key);

  @override
  _ListMoradoresGeralState createState() => _ListMoradoresGeralState();
}

class _ListMoradoresGeralState extends State<ListMoradoresGeral> {
  List<dynamic> _allMoradores = [];
  bool _isLoading = false;
  String _searchQuery = '';
  String _selectedCategory = 'Todos'; // Todos, Proprietario, Inquilino, Dependente

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _sendCredentialsEmail(dynamic item) async {
    final email = item['email']?.toString() ?? '';
    if (email.isEmpty) {
      displayMessage(context, 'Atenção', 'Este morador não possui e-mail cadastrado.');
      return;
    }
    try {
      await apiSendCredentialsGeral(email, item['nome']?.toString() ?? '', item['documento']?.toString() ?? '');
      displayMessage(context, 'Sucesso', 'Credenciais e link de acesso enviados para $email com sucesso!');
    } catch (e) {
      displayMessage(context, 'Erro', 'Não foi possível enviar as credenciais.');
    }
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    try {
      final res = await apiGetAllMoradoresGeral(Singleton.instance.id_condominio);
      if (mounted) {
        setState(() {
          _allMoradores = res is List ? res : [];
        });
      }
    } catch (_) {
      if (mounted) {
        displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  List<dynamic> get _filteredList {
    return _allMoradores.where((item) {
      final nome = (item['nome'] ?? '').toString().toLowerCase();
      final doc = (item['documento'] ?? '').toString().toLowerCase();
      final apto = (item['apartamento'] ?? '').toString().toLowerCase();
      final matchesSearch = nome.contains(_searchQuery.toLowerCase()) ||
          doc.contains(_searchQuery.toLowerCase()) ||
          apto.contains(_searchQuery.toLowerCase());

      if (_selectedCategory == 'Todos') return matchesSearch;
      final tipo = (item['tipo'] ?? '').toString().toLowerCase();
      final targetTipo = _selectedCategory.toLowerCase().replaceAll('proprietários', 'proprietario').replaceAll('inquilinos', 'inquilino').replaceAll('dependentes', 'dependente');
      return matchesSearch && tipo == targetTipo;
    }).toList();
  }

  Map<String, int> get _stats {
    int prop = 0; int inq = 0; int dep = 0;
    for (var m in _allMoradores) {
      final t = (m['tipo'] ?? '').toString().toLowerCase();
      if (t == 'proprietario') prop++;
      else if (t == 'inquilino') inq++;
      else if (t == 'dependente') dep++;
    }
    return {
      'total': _allMoradores.length,
      'proprietarios': prop,
      'inquilinos': inq,
      'dependentes': dep,
    };
  }

  @override
  Widget build(BuildContext context) {
    final stats = _stats;
    final list = _filteredList;

    return AppScaffold(
      title: 'Moradores',
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          // Direciona para a lista de apartamentos para selecionar e adicionar morador
          Navigator.push(context, MaterialPageRoute(builder: (_) => const ListMoradores()))
              .then((_) => _loadData());
        },
        backgroundColor: AppColors.primary,
        child: const Icon(PhosphorIcons.plus, color: Colors.white),
      ),
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: 8,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : RefreshIndicator(
              color: AppColors.primary,
              onRefresh: _loadData,
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(AppSpacing.xl, AppSpacing.lg, AppSpacing.xl, 0),
                      child: _buildStatsHeader(context, stats),
                    ),
                  ),
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(AppSpacing.xl, AppSpacing.lg, AppSpacing.xl, AppSpacing.sm),
                      child: _buildSearchBar(context),
                    ),
                  ),
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
                      child: _buildCategoryTabs(context),
                    ),
                  ),
                  list.isEmpty
                      ? SliverFillRemaining(
                          hasScrollBody: false,
                          child: Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(PhosphorIcons.usersThree, size: 56, color: AppColors.textTertiary(context)),
                                const SizedBox(height: AppSpacing.md),
                                Text(
                                  _searchQuery.isEmpty && _selectedCategory == 'Todos'
                                      ? 'Nenhum morador cadastrado no condomínio.'
                                      : 'Nenhum morador encontrado para os filtros ativos.',
                                  style: AppTypography.caption(context),
                                  textAlign: TextAlign.center,
                                ),
                              ],
                            ),
                          ),
                        )
                      : SliverPadding(
                          padding: const EdgeInsets.fromLTRB(AppSpacing.xl, AppSpacing.sm, AppSpacing.xl, AppSpacing.xxxl),
                          sliver: SliverList(
                            delegate: SliverChildBuilderDelegate(
                              (_, index) {
                                final item = list[index];
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                                  child: _MoradorGeralCard(
                                    item: item,
                                    onTap: () {
                                      Navigator.push(context, MaterialPageRoute(
                                        builder: (_) => NewMorador(
                                          isEdit: true,
                                          obj: item,
                                          apto: item['apartamento']?.toString() ?? '',
                                          bloco: item['bloco']?.toString() ?? '',
                                          tipo: item['tipo']?.toString() ?? 'Proprietario',
                                          id_apto: item['id_apartamento']?.toString() ?? '',
                                        ),
                                      )).then((_) => _loadData());
                                    },
                                    onSendCredentials: () => _sendCredentialsEmail(item),
                                  ),
                                );
                              },
                              childCount: list.length,
                            ),
                          ),
                        ),
                ],
              ),
            ),
    );
  }

  Widget _buildStatsHeader(BuildContext context, Map<String, int> stats) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(PhosphorIcons.usersFill, color: AppColors.primary, size: 24),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Total de Moradores', style: AppTypography.caption(context)),
                    Text('${stats['total']}', style: AppTypography.title(context)),
                  ],
                ),
              ),
            ],
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
            child: Divider(height: 1, thickness: 1),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildStatItem('Proprietários', stats['proprietarios'] ?? 0, AppColors.primary),
              _buildStatItem('Inquilinos', stats['inquilinos'] ?? 0, Colors.amber),
              _buildStatItem('Dependentes', stats['dependentes'] ?? 0, Colors.grey),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatItem(String label, int count, Color color) {
    return Column(
      children: [
        Text('$count', style: AppTypography.bodyMedium(context).copyWith(color: color, fontWeight: FontWeight.bold)),
        const SizedBox(height: 2),
        Text(label, style: AppTypography.tiny(context).copyWith(fontSize: 10)),
      ],
    );
  }

  Widget _buildSearchBar(BuildContext context) {
    return Container(
      height: 44,
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withOpacity(0.1)),
      ),
      child: TextField(
        onChanged: (val) => setState(() => _searchQuery = val),
        style: AppTypography.bodyMedium(context),
        decoration: InputDecoration(
          hintText: 'Buscar por nome, doc ou apto...',
          hintStyle: AppTypography.caption(context),
          prefixIcon: Icon(PhosphorIcons.magnifyingGlass, size: 18, color: AppColors.textTertiary(context)),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 12),
        ),
      ),
    );
  }

  Widget _buildCategoryTabs(BuildContext context) {
    final categories = ['Todos', 'Proprietários', 'Inquilinos', 'Dependentes'];
    return SizedBox(
      height: 36,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
        scrollDirection: Axis.horizontal,
        itemCount: categories.length,
        separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.xs),
        itemBuilder: (_, index) {
          final cat = categories[index];
          final isSelected = _selectedCategory == cat;
          return GestureDetector(
            onTap: () => setState(() => _selectedCategory = cat),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: isSelected ? AppColors.primary : AppColors.surface(context),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: isSelected ? AppColors.primary : Colors.white.withOpacity(0.08),
                ),
              ),
              child: Text(
                cat,
                style: AppTypography.captionMedium(context).copyWith(
                  color: isSelected ? Colors.white : AppColors.textSecondary(context),
                  fontSize: 12,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _MoradorGeralCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback onTap;
  final VoidCallback? onSendCredentials;

  const _MoradorGeralCard({required this.item, required this.onTap, this.onSendCredentials});

  Color _getTipoColor(String tipo) {
    final t = tipo.toLowerCase();
    if (t == 'proprietario') return AppColors.primary;
    if (t == 'inquilino') return Colors.amber;
    return Colors.grey;
  }

  @override
  Widget build(BuildContext context) {
    final tipo = (item['tipo'] ?? 'Proprietario').toString();
    final tipoColor = _getTipoColor(tipo);
    final photoUrl = (item['foto_pessoa'] ?? item['photo'])?.toString() ?? '';

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withOpacity(0.03)),
        ),
        child: Row(
          children: [
            CircleAvatar(
              radius: 22,
              backgroundColor: tipoColor.withOpacity(0.15),
              backgroundImage: photoUrl.isNotEmpty ? NetworkImage(photoUrl) : null,
              child: photoUrl.isEmpty
                  ? Text(
                      (item['nome'] ?? 'M').toString().trim()[0].toUpperCase(),
                      style: TextStyle(color: tipoColor, fontWeight: FontWeight.bold, fontSize: 14),
                    )
                  : null,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item['nome'] ?? '',
                    style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w600),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Icon(PhosphorIcons.door, size: 12, color: AppColors.textTertiary(context)),
                      const SizedBox(width: 4),
                      Text(
                        'Apto ${item['apartamento'] ?? item['numero'] ?? ''} • Bloco ${item['bloco'] ?? ''}',
                        style: AppTypography.tiny(context),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: tipoColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: tipoColor.withOpacity(0.2)),
                  ),
                  child: Text(
                    tipo,
                    style: AppTypography.tiny(context).copyWith(color: tipoColor, fontWeight: FontWeight.bold, fontSize: 9),
                  ),
                ),
                if (onSendCredentials != null) ...[
                  const SizedBox(height: 6),
                  GestureDetector(
                    onTap: onSendCredentials,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.surface(context),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: AppColors.primary.withOpacity(0.4)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(PhosphorIcons.envelopeSimple, size: 10, color: AppColors.primary),
                          const SizedBox(width: 4),
                          Text('Acesso', style: AppTypography.tiny(context).copyWith(color: AppColors.primary, fontSize: 9, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
