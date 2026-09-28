import 'package:click/pages/shared/ocorrencias/list_categorias_ocorrencia.dart';
import 'package:click/pages/shared/ocorrencias/list_ocorrencias_todos.dart';
import 'package:click/pages/shared/ocorrencias/new_ocorrencia.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:flutter/material.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListOcorrencias extends StatefulWidget {
  const ListOcorrencias({super.key});
  @override
  _ListOcorrenciasPageState createState() => _ListOcorrenciasPageState();
}

class _ListOcorrenciasPageState extends State<ListOcorrencias> {
  /// Muda a cada ocorrência criada: recria as abas (e o initState delas
  /// recarrega a lista). Antes o setState do pai não chegava nas abas e a
  /// ocorrência recém-aberta só aparecia saindo e entrando da tela.
  int _versao = 0;

  @override
  Widget build(BuildContext context) {
    final canManage = getUserType() == 'sindico' || getUserPermission('ocorrencias') == 1;
    return DefaultTabController(
      length: 4,
      child: AppScaffold(
        title: getText('ocorrencia_abertura_nav'),
        actions: canManage
            ? [
                IconButton(
                  tooltip: 'Categorias e SLA',
                  icon: const Icon(PhosphorIcons.slidersHorizontal),
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const ListCategoriasOcorrencia()),
                  ),
                ),
              ]
            : null,
        floatingActionButton: FloatingActionButton(
          onPressed: () => Navigator.push(context,
                  MaterialPageRoute(builder: (_) => const NewOcorrencia(isEdit: false)))
              .then((_) => setState(() => _versao++)),
          backgroundColor: AppColors.primary,
          child: const Icon(PhosphorIcons.plus, color: Colors.white),
        ),
        body: Column(
          children: [
            Container(
              color: AppColors.surface(context),
              width: double.infinity,
              child: TabBar(
                isScrollable: true,
                indicatorColor: AppColors.primary,
                labelColor: AppColors.primary,
                unselectedLabelColor: AppColors.textSecondary(context),
                labelStyle: AppTypography.captionMedium(context).copyWith(fontWeight: FontWeight.bold),
                tabs: const [
                  Tab(text: 'Todas'),
                  Tab(text: 'Pendentes'),
                  Tab(text: 'Em andamento'),
                  Tab(text: 'Solucionadas'),
                ],
              ),
            ),
            Expanded(
              child: TabBarView(
                children: [
                  ListOcorrenciasTodos(key: ValueKey('todas-$_versao')),
                  ListOcorrenciasTodos(key: ValueKey('pendentes-$_versao'), statusFilter: 'Pendente'),
                  ListOcorrenciasTodos(key: ValueKey('andamento-$_versao'), statusFilter: 'Em andamento'),
                  ListOcorrenciasTodos(key: ValueKey('solucionadas-$_versao'), statusFilter: 'Solucionado'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
