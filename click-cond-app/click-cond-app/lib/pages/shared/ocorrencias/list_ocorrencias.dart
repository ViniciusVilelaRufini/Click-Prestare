import 'package:click/pages/shared/ocorrencias/list_ocorrencias_todos.dart';
import 'package:click/pages/shared/ocorrencias/new_ocorrencia.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:flutter/material.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListOcorrencias extends StatefulWidget {
  const ListOcorrencias({Key? key}) : super(key: key);
  @override
  _ListOcorrenciasPageState createState() => _ListOcorrenciasPageState();
}

class _ListOcorrenciasPageState extends State<ListOcorrencias> {
  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 4,
      child: AppScaffold(
        title: getText('ocorrencia_abertura_nav'),
        floatingActionButton: FloatingActionButton(
          onPressed: () => Navigator.push(context,
                  MaterialPageRoute(builder: (_) => const NewOcorrencia(isEdit: false)))
              .then((_) => setState(() {})),
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
            const Expanded(
              child: TabBarView(
                children: [
                  ListOcorrenciasTodos(),
                  ListOcorrenciasTodos(statusFilter: 'Pendente'),
                  ListOcorrenciasTodos(statusFilter: 'Em andamento'),
                  ListOcorrenciasTodos(statusFilter: 'Solucionado'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
