import 'dart:convert';

import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_tag.dart';
import 'package:flutter/material.dart';

/// Estado da tag do veículo no Módulo Guarita (campo opcional `guarita_estado`
/// das rotas `veiculos/*`). Ausente ou nulo = condomínio sem Guarita = sem selo.
const _rotulos = <String, String>{
  'aguardando_aprovacao': 'Aguardando aprovação da portaria',
  'pendente': 'Enviando ao portão',
  'gravado': 'Gravado no portão',
  'ativo': 'Ativo nos portões',
  'falhou': 'Não foi possível gravar no portão',
  'removendo': 'Removendo do portão',
  'recusada': 'Recusada pela portaria',
};

/// Texto do selo, ou null quando não há selo (`a_vincular`, nulo, vazio ou
/// valor desconhecido — um estado novo da API não pode virar texto cru na tela).
String? rotuloEstadoGuarita(String? estado) {
  if (estado == null) return null;
  return _rotulos[estado.trim()];
}

/// Sinal (ponto) do selo: gravado/ativo ok, falhou/recusada perigo, o resto em
/// andamento.
AppSignal sinalEstadoGuarita(String? estado) {
  switch (estado?.trim()) {
    case 'gravado':
    case 'ativo':
      return AppSignal.ok;
    case 'falhou':
    case 'recusada':
      return AppSignal.danger;
    default:
      return AppSignal.warn;
  }
}

const avisoTagAguardandoAprovacao =
    'Tag enviada. Ela começa a valer no portão depois que a portaria aprovar.';

/// Mensagem do diálogo de sucesso ao salvar o veículo.
String mensagemSucessoVeiculo({required bool isEdit, required String? estado}) {
  final base = isEdit ? 'Veículo atualizado!' : 'Veículo cadastrado!';
  if (estado?.trim() == 'aguardando_aprovacao') {
    return '$base\n\n$avisoTagAguardandoAprovacao';
  }
  return base;
}

String? _texto(dynamic v) {
  if (v == null) return null;
  final s = v.toString().trim();
  return s.isEmpty ? null : s;
}

/// `guarita_estado` do corpo da resposta do salvar (no topo ou em `veiculo`).
String? estadoGuaritaDaResposta(String body) {
  try {
    final parsed = jsonDecode(body);
    if (parsed is! Map) return null;
    final topo = _texto(parsed['guarita_estado']);
    if (topo != null) return topo;
    final veiculo = parsed['veiculo'];
    if (veiculo is Map) return _texto(veiculo['guarita_estado']);
    return null;
  } catch (_) {
    return null;
  }
}

/// Selo do estado no Guarita (e, em `falhou`, o motivo). Sem estado com
/// rótulo não desenha nada, e a tela fica como era antes do Guarita.
class SeloEstadoGuarita extends StatelessWidget {
  final String? estado;
  final String? erro;

  const SeloEstadoGuarita({super.key, required this.estado, this.erro});

  @override
  Widget build(BuildContext context) {
    final rotulo = rotuloEstadoGuarita(estado);
    if (rotulo == null) return const SizedBox.shrink();
    final motivo = estado?.trim() == 'falhou' ? _texto(erro) : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // O AppTag não quebra linha; em tela estreita ele encolhe em vez de
        // estourar a largura do card.
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: AppTag(label: rotulo, signal: sinalEstadoGuarita(estado)),
        ),
        if (motivo != null) ...[
          const SizedBox(height: 4),
          Text(
            motivo,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: AppTypography.tiny(context)
                .copyWith(color: AppColors.textSecondary(context)),
          ),
        ],
      ],
    );
  }
}
