class VeiculoModel {
  int? id;
  String? placa;
  String? cor;
  String? marcaModelo;
  int? idTag;
  String? tagCodigo; // código da tag vinculada (somente leitura no app)

  VeiculoModel({
    this.id,
    this.placa,
    this.cor,
    this.marcaModelo,
    this.idTag,
    this.tagCodigo,
  });

  factory VeiculoModel.fromJson(Map<String, dynamic> json) {
    return VeiculoModel(
      id: json['id'],
      placa: json['placa'],
      cor: json['cor'],
      marcaModelo: json['marca_modelo'],
      idTag: json['id_tag'],
      tagCodigo: json['tag_codigo'],
    );
  }

  /// Payload enviado ao backend (não inclui id_tag — vínculo é da portaria).
  Map<String, dynamic> toJson() {
    return {
      if (id != null) 'id': id,
      'placa': placa,
      'cor': cor,
      'marca_modelo': marcaModelo,
    };
  }
}
