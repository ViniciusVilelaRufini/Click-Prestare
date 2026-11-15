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
};

/// Texto do selo, ou null quando não há selo (`a_vincular`, nulo, vazio ou
/// valor desconhecido — um estado novo da API não pode virar texto cru na tela).
String? rotuloEstadoGuarita(String? estado) {
  if (estado == null) return null;
  return _rotulos[estado.trim()];
}

/// Sinal (ponto) do selo: gravado/ativo ok, falhou perigo, o resto em andamento.
AppSignal sinalEstadoGuarita(String? estado) {
  switch (estado?.trim()) {
    case 'gravado':
    case 'ativo':
      return AppSignal.ok;
    case 'falhou':
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

/// `id` do veículo no corpo da resposta do salvar, quando vier.
int? idVeiculoDaResposta(String body) {
  try {
    final parsed = jsonDecode(body);
    if (parsed is! Map) return null;
    final id = parsed['id'] ?? (parsed['veiculo'] is Map ? parsed['veiculo']['id'] : null);
    if (id is int) return id;
    return int.tryParse(id?.toString() ?? '');
  } catch (_) {
    return null;
  }
}

String _placaNormalizada(String p) =>
    p.toUpperCase().replaceAll(RegExp('[^A-Z0-9]'), '');

/// `guarita_estado` do veículo na lista recarregada (`veiculos/get-all`),
/// achado pelo id ou, sem id, pela placa.
String? estadoGuaritaNaLista(dynamic lista, {int? id, String? placa}) {
  if (lista is! List) return null;
  if (id == null && (placa == null || placa.trim().isEmpty)) return null;
  final alvo = placa == null ? null : _placaNormalizada(placa);
  for (final e in lista) {
    if (e is! Map) continue;
    final casou = id != null
        ? e['id']?.toString() == id.toString()
        : _placaNormalizada((e['placa'] ?? '').toString()) == alvo;
    if (casou) return _texto(e['guarita_estado']);
  }
  return null;
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
