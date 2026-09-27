enum DeliveryModoEntrega { unidade, portaria }

class DeliveryUnit {
  final int id;
  final String bloco;
  final String apto;

  const DeliveryUnit(
      {required this.id, required this.bloco, required this.apto});

  factory DeliveryUnit.fromJson(Map<String, dynamic> json) => DeliveryUnit(
        id: json['id'] is num
            ? (json['id'] as num).toInt()
            : int.tryParse(json['id']?.toString() ?? '') ?? 0,
        bloco: json['bloco']?.toString().trim() ?? '',
        apto: json['apto']?.toString().trim() ?? '',
      );

  String get label =>
      bloco.isEmpty ? 'Unidade $apto' : 'Bloco $bloco · Unidade $apto';
}

extension DeliveryModoEntregaApi on DeliveryModoEntrega {
  String get apiValue =>
      this == DeliveryModoEntrega.portaria ? 'PORTARIA' : 'UNIDADE';

  String get label => this == DeliveryModoEntrega.portaria
      ? 'Retirada na portaria'
      : 'Entrega na unidade';
}

class DeliveryDraft {
  final String? estabelecimento;
  final String? previsaoEm;
  final String? observacaoMorador;
  final String? nomeEntregador;
  final String? telefoneEntregador;
  final DeliveryModoEntrega modoEntrega;

  const DeliveryDraft({
    this.estabelecimento,
    this.previsaoEm,
    this.observacaoMorador,
    this.nomeEntregador,
    this.telefoneEntregador,
    this.modoEntrega = DeliveryModoEntrega.unidade,
  });

  Map<String, dynamic> toCreateJson(
      {required int idCondominio, required int idApartamento}) {
    return {
      'id_condominio': idCondominio,
      'id_apartamento': idApartamento,
      if (_text(estabelecimento) != null)
        'estabelecimento': _text(estabelecimento),
      if (_text(previsaoEm) != null) 'previsao_em': _text(previsaoEm),
      if (_text(observacaoMorador) != null)
        'observacao_morador': _text(observacaoMorador),
      if (_text(nomeEntregador) != null)
        'nome_entregador': _text(nomeEntregador),
      if (_text(telefoneEntregador) != null)
        'telefone_entregador': _text(telefoneEntregador),
      'modo_entrega': modoEntrega.apiValue,
    };
  }

  static String? _text(String? value) {
    final text = value?.trim();
    return text == null || text.isEmpty ? null : text;
  }
}

class DeliveryEvent {
  final String statusNovo;
  final String? mensagem;
  final String? createdAt;

  const DeliveryEvent(
      {required this.statusNovo, this.mensagem, this.createdAt});

  factory DeliveryEvent.fromJson(Map<String, dynamic> json) {
    return DeliveryEvent(
      statusNovo: json['status_novo']?.toString() ?? '',
      mensagem: json['mensagem']?.toString(),
      createdAt: json['created_at']?.toString(),
    );
  }
}

/// Representação segura para a experiência do morador.
///
/// A API inclui o entregador para uso da portaria, mas o app não materializa
/// documento, bloqueio, motivo ou identificadores desse cadastro.
class DeliveryModel {
  final int? id;
  final int? idCondominio;
  final int? idApartamento;
  final String? estabelecimento;
  final String? previsaoEm;
  final String? observacaoMorador;
  final String? modoEntrega;
  final String status;
  final String? motivo;
  final String? createdAt;
  final List<DeliveryEvent> eventos;

  const DeliveryModel({
    this.id,
    this.idCondominio,
    this.idApartamento,
    this.estabelecimento,
    this.previsaoEm,
    this.observacaoMorador,
    this.modoEntrega,
    this.status = 'AGENDADA',
    this.motivo,
    this.createdAt,
    this.eventos = const [],
  });

  factory DeliveryModel.fromJson(Map<String, dynamic> json) {
    final rawEvents = json['eventos'];
    return DeliveryModel(
      id: _asInt(json['id']),
      idCondominio: _asInt(json['id_condominio']),
      idApartamento: _asInt(json['id_apartamento']),
      estabelecimento: json['estabelecimento']?.toString(),
      previsaoEm: json['previsao_em']?.toString(),
      observacaoMorador: json['observacao_morador']?.toString(),
      modoEntrega: json['modo_entrega']?.toString(),
      status: json['status']?.toString() ?? 'AGENDADA',
      motivo: json['motivo']?.toString(),
      createdAt: json['created_at']?.toString(),
      eventos: rawEvents is List
          ? rawEvents
              .whereType<Map>()
              .map((event) =>
                  DeliveryEvent.fromJson(Map<String, dynamic>.from(event)))
              .toList()
          : const [],
    );
  }

  bool get canCancel => status == 'AGENDADA';

  String get statusLabel => deliveryStatusLabel(status);

  String get modoEntregaLabel =>
      modoEntrega == 'PORTARIA' ? 'Retirada na portaria' : 'Entrega na unidade';

  Map<String, dynamic> toResidentJson() {
    return {
      if (id != null) 'id': id,
      'status': status,
      if (_nonBlank(estabelecimento) != null)
        'estabelecimento': estabelecimento,
      if (_nonBlank(previsaoEm) != null) 'previsao_em': previsaoEm,
      if (_nonBlank(observacaoMorador) != null)
        'observacao_morador': observacaoMorador,
      if (_nonBlank(modoEntrega) != null) 'modo_entrega': modoEntrega,
      if (_nonBlank(motivo) != null) 'motivo': motivo,
    };
  }

  static int? _asInt(dynamic value) =>
      value is num ? value.toInt() : int.tryParse(value?.toString() ?? '');

  static String? _nonBlank(String? value) =>
      value?.trim().isEmpty ?? true ? null : value;
}

String deliveryStatusLabel(String status) {
  switch (status) {
    case 'CHEGOU':
      return 'Entregador chegou';
    case 'AGUARDANDO_AUTORIZACAO':
      return 'Aguardando autorização';
    case 'AUTORIZADA':
      return 'Entrega autorizada';
    case 'RETIRADA_NA_PORTARIA':
      return 'Retirada na portaria';
    case 'CONCLUIDA':
      return 'Entrega concluída';
    case 'CANCELADA':
      return 'Aviso cancelado';
    case 'RECUSADA':
      return 'Entrega recusada';
    default:
      return 'Aviso agendado';
  }
}
