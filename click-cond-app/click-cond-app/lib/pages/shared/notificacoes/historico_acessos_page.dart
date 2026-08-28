import 'package:click/controllers/controller_condominio.dart';
import 'package:click/utils/datas.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Área dedicada aos eventos de entrada e saída de visitantes, prestadores e morador.
/// Permite filtrar por tipo (Todos, Visitantes, Prestadores, Entradas, Saídas),
/// pesquisar por nome e visualizar os detalhes completos de cada acesso em modal dedicado.
class HistoricoAcessosPage extends StatefulWidget {
  final int? destacarId;
  final String? filtroInicial;

  const HistoricoAcessosPage({
    Key? key,
    this.destacarId,
    this.filtroInicial,
  }) : super(key: key);

  @override
  State<HistoricoAcessosPage> createState() => _HistoricoAcessosPageState();
}

class _HistoricoAcessosPageState extends State<HistoricoAcessosPage> {
  List<dynamic> _eventos = [];
  bool _isLoading = true;
  final Map<int, GlobalKey> _keys = {};
  final TextEditingController _searchController = TextEditingController();
  String _filtroSelecionado = 'todos'; // 'todos', 'visitantes', 'prestadores', 'entradas', 'saidas'

  @override
  void initState() {
    super.initState();
    if (widget.filtroInicial != null) {
      _filtroSelecionado = widget.filtroInicial!;
    }
    _carregar();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _carregar() async {
    setState(() => _isLoading = true);
    final lista = await getMeusEventos(limit: 50);
    if (!mounted) return;
    setState(() {
      _eventos = lista is List ? lista : [];
      _isLoading = false;
    });
    if (widget.destacarId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _rolarAteDestacado());
    }
  }

  void _rolarAteDestacado() {
    final key = _keys[widget.destacarId];
    final ctx = key?.currentContext;
    if (ctx == null) return;
    Scrollable.ensureVisible(
      ctx,
      duration: const Duration(milliseconds: 400),
      alignment: 0.3,
    );
  }

  String _formatDataHora(dynamic ts) => formatarDataHora(ts);

  ({IconData icon, String label}) _styleForMetodo(String? tipoDispositivo) {
    switch (tipoDispositivo) {
      case 'tag_reader':
        return (icon: PhosphorIcons.tag, label: 'Tag RFID');
      case 'qrcode_reader':
        return (icon: PhosphorIcons.qrCode, label: 'QR Code');
      case 'catraca':
        return (icon: PhosphorIcons.identificationCard, label: 'Catraca');
      case 'botoeira':
        return (icon: PhosphorIcons.bell, label: 'Botoeira');
      case 'facial':
        return (icon: PhosphorIcons.scan, label: 'Facial');
      case 'pin':
        return (icon: PhosphorIcons.key, label: 'PIN / Manual');
      default:
        return (icon: PhosphorIcons.shieldCheck, label: 'Portaria');
    }
  }

  List<dynamic> get _eventosFiltrados {
    final busca = _searchController.text.trim().toLowerCase();
    return _eventos.where((e) {
      final nome = (e['nome'] ?? '').toString().toLowerCase();
      final tipoPessoa = (e['tipo_pessoa'] ?? '').toString().toLowerCase();
      final categoria = (e['categoria'] ?? '').toString().toLowerCase();
      final evento = (e['evento'] ?? '').toString().toLowerCase();
      final condominio = (e['condominio'] ?? '').toString().toLowerCase();

      // Filtro de texto
      if (busca.isNotEmpty) {
        final matchesBusca = nome.contains(busca) ||
            condominio.contains(busca) ||
            tipoPessoa.contains(busca);
        if (!matchesBusca) return false;
      }

      // Filtro por categoria
      switch (_filtroSelecionado) {
        case 'visitantes':
          return tipoPessoa == 'visitante' || (categoria == 'visitante' && tipoPessoa != 'prestador');
        case 'prestadores':
          return tipoPessoa == 'prestador';
        case 'entradas':
          return evento == 'entrada';
        case 'saidas':
          return evento == 'saida';
        case 'todos':
        default:
          return true;
      }
    }).toList();
  }

  void _showDetalhesEvento(dynamic e) {
    final isEntrada = (e['evento'] ?? '').toString() == 'entrada';
    final isVoce = (e['categoria'] ?? '').toString() == 'voce';
    final tipoPessoa = (e['tipo_pessoa'] ?? '').toString();
    final nome = (e['nome'] ?? '').toString();
    final condominio = (e['condominio'] ?? '').toString();
    final tipoDispositivo = e['tipo_dispositivo']?.toString();
    final confianca = e['confianca'];
    final timestamp = e['timestamp'];

    final Color cor = isEntrada ? AppColors.success : AppColors.primary;
    final IconData icon = isEntrada ? PhosphorIcons.signIn : PhosphorIcons.signOut;
    final String tag = isVoce
        ? 'Morador (Você)'
        : (tipoPessoa == 'prestador' ? 'Prestador de Serviço' : 'Visitante');
    final Color tagColor = isVoce ? AppColors.primary : Colors.orange;
    final metodo = _styleForMetodo(tipoDispositivo);

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (ctx) {
        return Container(
          decoration: BoxDecoration(
            color: AppColors.surfaceElevated(ctx),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
            border: Border(top: BorderSide(color: AppColors.border(ctx))),
          ),
          padding: const EdgeInsets.fromLTRB(AppSpacing.xl, AppSpacing.md, AppSpacing.xl, AppSpacing.xxl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Indicador de arrasto
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: AppSpacing.lg),
                  decoration: BoxDecoration(
                    color: AppColors.textTertiary(ctx).withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),

              // Cabeçalho com Ícone do Acesso
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      color: cor.withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(icon, color: cor, size: 28),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isEntrada ? 'Entrada Registrada' : 'Saída Registrada',
                          style: AppTypography.headline(ctx).copyWith(
                            fontWeight: FontWeight.bold,
                            color: cor,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _formatDataHora(timestamp),
                          style: AppTypography.caption(ctx).copyWith(
                            color: AppColors.textSecondary(ctx),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),

              const SizedBox(height: AppSpacing.xl),
              Divider(height: 1, color: AppColors.border(ctx)),
              const SizedBox(height: AppSpacing.lg),

              // Informações da Pessoa e Local
              _buildInfoRow(
                ctx,
                icon: PhosphorIcons.user,
                titulo: 'Pessoa',
                valor: nome.isNotEmpty ? nome : (isVoce ? 'Você' : 'Visitante'),
                badge: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: tagColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    tag,
                    style: AppTypography.tiny(ctx).copyWith(
                      color: tagColor,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              if (condominio.isNotEmpty) ...[
                _buildInfoRow(
                  ctx,
                  icon: PhosphorIcons.buildings,
                  titulo: 'Condomínio',
                  valor: condominio,
                ),
                const SizedBox(height: AppSpacing.md),
              ],

              _buildInfoRow(
                ctx,
                icon: metodo.icon,
                titulo: 'Método de Acesso',
                valor: metodo.label,
                extra: confianca != null
                    ? Text(
                        'Precisão: ${((confianca as num) * 100).toStringAsFixed(0)}%',
                        style: AppTypography.tiny(ctx).copyWith(
                          color: AppColors.textTertiary(ctx),
                        ),
                      )
                    : null,
              ),

              const SizedBox(height: AppSpacing.xxl),

              // Botão de Fechar
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text(
                    'Fechar',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildInfoRow(
    BuildContext context, {
    required IconData icon,
    required String titulo,
    required String valor,
    Widget? badge,
    Widget? extra,
  }) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(icon, size: 20, color: AppColors.primary),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  titulo,
                  style: AppTypography.tiny(context).copyWith(
                    color: AppColors.textTertiary(context),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  valor,
                  style: AppTypography.body(context).copyWith(
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary(context),
                  ),
                ),
                if (extra != null) ...[
                  const SizedBox(height: 2),
                  extra,
                ],
              ],
            ),
          ),
          if (badge != null) badge,
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtrados = _eventosFiltrados;

    return AppScaffold(
      title: 'Eventos de Acesso',
      body: Column(
        children: [
          // Campo de busca
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.md,
              AppSpacing.lg,
              AppSpacing.xs,
            ),
            child: TextField(
              controller: _searchController,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'Buscar por nome ou condomínio...',
                hintStyle: AppTypography.caption(context).copyWith(
                  color: AppColors.textTertiary(context),
                ),
                prefixIcon: Icon(
                  PhosphorIcons.magnifyingGlass,
                  color: AppColors.textTertiary(context),
                  size: 20,
                ),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: Icon(
                          PhosphorIcons.xCircleFill,
                          color: AppColors.textTertiary(context),
                          size: 18,
                        ),
                        onPressed: () {
                          _searchController.clear();
                          setState(() {});
                        },
                      )
                    : null,
                filled: true,
                fillColor: AppColors.surface(context),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md,
                  vertical: AppSpacing.sm,
                ),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: AppColors.border(context)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: AppColors.border(context)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: AppColors.primary, width: 1.5),
                ),
              ),
            ),
          ),

          // Chips de filtro
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.sm,
            ),
            child: Row(
              children: [
                _buildFilterChip('todos', 'Todos'),
                const SizedBox(width: 8),
                _buildFilterChip('visitantes', 'Visitantes'),
                const SizedBox(width: 8),
                _buildFilterChip('prestadores', 'Prestadores'),
                const SizedBox(width: 8),
                _buildFilterChip('entradas', 'Entradas'),
                const SizedBox(width: 8),
                _buildFilterChip('saidas', 'Saídas'),
              ],
            ),
          ),

          // Lista de Eventos
          Expanded(
            child: _isLoading
                ? ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    itemCount: 6,
                    separatorBuilder: (_, __) =>
                        const SizedBox(height: AppSpacing.md),
                    itemBuilder: (_, __) => AppSkeleton.listTile(context),
                  )
                : RefreshIndicator(
                    color: AppColors.primary,
                    onRefresh: _carregar,
                    child: filtrados.isEmpty
                        ? _vazio()
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(
                              AppSpacing.lg,
                              AppSpacing.xs,
                              AppSpacing.lg,
                              AppSpacing.xxl,
                            ),
                            itemCount: filtrados.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: AppSpacing.sm),
                            itemBuilder: (_, i) =>
                                _eventoCard(filtrados[i]),
                          ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String valor, String label) {
    final isSelected = _filtroSelecionado == valor;
    return InkWell(
      onTap: () => setState(() => _filtroSelecionado = valor),
      borderRadius: BorderRadius.circular(20),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: isSelected
              ? AppColors.primary
              : AppColors.surface(context),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected
                ? AppColors.primary
                : AppColors.border(context),
          ),
        ),
        child: Text(
          label,
          style: AppTypography.caption(context).copyWith(
            color: isSelected ? Colors.white : AppColors.textSecondary(context),
            fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
          ),
        ),
      ),
    );
  }

  Widget _vazio() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(height: MediaQuery.of(context).size.height * 0.18),
        Icon(
          PhosphorIcons.clockCounterClockwise,
          size: 56,
          color: AppColors.textTertiary(context),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          'Nenhum evento encontrado',
          textAlign: TextAlign.center,
          style: AppTypography.bodyMedium(context)
              .copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: AppSpacing.xs),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxl),
          child: Text(
            _searchController.text.isNotEmpty || _filtroSelecionado != 'todos'
                ? 'Tente ajustar a busca ou os filtros para encontrar eventos de acesso.'
                : 'As entradas e saídas de visitantes e prestadores aparecerão aqui assim que forem registradas.',
            textAlign: TextAlign.center,
            style: AppTypography.caption(context),
          ),
        ),
      ],
    );
  }

  Widget _eventoCard(dynamic e) {
    final id = int.tryParse(e['id']?.toString() ?? '');
    final destacado = id != null && id == widget.destacarId;
    final key = id != null ? (_keys[id] ??= GlobalKey()) : null;

    final isEntrada = (e['evento'] ?? '').toString() == 'entrada';
    final isVoce = (e['categoria'] ?? '').toString() == 'voce';
    final tipoPessoa = (e['tipo_pessoa'] ?? '').toString();
    final nome = (e['nome'] ?? '').toString();
    final condominio = (e['condominio'] ?? '').toString();
    final tipoDispositivo = e['tipo_dispositivo']?.toString();

    final Color cor = isEntrada ? AppColors.success : AppColors.primary;
    final IconData icon =
        isEntrada ? PhosphorIcons.signIn : PhosphorIcons.signOut;
    final String tag =
        isVoce ? 'Você' : (tipoPessoa == 'prestador' ? 'Prestador' : 'Visitante');
    final Color tagColor = isVoce ? AppColors.primary : Colors.orange;
    final metodo = _styleForMetodo(tipoDispositivo);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _showDetalhesEvento(e),
        child: Container(
          key: key,
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: destacado
                ? cor.withValues(alpha: 0.08)
                : AppColors.surface(context),
            borderRadius: BorderRadius.circular(16),
            border: destacado
                ? Border.all(color: cor.withValues(alpha: 0.4), width: 1.5)
                : Border.all(color: AppColors.border(context)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(AppSpacing.sm),
                decoration: BoxDecoration(
                  color: cor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(AppRadius.md),
                ),
                child: Icon(icon, color: cor, size: 20),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          isEntrada ? 'Entrou' : 'Saiu',
                          style: AppTypography.bodyMedium(context)
                              .copyWith(color: cor, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            nome.isNotEmpty
                                ? nome
                                : (isVoce ? 'Você' : 'Visitante'),
                            style: AppTypography.caption(context).copyWith(
                              color: AppColors.textSecondary(context),
                              fontWeight: FontWeight.w500,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: tagColor.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(5),
                          ),
                          child: Text(
                            tag,
                            style: AppTypography.tiny(context).copyWith(
                              color: tagColor,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        Text(
                          _formatDataHora(e['timestamp']),
                          style: AppTypography.tiny(context)
                              .copyWith(color: AppColors.textTertiary(context)),
                        ),
                        if (tipoDispositivo != null && tipoDispositivo.isNotEmpty) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 5, vertical: 1),
                            decoration: BoxDecoration(
                              color: AppColors.textSecondary(context)
                                  .withValues(alpha: 0.08),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  metodo.icon,
                                  size: 10,
                                  color: AppColors.textTertiary(context),
                                ),
                                const SizedBox(width: 3),
                                Text(
                                  metodo.label,
                                  style: AppTypography.tiny(context).copyWith(
                                    color: AppColors.textTertiary(context),
                                    fontSize: 10,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                    if (condominio.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        condominio,
                        style: AppTypography.tiny(context)
                            .copyWith(color: AppColors.textTertiary(context)),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 6),
              Icon(
                PhosphorIcons.info,
                size: 18,
                color: AppColors.textTertiary(context),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
