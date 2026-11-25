import 'dart:async';

import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/areas%20sociais/agendamentos_cells.dart';
import 'package:click/pages/shared/areas%20sociais/areas_sociais_cells.dart';
import 'package:click/pages/shared/areas%20sociais/meus_agendamentos_cells.dart';
import 'package:click/pages/shared/areas%20sociais/new_area_social.dart';
import 'package:click/services/atualizacoes_app.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_segmented_control.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListAreasSociais extends StatefulWidget {
  /// Abre na aba "Minhas reservas" (morador): o push de reserva
  /// (`confirmacao_reserva`, `reserva_status`, cancelamentos) leva ao card da
  /// reserva, onde está o "Confirmar presença".
  final bool minhasReservas;

  /// Condomínio do push tocado: com o app aberto pelo push não há condomínio
  /// aberto. Null = o aberto.
  final int? idCondominio;
  const ListAreasSociais({super.key, this.minhasReservas = false, this.idCondominio});
  @override
  _ListAreasSociaisPageState createState() => _ListAreasSociaisPageState();
}

class _ListAreasSociaisPageState extends State<ListAreasSociais> {
  List<dynamic> list = [];
  List<dynamic> listAgendamentos = [];
  List<dynamic> listMeusAgendamentos = [];
  int _currentTab = 0;
  bool _isLoading = false;

  /// Push de reserva ou volta ao app: recarrega áreas e reservas.
  StreamSubscription<DominioApp>? _atualizacoes;

  /// Índice da aba "Minhas reservas" (a última, só para o morador).
  int get _abaMinhasReservas => _isSindico ? 2 : 1;

  @override
  void initState() {
    super.initState();
    if (widget.minhasReservas && _isMorador) _currentTab = _abaMinhasReservas;
    _atualizacoes = ouvirAtualizacoes({DominioApp.reserva}, () {
      if (mounted) loadAll(recarga: true);
    });
    loadAll();
  }

  @override
  void dispose() {
    _atualizacoes?.cancel();
    super.dispose();
  }

  /// [recarga] na atualização automática: se alguma busca falhar (sem rede,
  /// 401/5xx), ficam as listas atuais em vez de um falso "nada por aqui".
  Future<void> loadAll({bool recarga = false}) async {
    // Tela cheia de carregamento só quando ainda não há nada para mostrar.
    if (list.isEmpty) setState(() => _isLoading = true);
    try {
      final cond = widget.idCondominio;
      final extras = cond == null ? null : {'id_condominio': '$cond'};
      Future<dynamic> buscar(String rota) =>
          recarga ? apiGetAllOuNull(rota, extras: extras) : apiGetAll(rota, extras: extras);
      final List<Future<dynamic>> futures = [
        buscar("areas-sociais"),
        buscar("areas-sociais/meus-agendamentos"),
      ];
      if (_isSindico) {
        futures.add(buscar("areas-sociais/agendamentos"));
      }

      final results = await Future.wait(futures);
      if (results.contains(null)) {
        if (mounted) setState(() => _isLoading = false);
        return;
      }
      list = results[0];
      listMeusAgendamentos = results[1];
      if (_isSindico) {
        listAgendamentos = results[2];
      }
    } catch (_) {}
    if (mounted) setState(() => _isLoading = false);
  }

  bool get _isSindico =>
      getUserType() == 'sindico' ||
      (getUserType() == 'funcionario' && getUserPermission("areas_sociais") == 1);
  bool get _isMorador => getUserType() == 'morador';

  @override
  Widget build(BuildContext context) {
    final titulos = <String>[
      getText('lb_areas_sociais'),
      if (_isSindico) getText('area_social_agendamentos'),
      if (_isMorador) getText('area_social_meus_agendamentos'),
    ];

    // Recarga depois de aprovar/cancelar/confirmar (e o puxar-para-atualizar):
    // se a busca falhar, fica a lista que já estava na tela, em vez de um
    // falso "nada por aqui" logo depois de uma ação que deu certo.
    Future<void> recarregar() => loadAll(recarga: true);
    final views = <Widget>[
      AreasSociaisCells(list: list, reload: recarregar),
      if (_isSindico) AgendamentosCells(list: listAgendamentos, reload: recarregar),
      if (_isMorador) MeusAgendamentosCells(list: listMeusAgendamentos, reload: recarregar),
    ];

    final aba = _currentTab < titulos.length ? _currentTab : 0;
    final canAddArea = aba == 0 && (_isSindico || getUserPermission("areas_sociais") == 1);

    return AppScaffold(
        title: getText('lb_areas_sociais'),
        floatingActionButton: canAddArea
            ? FloatingActionButton(
                onPressed: () => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => NewAreaSocial(isEdit: false)))
                    .then((_) => loadAll(recarga: true)),
                backgroundColor: AppColors.brand,
                child: Icon(PhosphorIcons.plus, color: AppColors.onBrand),
              )
            : null,
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.sm),
              child: AppSegmentedControl(
                selectedIndex: aba,
                onChanged: (i) => setState(() => _currentTab = i),
                segments: [for (final t in titulos) AppSegment(label: t)],
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
                  : views[aba],
            ),
          ],
        ),
    );
  }
}
