class EncomendaModel {
  int? id;
  String? descricao;
  String? destinatarioApto;
  String? destinatarioBloco;
  String? recebidoDe;
  String? recebidoEm;
  String? retiradoEm;
  String? retiradoPor;
  String? status;
  String? fotoVolume;
  int? idCondominio;
  String? condominioNome;
  String? retiradoFoto;
  String? retiradoAssinatura;
  String? codigoRastreio;

  EncomendaModel({
    this.id,
    this.descricao,
    this.destinatarioApto,
    this.destinatarioBloco,
    this.recebidoDe,
    this.recebidoEm,
    this.retiradoEm,
    this.retiradoPor,
    this.status,
    this.fotoVolume,
    this.idCondominio,
    this.condominioNome,
    this.retiradoFoto,
    this.retiradoAssinatura,
    this.codigoRastreio,
  });

  factory EncomendaModel.fromJson(Map<String, dynamic> json) {
    return EncomendaModel(
      id: json['id'],
      descricao: json['descricao'],
      destinatarioApto: json['destinatario_apto'],
      destinatarioBloco: json['destinatario_bloco'],
      recebidoDe: json['recebido_de'],
      recebidoEm: json['recebido_em'],
      retiradoEm: json['retirado_em'],
      retiradoPor: json['retirado_por'],
      status: json['status'],
      fotoVolume: json['foto_volume'],
      idCondominio: json['id_condominio'],
      condominioNome: json['condominio_nome'],
      retiradoFoto: json['retirado_foto'],
      retiradoAssinatura: json['retirado_assinatura'],
      codigoRastreio: json['codigo_rastreio'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'descricao': descricao,
      'destinatario_apto': destinatarioApto,
      'destinatario_bloco': destinatarioBloco,
      'recebido_de': recebidoDe,
      'recebido_em': recebidoEm,
      'retirado_em': retiradoEm,
      'retirado_por': retiradoPor,
      'status': status,
      'foto_volume': fotoVolume,
      'id_condominio': idCondominio,
      'condominio_nome': condominioNome,
      'retirado_foto': retiradoFoto,
      'retirado_assinatura': retiradoAssinatura,
      'codigo_rastreio': codigoRastreio,
    };
  }
}
