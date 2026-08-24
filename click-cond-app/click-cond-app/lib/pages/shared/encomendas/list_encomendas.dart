import 'dart:convert';
import 'dart:typed_data';

import 'package:click/controllers/controller_encomendas.dart';
import 'package:click/models/encomenda_model.dart';
import 'package:click/pages/shared/encomendas/new_encomenda.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:intl/intl.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class ListEncomendas extends StatefulWidget {
  final bool allCondos;
  final bool hideAppBar;
  final bool showFab;
  final int? destacarId;
  const ListEncomendas({
    Key? key,
    this.allCondos = false,
    this.hideAppBar = false,
    this.showFab = true,
    this.destacarId,
  }) : super(key: key);

  @override
  ListEncomendasState createState() => ListEncomendasState();
}

class ListEncomendasState extends State<ListEncomendas> {
  bool _isLoading = false;
  List<EncomendaModel> _encomendas = [];
  bool _jaAbriuDestaque = false;
  String _filtroStatus = 'todos'; // 'todos', 'aguardando', 'retirada'
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  bool get _isStaff {
    final type = getUserType().toLowerCase();
    return type == 'sindico' || type == 'funcionario';
  }

  @override
  void initState() {
    super.initState();
    _loadList();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadList() async {
    if (_encomendas.isEmpty) setState(() => _isLoading = true);
    try {
      final List<dynamic> result = await apiGetAllEncomendas(allCondos: widget.allCondos);
      if (mounted) {
        setState(() {
          _encomendas = result.map((e) => EncomendaModel.fromJson(e)).toList();
        });
        _abrirDestaqueSeNecessario();
      }
    } catch (e) {
      if (mounted) {
        displayMessage(context, getText('alert_error'), 'Erro ao carregar encomendas');
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void openAddEncomenda(BuildContext context) {
    if (_isStaff) {
      Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => const NewEncomenda()),
      ).then((res) {
        if (res == true) _loadList();
      });
    } else {
      showRegisterTrackingDialog(context);
    }
  }

  void _abrirDestaqueSeNecessario() {
    if (widget.destacarId == null || _jaAbriuDestaque) return;
    final match = _encomendas.where((e) => e.id == widget.destacarId).toList();
    if (match.isEmpty) return;
    _jaAbriuDestaque = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _EncomendaCard.abrir(
          context,
          match.first,
          isStaff: _isStaff,
          onRetirada: _loadList,
          onEdit: (enc) => _editarEncomenda(enc),
          onDelete: (enc) => _confirmDeleteEncomenda(enc),
        );
      }
    });
  }

  void _editarEncomenda(EncomendaModel enc) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => NewEncomenda(encomenda: enc)),
    ).then((res) {
      if (res == true) _loadList();
    });
  }

  List<EncomendaModel> get _encomendasFiltradas {
    return _encomendas.where((e) {
      final statusLower = (e.status ?? '').toLowerCase();
      final isRetirada = statusLower == 'retirado' || statusLower == 'retirada' || statusLower == 'entregue';
      
      if (_filtroStatus == 'aguardando' && isRetirada) return false;
      if (_filtroStatus == 'retirada' && !isRetirada) return false;

      if (_searchQuery.isNotEmpty) {
        final query = _searchQuery.toLowerCase().trim();
        final apto = (e.destinatarioApto ?? '').toLowerCase();
        final bloco = (e.destinatarioBloco ?? '').toLowerCase();
        final desc = (e.descricao ?? '').toLowerCase();
        final rem = (e.recebidoDe ?? '').toLowerCase();
        final rastreio = (e.codigoRastreio ?? '').toLowerCase();
        final retPor = (e.retiradoPor ?? '').toLowerCase();

        final matchApto = '$bloco $apto'.contains(query) || '$apto $bloco'.contains(query) || apto.contains(query);
        final matchDesc = desc.contains(query) || rem.contains(query) || rastreio.contains(query) || retPor.contains(query);
        if (!matchApto && !matchDesc) return false;
      }

      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final title = _isStaff ? 'Encomendas do Condomínio' : 'Minhas Encomendas';
    final lista = _encomendasFiltradas;

    return AppScaffold(
      title: title,
      showBackButton: !widget.hideAppBar,
      safeAreaBottom: !widget.hideAppBar,
      floatingActionButton: widget.showFab
          ? FloatingActionButton.extended(
              heroTag: 'register_tracking_fab',
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              onPressed: () => openAddEncomenda(context),
              icon: const Icon(PhosphorIcons.plus, color: Colors.white, size: 20),
              label: Text(
                _isStaff ? 'Nova Encomenda' : 'Avisar Encomenda',
                style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
              ),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Barra de Busca
                Container(
                  decoration: BoxDecoration(
                    color: AppColors.surface(context),
                    borderRadius: BorderRadius.circular(AppRadius.lg),
                    border: Border.all(color: AppColors.border(context)),
                  ),
                  child: TextField(
                    controller: _searchController,
                    onChanged: (val) => setState(() => _searchQuery = val),
                    decoration: InputDecoration(
                      hintText: _isStaff ? 'Buscar por apto, bloco, descrição, rastreio...' : 'Buscar nas encomendas...',
                      hintStyle: AppTypography.caption(context),
                      prefixIcon: Icon(PhosphorIcons.magnifyingGlass, size: 18, color: AppColors.textTertiary(context)),
                      suffixIcon: _searchQuery.isNotEmpty
                          ? IconButton(
                              icon: const Icon(PhosphorIcons.x, size: 16),
                              onPressed: () {
                                _searchController.clear();
                                setState(() => _searchQuery = '');
                              },
                            )
                          : null,
                      border: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                // Chips de filtro por status
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _buildFilterChip('Todas', 'todos', _encomendas.length),
                      const SizedBox(width: AppSpacing.xs),
                      _buildFilterChip(
                        'Aguardando',
                        'aguardando',
                        _encomendas.where((e) {
                          final s = (e.status ?? '').toLowerCase();
                          return s != 'retirado' && s != 'retirada' && s != 'entregue';
                        }).length,
                        color: Colors.orange,
                      ),
                      const SizedBox(width: AppSpacing.xs),
                      _buildFilterChip(
                        'Entregues',
                        'retirada',
                        _encomendas.where((e) {
                          final s = (e.status ?? '').toLowerCase();
                          return s == 'retirado' || s == 'retirada' || s == 'entregue';
                        }).length,
                        color: Colors.green,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.sm),

          // Lista de Encomendas
          Expanded(
            child: _isLoading
                ? ListView.separated(
                    padding: const EdgeInsets.only(
                      left: AppSpacing.lg,
                      right: AppSpacing.lg,
                      top: AppSpacing.sm,
                      bottom: 120,
                    ),
                    itemCount: 6,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                    itemBuilder: (_, __) => AppSkeleton.listTile(context),
                  )
                : RefreshIndicator(
                    onRefresh: _loadList,
                    child: lista.isEmpty
                        ? _buildEmptyState()
                        : ListView.builder(
                            padding: const EdgeInsets.only(
                              left: AppSpacing.lg,
                              right: AppSpacing.lg,
                              top: AppSpacing.sm,
                              bottom: 120,
                            ),
                            itemCount: lista.length,
                            itemBuilder: (context, index) {
                              return _EncomendaCard(
                                key: ValueKey(lista[index].id),
                                encomenda: lista[index],
                                isStaff: _isStaff,
                                onRetirada: _loadList,
                                onEdit: (enc) => _editarEncomenda(enc),
                                onDelete: (enc) => _confirmDeleteEncomenda(enc),
                              );
                            },
                          ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, String value, int count, {Color? color}) {
    final isSelected = _filtroStatus == value;
    final activeColor = color ?? AppColors.primary;

    return FilterChip(
      selected: isSelected,
      label: Text('$label ($count)'),
      labelStyle: TextStyle(
        fontSize: 12,
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
        color: isSelected ? Colors.white : AppColors.textSecondary(context),
      ),
      backgroundColor: AppColors.surface(context),
      selectedColor: activeColor,
      checkmarkColor: Colors.white,
      showCheckmark: false,
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 0),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(
          color: isSelected ? activeColor : AppColors.border(context),
          width: 1,
        ),
      ),
      onSelected: (_) => setState(() => _filtroStatus = value),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xxl),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(AppSpacing.xxl),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.08),
                  shape: BoxShape.circle,
                ),
                child: const Icon(PhosphorIcons.package, size: 56, color: AppColors.primary),
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(
                _searchQuery.isNotEmpty
                    ? 'Nenhuma encomenda corresponde à busca'
                    : (_isStaff
                        ? 'Nenhuma encomenda registrada no condomínio'
                        : 'Nenhuma encomenda encontrada'),
                style: AppTypography.title(context).copyWith(fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                _isStaff
                    ? 'Toque no botão "+ Nova Encomenda" abaixo para registrar a chegada de um pacote.'
                    : 'Suas encomendas recebidas pela portaria aparecerão aqui.',
                style: AppTypography.bodySecondary(context),
                textAlign: TextAlign.center,
              ),
              if (_isStaff) ...[
                const SizedBox(height: AppSpacing.xl),
                ElevatedButton.icon(
                  onPressed: () => openAddEncomenda(context),
                  icon: const Icon(PhosphorIcons.plus, size: 18),
                  label: const Text('Cadastrar Nova Encomenda'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _confirmDeleteEncomenda(EncomendaModel enc) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: AppColors.surface(ctx),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.error.withOpacity(0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(PhosphorIcons.trash, color: AppColors.error, size: 32),
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(
                'Excluir Encomenda',
                style: AppTypography.headline(ctx).copyWith(fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'Tem certeza que deseja excluir o volume "${enc.descricao}" destinado ao Apto ${enc.destinatarioApto}? Esta ação não pode ser desfeita.',
                style: AppTypography.bodySecondary(ctx),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.xl),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        side: BorderSide(color: AppColors.border(ctx)),
                      ),
                      onPressed: () => Navigator.pop(ctx, false),
                      child: Text('Cancelar', style: TextStyle(color: AppColors.textSecondary(ctx))),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.error,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        elevation: 0,
                      ),
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('Excluir', style: TextStyle(fontWeight: FontWeight.bold)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );

    if (ok == true && enc.id != null) {
      final success = await apiRemoveEncomenda(enc.id!);
      if (mounted) {
        if (success) {
          displayMessage(context, 'Sucesso', 'Encomenda removida com sucesso');
          _loadList();
        } else {
          displayMessage(context, 'Erro', 'Falha ao remover encomenda');
        }
      }
    }
  }

  /// Dialog de aviso de encomenda esperado pelo morador (iFood/Correios)
  void showRegisterTrackingDialog(BuildContext context) {
    final formKey = GlobalKey<FormState>();
    final txtDescricao = TextEditingController();
    final txtCodigo = TextEditingController();
    final txtValidacao = TextEditingController();
    String selectedCarrier = 'Correios';

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setState) {
            return AlertDialog(
              backgroundColor: AppColors.surface(context),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              title: Text(
                'Aviso de Encomenda',
                style: AppTypography.body(context).copyWith(fontWeight: FontWeight.bold),
              ),
              content: Form(
                key: formKey,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Avise que uma encomenda vai chegar. Para iFood/delivery, informe o código de validação para a portaria receber por você.',
                        style: AppTypography.caption(context),
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: txtDescricao,
                        decoration: InputDecoration(
                          labelText: 'Descrição (Ex: Livro, Roupa)',
                          labelStyle: AppTypography.caption(context),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        validator: (value) => value == null || value.isEmpty ? 'Campo obrigatório' : null,
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: selectedCarrier,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: 'Transportadora',
                          labelStyle: AppTypography.caption(context),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                        ),
                        dropdownColor: AppColors.surface(context),
                        icon: const Icon(PhosphorIcons.caretDown, size: 18),
                        items: ['Correios', 'iFood', 'Mercado Livre', 'Amazon', 'Loggi', 'Outro']
                            .map((c) => DropdownMenuItem<String>(value: c, child: Text(c)))
                            .toList(),
                        onChanged: (val) {
                          if (val != null) setState(() => selectedCarrier = val);
                        },
                      ),
                      const SizedBox(height: 12),
                      if (_isDeliveryCarrier(selectedCarrier))
                        TextFormField(
                          controller: txtValidacao,
                          keyboardType: TextInputType.number,
                          decoration: InputDecoration(
                            labelText: 'Código de validação (opcional)',
                            hintText: 'Ex.: código que o iFood pede na entrega',
                            labelStyle: AppTypography.caption(context),
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                        )
                      else
                        TextFormField(
                          controller: txtCodigo,
                          decoration: InputDecoration(
                            labelText: 'Código de Rastreio (opcional)',
                            labelStyle: AppTypography.caption(context),
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              actions: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    OutlinedButton(
                      onPressed: () => Navigator.pop(context),
                      style: OutlinedButton.styleFrom(
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      ),
                      child: Text('Cancelar', style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context))),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        elevation: 0,
                      ),
                      onPressed: () async {
                        if (formKey.currentState?.validate() ?? false) {
                          final isDelivery = _isDeliveryCarrier(selectedCarrier);
                          final success = await apiCadastrarRastreio(
                            txtDescricao.text,
                            selectedCarrier,
                            codigoRastreio: isDelivery ? null : (txtCodigo.text.trim().isEmpty ? null : txtCodigo.text.trim()),
                            codigoValidacao: isDelivery ? (txtValidacao.text.trim().isEmpty ? null : txtValidacao.text.trim()) : null,
                          );
                          if (success) {
                            Navigator.pop(context);
                            _loadList();
                            displayMessage(context, 'Sucesso', 'Encomenda cadastrada com sucesso!');
                          } else {
                            displayMessage(context, 'Erro', 'Não foi possível cadastrar encomenda.');
                          }
                        }
                      },
                      child: const Text('Cadastrar', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
              ],
            );
          },
        );
      },
    );
  }

  bool _isDeliveryCarrier(String carrier) {
    final c = carrier.toLowerCase();
    return c.contains('ifood') || c.contains('food') || c.contains('delivery');
  }
}

class _EncomendaCard extends StatelessWidget {
  final EncomendaModel encomenda;
  final bool isStaff;
  final VoidCallback? onRetirada;
  final void Function(EncomendaModel)? onEdit;
  final void Function(EncomendaModel)? onDelete;

  const _EncomendaCard({
    Key? key,
    required this.encomenda,
    this.isStaff = false,
    this.onRetirada,
    this.onEdit,
    this.onDelete,
  }) : super(key: key);

  static void abrir(
    BuildContext context,
    EncomendaModel encomenda, {
    bool isStaff = false,
    VoidCallback? onRetirada,
    void Function(EncomendaModel)? onEdit,
    void Function(EncomendaModel)? onDelete,
  }) {
    final statusLower = (encomenda.status ?? '').toLowerCase();
    final isRetirado = statusLower == 'retirado' || statusLower == 'retirada' || statusLower == 'entregue';
    Color statusColor;
    if (isRetirado) {
      statusColor = Colors.green;
    } else if (statusLower == 'cancelado' || statusLower == 'recusado') {
      statusColor = Colors.red;
    } else if (statusLower == 'esperando') {
      statusColor = Colors.blue;
    } else {
      statusColor = Colors.orange;
    }

    String dataFormatada = '';
    if (encomenda.recebidoEm != null) {
      try {
        final dt = DateTime.parse(encomenda.recebidoEm!).toLocal();
        dataFormatada = DateFormat('dd/MM/yyyy HH:mm').format(dt);
      } catch (_) {
        dataFormatada = encomenda.recebidoEm!;
      }
    } else if (statusLower == 'esperando') {
      dataFormatada = 'Aguardando chegada';
    }

    _EncomendaCard(
      encomenda: encomenda,
      isStaff: isStaff,
      onRetirada: onRetirada,
      onEdit: onEdit,
      onDelete: onDelete,
    )._showEncomendaDetails(context, dataFormatada, statusColor);
  }

  bool get _jaRetirada {
    final s = (encomenda.status ?? '').toLowerCase();
    return s == 'retirado' || s == 'retirada' || s == 'entregue';
  }

  Future<void> _abrirRetirada(BuildContext detailContext) async {
    final txtRetiradoPor = TextEditingController(text: isStaff ? '' : getUsername());
    final txtDoc = TextEditingController();
    Uint8List? fotoBytes;
    bool enviando = false;

    await showModalBottomSheet(
      context: detailContext,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      isDismissible: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            Future<void> anexarFoto() async {
              final img = await getPhoto(context);
              if (img == null) return;
              final bytes = await img.readAsBytes();
              setSheetState(() => fotoBytes = bytes);
            }

            Future<void> confirmar() async {
              final nome = txtRetiradoPor.text.trim().isNotEmpty
                  ? txtRetiradoPor.text.trim()
                  : (isStaff ? 'Morador' : getUsername());

              setSheetState(() => enviando = true);

              final foto = fotoBytes == null
                  ? null
                  : 'data:image/jpeg;base64,${base64Encode(fotoBytes!)}';

              final ok = await apiRetirarEncomenda(
                encomenda.id ?? 0,
                nome,
                retiradoFoto: foto,
              );

              if (!sheetContext.mounted) return;
              Navigator.pop(sheetContext);
              if (detailContext.mounted) Navigator.pop(detailContext);

              if (ok) {
                onRetirada?.call();
              }
              ScaffoldMessenger.of(detailContext).showSnackBar(
                SnackBar(
                  content: Text(ok
                      ? 'Entrega / Retirada confirmada com sucesso!'
                      : 'Não foi possível confirmar a retirada. Tente novamente.'),
                  backgroundColor: ok ? Colors.green : AppColors.error,
                ),
              );
            }

            return Container(
              decoration: BoxDecoration(
                color: AppColors.surface(context),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
              ),
              padding: EdgeInsets.fromLTRB(
                AppSpacing.xl,
                AppSpacing.md,
                AppSpacing.xl,
                MediaQuery.of(context).viewInsets.bottom + MediaQuery.of(context).padding.bottom + AppSpacing.xl,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: Container(
                        width: 38,
                        height: 4,
                        decoration: BoxDecoration(
                          color: AppColors.textTertiary(context).withOpacity(0.3),
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    Row(
                      children: [
                        const Icon(PhosphorIcons.checkCircle, color: Colors.green, size: 24),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: Text(
                            isStaff ? 'Entregar Encomenda' : 'Confirmar Retirada',
                            style: AppTypography.headline(context).copyWith(fontWeight: FontWeight.bold),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      isStaff
                          ? 'Confirme a entrega do pacote ao morador ou responsável.'
                          : 'Confirme que você retirou este volume.',
                      style: AppTypography.caption(context),
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    if (isStaff) ...[
                      TextFormField(
                        controller: txtRetiradoPor,
                        decoration: InputDecoration(
                          labelText: 'Nome de quem está retirando *',
                          hintText: 'Ex.: Morador, Cônjuge, Filho...',
                          labelStyle: AppTypography.caption(context),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          prefixIcon: const Icon(PhosphorIcons.user, size: 20),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      TextFormField(
                        controller: txtDoc,
                        decoration: InputDecoration(
                          labelText: 'Documento / RG (opcional)',
                          labelStyle: AppTypography.caption(context),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          prefixIcon: const Icon(PhosphorIcons.identificationCard, size: 20),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),
                    ],

                    if (fotoBytes == null)
                      OutlinedButton.icon(
                        onPressed: enviando ? null : anexarFoto,
                        icon: const Icon(PhosphorIcons.camera, size: 18),
                        label: const Text('Anexar foto do comprovante (opcional)'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.primary,
                          side: BorderSide(color: AppColors.primary.withOpacity(0.5)),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      )
                    else ...[
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.memory(
                          fotoBytes!,
                          height: 160,
                          width: double.infinity,
                          fit: BoxFit.cover,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Row(
                        children: [
                          Expanded(
                            child: TextButton.icon(
                              onPressed: enviando ? null : anexarFoto,
                              icon: const Icon(PhosphorIcons.arrowsClockwise, size: 16),
                              label: const Text('Trocar'),
                            ),
                          ),
                          Expanded(
                            child: TextButton.icon(
                              onPressed: enviando ? null : () => setSheetState(() => fotoBytes = null),
                              icon: const Icon(PhosphorIcons.trash, size: 16, color: Colors.redAccent),
                              label: const Text('Remover', style: TextStyle(color: Colors.redAccent)),
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: AppSpacing.lg),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      onPressed: enviando ? null : confirmar,
                      child: enviando
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Text(
                              isStaff ? 'Confirmar Entrega' : 'Confirmar Retirada',
                              style: const TextStyle(fontWeight: FontWeight.bold),
                            ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildBrandIcon(BuildContext context) {
    final recebidoDe = (encomenda.recebidoDe ?? '').toLowerCase();
    
    IconData iconData = PhosphorIcons.package;
    Color iconColor = AppColors.primary;
    Color bgColor = AppColors.primary.withOpacity(0.12);

    if (recebidoDe.contains('ifood') || recebidoDe.contains('food') || recebidoDe.contains('delivery') || recebidoDe.contains('pizza') || recebidoDe.contains('lanche')) {
      iconData = PhosphorIcons.hamburger;
      iconColor = const Color(0xFFEA1D2C);
      bgColor = const Color(0xFFEA1D2C).withOpacity(0.12);
    } else if (recebidoDe.contains('mercado livre') || recebidoDe.contains('mercado') || recebidoDe.contains('ml')) {
      iconData = PhosphorIcons.handshake;
      iconColor = const Color(0xFFE5B800);
      bgColor = const Color(0xFFF2C200).withOpacity(0.15);
    } else if (recebidoDe.contains('amazon')) {
      iconData = PhosphorIcons.shoppingCart;
      iconColor = const Color(0xFFFF9900);
      bgColor = const Color(0xFFFF9900).withOpacity(0.12);
    } else if (recebidoDe.contains('correios') || recebidoDe.contains('sedex') || recebidoDe.contains('pac')) {
      iconData = PhosphorIcons.envelopeSimple;
      iconColor = const Color(0xFF005DA5);
      bgColor = const Color(0xFF005DA5).withOpacity(0.12);
    } else if (recebidoDe.contains('shopee')) {
      iconData = PhosphorIcons.shoppingBag;
      iconColor = const Color(0xFFEE4D2D);
      bgColor = const Color(0xFFEE4D2D).withOpacity(0.12);
    } else if (recebidoDe.contains('dhl') || recebidoDe.contains('jadlog')) {
      iconData = PhosphorIcons.truck;
      iconColor = const Color(0xFFE30613);
      bgColor = const Color(0xFFE30613).withOpacity(0.12);
    } else if (recebidoDe.contains('fedex')) {
      iconData = PhosphorIcons.truck;
      iconColor = const Color(0xFF4D148C);
      bgColor = const Color(0xFF4D148C).withOpacity(0.12);
    } else if (recebidoDe.contains('loggi')) {
      iconData = PhosphorIcons.truck;
      iconColor = const Color(0xFF00A3E0);
      bgColor = const Color(0xFF00A3E0).withOpacity(0.12);
    }

    return Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Icon(iconData, color: iconColor, size: 24),
    );
  }

  @override
  Widget build(BuildContext context) {
    final statusLower = (encomenda.status ?? '').toLowerCase();
    final isRetirado = statusLower == 'retirado' || statusLower == 'retirada' || statusLower == 'entregue';
    Color statusColor;
    String statusText;
    if (isRetirado) {
      statusColor = Colors.green;
      statusText = 'ENTREGUE';
    } else if (statusLower == 'cancelado' || statusLower == 'recusado') {
      statusColor = Colors.red;
      statusText = 'CANCELADO';
    } else if (statusLower == 'esperando') {
      statusColor = Colors.blue;
      statusText = 'A CHEGAR';
    } else {
      statusColor = Colors.orange;
      statusText = 'AGUARDANDO RETIRADA';
    }
    
    String dataFormatada = '';
    if (encomenda.recebidoEm != null) {
      try {
        DateTime dt = DateTime.parse(encomenda.recebidoEm!).toLocal();
        dataFormatada = DateFormat('dd/MM/yyyy HH:mm').format(dt);
      } catch (_) {
        dataFormatada = encomenda.recebidoEm!;
      }
    } else if (statusLower == 'esperando') {
      dataFormatada = 'Aguardando chegada';
    }

    final hasPhoto = encomenda.fotoVolume != null && encomenda.fotoVolume!.isNotEmpty;

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border(context)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.lg),
          onTap: () => _showEncomendaDetails(context, dataFormatada, statusColor),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Top Header Row: Unidade Badge + Status Pill
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    if (encomenda.destinatarioApto != null && encomenda.destinatarioApto!.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppColors.primary.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(PhosphorIcons.buildings, size: 13, color: AppColors.primary),
                            const SizedBox(width: 5),
                            Text(
                              '${encomenda.destinatarioBloco != null && encomenda.destinatarioBloco!.isNotEmpty ? "Bloco " + encomenda.destinatarioBloco! + " • " : ""}Apto ${encomenda.destinatarioApto}',
                              style: AppTypography.tiny(context).copyWith(
                                color: AppColors.primary,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      )
                    else
                      const SizedBox.shrink(),

                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: statusColor.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: statusColor.withOpacity(0.25)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 6,
                            height: 6,
                            decoration: BoxDecoration(
                              color: statusColor,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 5),
                          Text(
                            statusText,
                            style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),

                // Main Info Row: Icon + Description + Date + Photo Thumbnail
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildBrandIcon(context),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            encomenda.descricao ?? 'Encomenda sem descrição',
                            style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              Icon(PhosphorIcons.truck, size: 14, color: AppColors.textTertiary(context)),
                              const SizedBox(width: 4),
                              Expanded(
                                child: Text(
                                  'Transportadora: ${encomenda.recebidoDe ?? "N/A"}',
                                  style: AppTypography.caption(context).copyWith(
                                    color: AppColors.textSecondary(context),
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              Icon(PhosphorIcons.clock, size: 14, color: AppColors.textTertiary(context)),
                              const SizedBox(width: 4),
                              Expanded(
                                child: Text(
                                  statusLower == 'esperando' ? dataFormatada : 'Chegada: $dataFormatada',
                                  style: AppTypography.caption(context).copyWith(color: AppColors.textTertiary(context)),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                          if (isRetirado && encomenda.retiradoPor != null) ...[
                            const SizedBox(height: 3),
                            Row(
                              children: [
                                const Icon(PhosphorIcons.checkCircle, size: 14, color: Colors.green),
                                const SizedBox(width: 4),
                                Expanded(
                                  child: Text(
                                    'Entregue para: ${encomenda.retiradoPor}',
                                    style: AppTypography.caption(context).copyWith(
                                      color: Colors.green,
                                      fontWeight: FontWeight.w600,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (hasPhoto) ...[
                      const SizedBox(width: 8),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Container(
                          width: 52,
                          height: 52,
                          color: AppColors.surfaceElevated(context),
                          child: Image.network(
                            encomenda.fotoVolume!,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => const Center(
                              child: Icon(PhosphorIcons.imageSquare, size: 22, color: Colors.grey),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),

                // Bottom Action Buttons for Staff
                if (isStaff) ...[
                  const SizedBox(height: AppSpacing.sm),
                  const Divider(height: 1),
                  const SizedBox(height: AppSpacing.sm),
                  Row(
                    children: [
                      // Botão de Excluir
                      InkWell(
                        onTap: () => onDelete?.call(encomenda),
                        borderRadius: BorderRadius.circular(10),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                          decoration: BoxDecoration(
                            color: AppColors.error.withOpacity(0.08),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppColors.error.withOpacity(0.25)),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(PhosphorIcons.trash, size: 15, color: AppColors.error),
                              SizedBox(width: 4),
                              Text(
                                'Excluir',
                                style: TextStyle(
                                  color: AppColors.error,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const Spacer(),
                      // Botão de Editar
                      OutlinedButton.icon(
                        onPressed: () => onEdit?.call(encomenda),
                        icon: const Icon(PhosphorIcons.pencilSimple, size: 14),
                        label: const Text('Editar'),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          side: BorderSide(color: AppColors.border(context)),
                        ),
                      ),
                      if (!isRetirado) ...[
                        const SizedBox(width: 8),
                        // Botão de Dar Baixa
                        ElevatedButton.icon(
                          onPressed: () => _abrirRetirada(context),
                          icon: const Icon(PhosphorIcons.checkCircle, size: 16),
                          label: const Text('Dar Baixa'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.green,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            elevation: 0,
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _showEncomendaDetails(BuildContext context, String dataFormatada, Color statusColor) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        final hasFoto = encomenda.fotoVolume != null && encomenda.fotoVolume!.isNotEmpty;
        return Container(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.85,
          ),
          decoration: BoxDecoration(
            color: AppColors.surface(context),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.2),
                blurRadius: 15,
                offset: const Offset(0, -5),
              ),
            ],
          ),
          padding: EdgeInsets.fromLTRB(
            AppSpacing.xl,
            AppSpacing.md,
            AppSpacing.xl,
            MediaQuery.of(context).padding.bottom + AppSpacing.xl,
          ),
          child: SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 38,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.textTertiary(context).withOpacity(0.3),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                Text(
                  'Detalhes da Encomenda',
                  style: AppTypography.title(context).copyWith(fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.lg),
                if (hasFoto) ...[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      height: 220,
                      width: double.infinity,
                      color: AppColors.surfaceElevated(context),
                      child: Image.network(
                        encomenda.fotoVolume!,
                        fit: BoxFit.cover,
                        loadingBuilder: (context, child, loadingProgress) {
                          if (loadingProgress == null) return child;
                          return const Center(
                            child: CircularProgressIndicator(color: AppColors.primary),
                          );
                        },
                        errorBuilder: (_, __, ___) {
                          return Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(PhosphorIcons.warningCircle, color: AppColors.error, size: 36),
                                const SizedBox(height: 8),
                                Text(
                                  'Erro ao carregar imagem',
                                  style: AppTypography.caption(context),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                ],
                Container(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceElevated(context),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.white.withOpacity(0.03)),
                  ),
                  child: Column(
                    children: [
                      _buildDetailRow(
                        context,
                        icon: PhosphorIcons.package,
                        label: 'Descrição',
                        value: encomenda.descricao ?? 'Sem descrição',
                      ),
                      const Divider(height: 24),
                      _buildDetailRow(
                        context,
                        icon: PhosphorIcons.house,
                        label: 'Destinatário',
                        value: 'Apto ${encomenda.destinatarioApto}${encomenda.destinatarioBloco != null && encomenda.destinatarioBloco!.isNotEmpty ? " — Bloco " + encomenda.destinatarioBloco! : ""}',
                      ),
                      const Divider(height: 24),
                      _buildDetailRow(
                        context,
                        icon: PhosphorIcons.truck,
                        label: 'Transportadora / Entregador',
                        value: encomenda.recebidoDe ?? 'Não informado',
                      ),
                      const Divider(height: 24),
                      _buildDetailRow(
                        context,
                        icon: PhosphorIcons.calendar,
                        label: 'Data de Recebimento',
                        value: dataFormatada,
                      ),
                      if (encomenda.codigoRastreio != null && encomenda.codigoRastreio!.isNotEmpty) ...[
                        const Divider(height: 24),
                        _buildDetailRow(
                          context,
                          icon: PhosphorIcons.barcode,
                          label: 'Código de Rastreio',
                          value: encomenda.codigoRastreio!,
                        ),
                      ],
                      if (encomenda.codigoValidacao != null && encomenda.codigoValidacao!.isNotEmpty) ...[
                        const Divider(height: 24),
                        _buildDetailRow(
                          context,
                          icon: PhosphorIcons.key,
                          label: 'Código de validação',
                          value: encomenda.codigoValidacao!,
                        ),
                      ],
                      if (encomenda.retiradoPor != null) ...[
                        const Divider(height: 24),
                        _buildDetailRow(
                          context,
                          icon: PhosphorIcons.checkCircle,
                          label: 'Retirado por',
                          value: encomenda.retiradoPor!,
                        ),
                      ],
                      if (encomenda.retiradoEm != null) ...[
                        const Divider(height: 24),
                        _buildDetailRow(
                          context,
                          icon: PhosphorIcons.calendar,
                          label: 'Data de Retirada',
                          value: () {
                            try {
                              DateTime dt = DateTime.parse(encomenda.retiradoEm!).toLocal();
                              return DateFormat('dd/MM/yyyy HH:mm').format(dt);
                            } catch (_) {
                              return encomenda.retiradoEm!;
                            }
                          }(),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                if (!_jaRetirada) ...[
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    onPressed: () => _abrirRetirada(context),
                    icon: const Icon(PhosphorIcons.checkCircle, size: 20),
                    label: Text(
                      isStaff ? 'Dar Baixa / Entregar' : 'Marcar como retirada',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                if (isStaff) ...[
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () {
                            Navigator.pop(context);
                            onEdit?.call(encomenda);
                          },
                          icon: const Icon(PhosphorIcons.pencilSimple, size: 16),
                          label: const Text('Editar'),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () {
                            Navigator.pop(context);
                            onDelete?.call(encomenda);
                          },
                          icon: const Icon(PhosphorIcons.trash, size: 16, color: Colors.redAccent),
                          label: const Text('Excluir', style: TextStyle(color: Colors.redAccent)),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: Colors.redAccent,
                            side: BorderSide(color: Colors.redAccent.withOpacity(0.5)),
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Voltar', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildDetailRow(
    BuildContext context, {
    required IconData icon,
    required String label,
    String? value,
    Widget? widgetValue,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: AppColors.primary, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: AppTypography.tiny(context).copyWith(color: AppColors.textTertiary(context)),
              ),
              const SizedBox(height: 2),
              widgetValue ??
                  Text(
                    value ?? '',
                    style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w500),
                  ),
            ],
          ),
        ),
      ],
    );
  }
}
