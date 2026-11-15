class VeiculoModel {
  int? id;
  String? placa;
  String? cor;
  String? marcaModelo;
  int? idTag;
  String? tagCodigo; // código da tag vinculada (somente leitura no app)
  // Estado da tag no Módulo Guarita (somente leitura; ausente sem Guarita).
  String? guaritaEstado;
  String? guaritaErro;

  VeiculoModel({
    this.id,
    this.placa,
    this.cor,
    this.marcaModelo,
    this.idTag,
    this.tagCodigo,
    this.guaritaEstado,
    this.guaritaErro,
  });

  factory VeiculoModel.fromJson(Map<String, dynamic> json) {
    return VeiculoModel(
      id: json['id'],
      placa: json['placa'],
      cor: json['cor'],
      marcaModelo: json['marca_modelo'],
      idTag: json['id_tag'],
      tagCodigo: json['tag_codigo'],
      guaritaEstado: json['guarita_estado']?.toString(),
      guaritaErro: json['guarita_erro']?.toString(),
    );
  }

  /// Payload enviado ao backend. `tag_codigo` só é incluído quando o campo foi
  /// enviado pela tela — o backend só mexe no vínculo da tag se a chave existir,
  /// então edições que não tocam a tag não a desvinculam.
  Map<String, dynamic> toJson({bool incluirTag = false}) {
    return {
      if (id != null) 'id': id,
      'placa': placa,
      'cor': cor,
      'marca_modelo': marcaModelo,
      if (incluirTag) 'tag_codigo': tagCodigo ?? '',
    };
  }
}
