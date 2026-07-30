import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/pages/shared/financeiro/new_financeiro_morador.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListFinanceiroMoradores extends StatefulWidget {
  const ListFinanceiroMoradores({Key? key}) : super(key: key);

  @override
  _ListFinanceiroMoradoresPageState createState() => _ListFinanceiroMoradoresPageState();
}

class _ListFinanceiroMoradoresPageState extends State<ListFinanceiroMoradores> {
  List<dynamic> blocos = [];
  List<dynamic> titlesTabs = [];
  final ScrollController _tabScroll = ScrollController();
  final TextEditingController _searchController = TextEditingController();

  var _isLoading = false;
  var tabSelected = '';
  var mes = '';
  var ano = '';
  String _searchText = '';
  String _statusFilter = 'Todos';

  @override
  void initState() {
    super.initState();
    loadList();
  }

  @override
  void dispose() {
    _tabScroll.dispose();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> loadList() async {
    try {
      setState(() => _isLoading = true);
      var locals = await apiGetAllFinanceiro("financeiro/moradores", mes, "20$ano");
      blocos = locals['blocos'];
      titlesTabs = locals['meses'];
      if (tabSelected == '' && titlesTabs.isNotEmpty) {
        var now = DateTime.now();
        var mesesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        var currentPeriod = "${mesesNomes[now.month - 1]}/${now.year}";
        
        dynamic selectedTab;
        for (var t in titlesTabs) {
          if (t['periodo'].toString().toLowerCase() == currentPeriod.toLowerCase()) {
            selectedTab = t;
            break;
          }
        }
        
        selectedTab ??= titlesTabs[titlesTabs.length - 1];
        tabSelected = selectedTab['periodo'];
        _changeMonth(selectedTab['periodo'], selectedTab['mes'], selectedTab['ano']);
        return;
      }
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _changeMonth(String month, String newMes, String newAno) {
    tabSelected = month;
    mes = newMes;
    ano = newAno.substring(newAno.length - 2);
    loadList();
  }

  int _getCountStatus(dynamic bloco, int pago) {
    var count = 0;
    for (var apto in bloco['aptos']) {
      final isPaid = apto['pago'] == 1;
      if (pago == 1) {
        count += isPaid ? 1 : 0;
      } else {
        count += !isPaid ? 1 : 0;
      }
    }
    return count;
  }

  Widget _buildSearchField() {
    return Padding(
      padding: const EdgeInsets.only(
        left: AppSpacing.lg,
        right: AppSpacing.lg,
        top: AppSpacing.md,
        bottom: AppSpacing.xs,
      ),
      child: TextField(
        controller: _searchController,
        onChanged: (val) => setState(() => _searchText = val),
        style: AppTypography.body(context),
        decoration: InputDecoration(
          hintText: 'Pesquisar apartamento ou bloco...',
          hintStyle: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context)),
          prefixIcon: Icon(PhosphorIcons.magnifyingGlass, color: AppColors.textSecondary(context)),
          suffixIcon: _searchText.isNotEmpty
              ? IconButton(
                  icon: Icon(PhosphorIcons.xCircle, color: AppColors.textSecondary(context)),
                  onPressed: () {
                    _searchController.clear();
                    setState(() => _searchText = '');
                  },
                )
              : null,
          filled: true,
          fillColor: AppColors.surface(context),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: AppColors.border(context)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: AppColors.border(context)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: AppColors.primary, width: 1.5),
          ),
          contentPadding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
        ),
      ),
    );
  }

  Widget _buildFilterChips() {
    final statuses = ['Todos', 'Pagos', 'Pendentes'];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
      child: Row(
        children: statuses.map((status) {
          final isSelected = _statusFilter == status;
          Color activeColor;
          IconData icon;
          if (status == 'Pagos') {
            activeColor = Colors.green;
            icon = PhosphorIcons.checkCircle;
          } else if (status == 'Pendentes') {
            activeColor = Colors.orange;
            icon = PhosphorIcons.warningCircle;
          } else {
            activeColor = AppColors.primary;
            icon = PhosphorIcons.list;
          }

          return Padding(
            padding: const EdgeInsets.only(right: AppSpacing.sm),
            child: InkWell(
              onTap: () => setState(() => _statusFilter = status),
              borderRadius: BorderRadius.circular(20),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 6),
                decoration: BoxDecoration(
                  color: isSelected ? activeColor.withOpacity(0.15) : AppColors.surface(context),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: isSelected ? activeColor : AppColors.border(context),
                    width: 1.5,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      icon,
                      size: 14,
                      color: isSelected ? activeColor : AppColors.textSecondary(context),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      status,
                      style: AppTypography.caption(context).copyWith(
                        color: isSelected ? activeColor : AppColors.textSecondary(context),
                        fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Filter blocks and apartments
    List<dynamic> filteredBlocos = [];
    for (var b in blocos) {
      final blocoName = b['bloco'].toString().toLowerCase();
      final aptos = b['aptos'] as List<dynamic>;
      
      List<dynamic> filteredAptos = [];
      for (var a in aptos) {
        final aptoNum = a['apto'].toString().toLowerCase();
        final isPaid = a['pago'] == 1;
        
        if (_statusFilter == 'Pagos' && !isPaid) continue;
        if (_statusFilter == 'Pendentes' && isPaid) continue;
        
        if (_searchText.isNotEmpty) {
          final matchesApto = aptoNum.contains(_searchText.toLowerCase());
          final matchesBloco = blocoName.contains(_searchText.toLowerCase());
          if (!matchesApto && !matchesBloco) continue;
        }
        
        filteredAptos.add(a);
      }
      
      if (filteredAptos.isNotEmpty) {
        filteredBlocos.add({
          'bloco': b['bloco'],
          'total': b['total'],
          'aptos': filteredAptos,
        });
      }
    }

    return AppScaffold(
      title: getText('financeiro_nav_arrecadacoes'),
      body: Column(
        children: [
          if (titlesTabs.isNotEmpty) _buildTabBar(),
          _buildSearchField(),
          _buildFilterChips(),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : blocos.isEmpty
                    ? Center(
                        child: Text(
                          getText('alert_nenhum_apto'),
                          style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context)),
                          textAlign: TextAlign.center,
                        ),
                      )
                    : filteredBlocos.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  PhosphorIcons.magnifyingGlass,
                                  size: 48,
                                  color: AppColors.textSecondary(context),
                                ),
                                const SizedBox(height: AppSpacing.md),
                                Text(
                                  "Nenhum apartamento encontrado",
                                  style: AppTypography.body(context).copyWith(
                                    color: AppColors.textSecondary(context),
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.all(AppSpacing.lg),
                            itemCount: filteredBlocos.length,
                            separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                            itemBuilder: (context, i) => _BlocoTile(
                              bloco: filteredBlocos[i],
                              paid: _getCountStatus(filteredBlocos[i], 1),
                              pending: _getCountStatus(filteredBlocos[i], 0),
                              onApto: (apto) {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(builder: (_) => NewFinanceiroMorador(apto: apto)),
                                ).then((_) => loadList());
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildTabBar() {
    return Container(
      height: 44,
      color: AppColors.surface(context),
      child: ListView.separated(
        controller: _tabScroll,
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        itemCount: titlesTabs.length,
        separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.md),
        itemBuilder: (context, i) {
          final tab = titlesTabs[i];
          final isSelected = tabSelected == tab['periodo'];
          return GestureDetector(
            onTap: isSelected ? null : () => _changeMonth(tab['periodo'], tab['mes'], tab['ano']),
            child: Center(
              child: Text(
                tab['periodo'],
                style: AppTypography.bodyMedium(context).copyWith(
                  color: isSelected ? AppColors.primary : AppColors.textSecondary(context),
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w400,
                  decoration: isSelected ? TextDecoration.underline : null,
                  decorationColor: AppColors.primary,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _BlocoTile extends StatelessWidget {
  final dynamic bloco;
  final int paid;
  final int pending;
  final void Function(dynamic apto) onApto;

  const _BlocoTile({required this.bloco, required this.paid, required this.pending, required this.onApto});

  @override
  Widget build(BuildContext context) {
    final aptos = bloco['aptos'] as List<dynamic>;
    final total = bloco['total'].toString().replaceAll('R\$', Singleton.instance.getCurrentMoeda());

    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border(context)),
        ),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.xs),
          childrenPadding: EdgeInsets.zero,
          title: Row(
            children: [
              Expanded(
                child: Text(
                  '${getText('lb_bloco')} ${bloco['bloco']}',
                  style: AppTypography.bodyMedium(context),
                ),
              ),
              _StatusBadge(icon: PhosphorIcons.checkCircle, color: Colors.green, count: paid),
              const SizedBox(width: AppSpacing.sm),
              _StatusBadge(icon: PhosphorIcons.warningCircle, color: Colors.orange, count: pending),
              const SizedBox(width: AppSpacing.md),
              Text(total, style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context))),
            ],
          ),
          children: [
            const Divider(height: 1),
            for (var apto in aptos)
              _AptoRow(apto: apto, onTap: () => onApto(apto)),
          ],
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final IconData icon;
  final Color color;
  final int count;
  const _StatusBadge({required this.icon, required this.color, required this.count});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: color, size: 16),
        const SizedBox(width: 2),
        Text(count.toString(), style: AppTypography.caption(context)),
      ],
    );
  }
}

class _AptoRow extends StatelessWidget {
  final dynamic apto;
  final VoidCallback onTap;
  const _AptoRow({required this.apto, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final isPaid = apto['pago'] == 1;
    final valor = apto['valorReal'].toString().replaceAll('R\$', Singleton.instance.getCurrentMoeda());
    final qtdCobrancas = int.tryParse('${apto['qtd_cobrancas'] ?? 1}') ?? 1;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
        child: Row(
          children: [
            Container(
              width: 4, height: 36,
              decoration: BoxDecoration(
                color: isPaid ? Colors.green : Colors.orange,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Icon(
              isPaid ? PhosphorIcons.checkCircle : PhosphorIcons.warningCircle,
              color: isPaid ? Colors.green : Colors.orange,
              size: 18,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Row(
                children: [
                  Flexible(
                    child: Text(
                      '${getText('lb_apartamento')} ${apto['apto']}',
                      style: AppTypography.bodyMedium(context),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  // A linha mostra UMA cobrança por unidade. Quando o mês tem
                  // mais de uma (taxa + rateio, taxa + parcela de acordo), o
                  // valor ao lado é só o desta — sem o selo, o síndico lia
                  // como se fosse tudo que a unidade deve no mês.
                  if (qtdCobrancas > 1) ...[
                    const SizedBox(width: AppSpacing.xs),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        '+${qtdCobrancas - 1}',
                        style: AppTypography.tiny(context)
                            .copyWith(color: AppColors.primary, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Text(valor, style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context))),
            const SizedBox(width: AppSpacing.sm),
            Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textSecondary(context)),
          ],
        ),
      ),
    );
  }
}
