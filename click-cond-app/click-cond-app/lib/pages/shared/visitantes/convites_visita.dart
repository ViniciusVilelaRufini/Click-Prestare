import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/pages/shared/visitantes/confirmar_convite.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

/// Convite de visita por link.
///
/// O morador gera, manda pelo WhatsApp, e o visitante preenche nome, CPF e
/// foto no próprio celular. O que volta é um RASCUNHO: nada aparece para a
/// portaria antes de o morador confirmar aqui.
///
/// Essa ordem é deliberada — link encaminhado para a pessoa errada vira um
/// pedido recusável, não acesso ao prédio.
class ConvitesVisitaPage extends StatefulWidget {
  const ConvitesVisitaPage({Key? key}) : super(key: key);

  @override
  State<ConvitesVisitaPage> createState() => _ConvitesVisitaPageState();
}

class _ConvitesVisitaPageState extends State<ConvitesVisitaPage> {
  List<dynamic> _pendentes = [];
  bool _carregando = true;
  bool _gerando = false;
  /// Tipo escolhido no seletor. Antes eram dois botões, que pareciam filtro.
  bool _prestador = false;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() => _carregando = true);
    final lista = await apiGetConvitesPendentes();
    if (!mounted) return;
    setState(() {
      _pendentes = lista is List ? lista : [];
      _carregando = false;
    });
  }

  Future<void> _gerar({required bool isPrestador}) async {
    if (_gerando) return;
    setState(() => _gerando = true);

    final res = await apiGerarConvite(isPrestador: isPrestador);
    if (!mounted) return;
    setState(() => _gerando = false);

    // O LINK VEM DO SERVIDOR. Montar a URL aqui obrigaria a uma release na
    // loja para trocar de domínio, e versões antigas do app continuariam
    // gerando links quebrados.
    if (res is! Map || res['url'] == null) {
      displayMessage(context, 'Ops', (res is Map ? res['erro'] : null)?.toString() ?? 'Não foi possível gerar o convite.');
      return;
    }

    final link = res['url'].toString();
    final texto = isPrestador
        ? 'Olá! Para entrar no condomínio, preencha seus dados neste link: $link'
        : 'Oi! Te convidei para o condomínio. Preencha seus dados neste link para agilizar sua entrada: $link';

    _abrirCompartilhamento(texto, link);
  }

  Future<void> _abrirCompartilhamento(String texto, String link) async {
    // `wa.me` abre o seletor de conversa do WhatsApp com a mensagem pronta.
    // Se o WhatsApp não estiver instalado, o link fica na área de transferência
    // para o morador colar onde quiser — melhor que um erro sem saída.
    final uri = Uri.parse('https://wa.me/?text=${Uri.encodeComponent(texto)}');
    final abriu = await launchUrl(uri, mode: LaunchMode.externalApplication)
        .catchError((_) => false);

    if (!abriu) {
      await Clipboard.setData(ClipboardData(text: link));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('WhatsApp não encontrado. Link copiado para você colar.'),
      ));
    }
  }

  /// Abre a tela onde o morador confere o que o visitante mandou e completa
  /// o que só ele sabe: quando a pessoa entra, até quando fica e, para
  /// prestador, em que dias volta. A decisão (confirmar/recusar) acontece lá.
  Future<void> _abrirConfirmacao(dynamic convite) async {
    final mudou = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => ConfirmarConvitePage(convite: convite)),
    );
    if (mudou == true) _carregar();
  }

  String _cpfFormatado(dynamic cpf) {
    final d = (cpf ?? '').toString();
    if (d.length != 11) return d;
    return '${d.substring(0, 3)}.${d.substring(3, 6)}.${d.substring(6, 9)}-${d.substring(9)}';
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Convidar por link',
      showBackButton: true,
      body: _carregando
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _carregar,
              child: ListView(
                padding: const EdgeInsets.all(AppSpacing.lg),
                children: [
                  _explicacao(),
                  const SizedBox(height: AppSpacing.lg),
                  _botoesGerar(),
                  const SizedBox(height: AppSpacing.xl),
                  Text(
                    'AGUARDANDO SUA CONFIRMAÇÃO',
                    style: AppTypography.tiny(context).copyWith(
                      color: AppColors.textTertiary(context),
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  if (_pendentes.isEmpty)
                    _vazio()
                  else
                    ..._pendentes.map(_cardPendente),
                ],
              ),
            ),
    );
  }

  Widget _explicacao() {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.primary.withOpacity(0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.primary.withOpacity(0.2)),
      ),
      child: Row(children: [
        Icon(PhosphorIcons.info, color: AppColors.primary, size: 18),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Text(
            'Mande o link e a pessoa preenche nome, CPF e foto pelo celular dela. '
            'Você confirma antes de valer, e o link expira em 24 horas.',
            style: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context)),
          ),
        ),
      ]),
    );
  }

  /// Seletor de tipo + UMA ação.
  ///
  /// Antes eram dois botões lado a lado ("Visitante" e "Prestador"), que a
  /// esta altura da tela parecem filtro de listagem, não o gatilho que gera o
  /// link e abre o WhatsApp. Agora o tipo é escolha, e o botão diz o que faz.
  Widget _botoesGerar() {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(
        'TIPO DE CONVITE',
        style: AppTypography.tiny(context).copyWith(
          color: AppColors.textTertiary(context),
          fontWeight: FontWeight.w700,
          letterSpacing: 1.2,
        ),
      ),
      const SizedBox(height: AppSpacing.sm),
      Row(children: [
        Expanded(child: _opcaoTipo(rotulo: 'Visitante', icone: PhosphorIcons.userPlus, prestador: false)),
        const SizedBox(width: AppSpacing.sm),
        Expanded(child: _opcaoTipo(rotulo: 'Prestador', icone: PhosphorIcons.wrench, prestador: true)),
      ]),
      const SizedBox(height: AppSpacing.lg),
      ElevatedButton.icon(
        onPressed: _gerando ? null : () => _gerar(isPrestador: _prestador),
        icon: _gerando
            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
            : const Icon(PhosphorIcons.whatsappLogo, size: 20),
        label: Text(_gerando ? 'Gerando...' : 'Gerar e enviar no WhatsApp'),
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          minimumSize: const Size(double.infinity, 50),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
    ]);
  }

  Widget _opcaoTipo({required String rotulo, required IconData icone, required bool prestador}) {
    final marcado = _prestador == prestador;
    return GestureDetector(
      onTap: () => setState(() => _prestador = prestador),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          color: marcado ? AppColors.primary.withOpacity(0.10) : AppColors.surface(context),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: marcado ? AppColors.primary : AppColors.border(context),
            width: marcado ? 1.6 : 1,
          ),
        ),
        child: Column(children: [
          Icon(icone, size: 22, color: marcado ? AppColors.primary : AppColors.textSecondary(context)),
          const SizedBox(height: 6),
          Text(
            rotulo,
            style: AppTypography.bodyMedium(context).copyWith(
              color: marcado ? AppColors.primary : AppColors.textSecondary(context),
              fontWeight: marcado ? FontWeight.bold : FontWeight.w500,
            ),
          ),
        ]),
      ),
    );
  }

  Widget _vazio() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
      child: Column(children: [
        Icon(PhosphorIcons.tray, size: 40, color: AppColors.textTertiary(context)),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'Ninguém preencheu convite ainda.',
          style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context)),
        ),
      ]),
    );
  }

  Widget _cardPendente(dynamic c) {
    final foto = (c['foto_url'] ?? '').toString();

    return GestureDetector(
      onTap: () => _abrirConfirmacao(c),
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: foto.isNotEmpty
                ? Image.network(foto, width: 56, height: 56, fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => _semFoto())
                : _semFoto(),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${c['nome'] ?? ''}',
                  style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 2),
              Text(_cpfFormatado(c['cpf']),
                  style: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context))),
              const SizedBox(height: 4),
              Text(
                c['is_prestador'] == 1 ? 'Prestador · toque para revisar' : 'Toque para revisar',
                style: AppTypography.tiny(context).copyWith(
                    color: AppColors.primary, fontWeight: FontWeight.bold),
              ),
            ]),
          ),
          Icon(PhosphorIcons.caretRight, size: 18, color: AppColors.textTertiary(context)),
        ]),
      ),
    );
  }

  Widget _semFoto() {
    return Container(
      width: 56,
      height: 56,
      color: AppColors.bg(context),
      child: Icon(PhosphorIcons.user, color: AppColors.textTertiary(context)),
    );
  }
}
