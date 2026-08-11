import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/areas%20sociais/agendamentos_cells.dart';
import 'package:click/pages/shared/areas%20sociais/areas_sociais_cells.dart';
import 'package:click/pages/shared/areas%20sociais/meus_agendamentos_cells.dart';
import 'package:click/pages/shared/areas%20sociais/new_area_social.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListAreasSociais extends StatefulWidget {
  const ListAreasSociais({Key? key}) : super(key: key);
  @override
  _ListAreasSociaisPageState createState() => _ListAreasSociaisPageState();
}

class _ListAreasSociaisPageState extends State<ListAreasSociais> {
  List<dynamic> list = [];
  List<dynamic> listAgendamentos = [];
  List<dynamic> listMeusAgendamentos = [];
  int _currentTab = 0;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    loadAll();
  }

  Future<void> loadAll() async {
    setState(() => _isLoading = true);
    try {
      final List<Future<dynamic>> futures = [
        apiGetAll("areas-sociais"),
        apiGetAll("areas-sociais/meus-agendamentos"),
      ];
      if (getUserType() == 'sindico') {
        futures.add(apiGetAll("areas-sociais/agendamentos"));
      }

      final results = await Future.wait(futures);
      list = results[0];
      listMeusAgendamentos = results[1];
      if (getUserType() == 'sindico') {
        listAgendamentos = results[2];
      }
    } catch (_) {}
    if (mounted) setState(() => _isLoading = false);
  }

  bool get _isSindico => getUserType() == 'sindico';
  bool get _isMorador => getUserType() == 'morador';

  @override
  Widget build(BuildContext context) {
    final tabs = <Tab>[
      Tab(text: getText('lb_areas_sociais')),
      if (_isSindico) Tab(text: getText('area_social_agendamentos')),
      if (_isMorador) Tab(text: getText('area_social_meus_agendamentos')),
    ];

    final views = <Widget>[
      AreasSociaisCells(list: list, reload: loadAll),
      if (_isSindico) AgendamentosCells(list: listAgendamentos, reload: loadAll),
      if (_isMorador) MeusAgendamentosCells(list: listMeusAgendamentos, reload: loadAll),
    ];

    final canAddArea = _currentTab == 0 && (_isSindico || getUserPermission("areas_sociais") == 1);

    return DefaultTabController(
      length: tabs.length,
      child: AppScaffold(
        title: getText('lb_areas_sociais'),
        floatingActionButton: canAddArea
            ? FloatingActionButton(
                onPressed: () => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => NewAreaSocial(isEdit: false)))
                    .then((_) => loadAll()),
                backgroundColor: AppColors.primary,
                child: const Icon(PhosphorIcons.plus, color: Colors.white),
              )
            : null,
        body: Column(
          children: [
            Container(
              margin: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg,
                vertical: AppSpacing.sm,
              ),
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: AppColors.surface(context),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.border(context)),
              ),
              child: TabBar(
                dividerColor: Colors.transparent,
                dividerHeight: 0,
                indicator: BoxDecoration(
                  color: AppColors.primary,
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primary.withOpacity(0.3),
                      blurRadius: 6,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                indicatorSize: TabBarIndicatorSize.tab,
                labelColor: Colors.white,
                unselectedLabelColor: AppColors.textSecondary(context),
                labelStyle: const TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
                unselectedLabelStyle: const TextStyle(
                  fontWeight: FontWeight.w500,
                  fontSize: 13,
                ),
                onTap: (i) => setState(() => _currentTab = i),
                tabs: tabs,
              ),
            ),
            Expanded(
              child: _isLoading
                  ? ListView.separated(
                      padding: EdgeInsets.all(AppSpacing.lg),
                      itemCount: 6,
                      separatorBuilder: (_, __) => SizedBox(height: AppSpacing.sm),
                      itemBuilder: (_, __) => AppSkeleton.listTile(context),
                    )
                  : TabBarView(children: views),
            ),
          ],
        ),
      ),
    );
  }
}
