/// Uma vaga ocupada/liberada do apartamento. As vagas livres não têm registro
/// (livres = qtd_vagas - vagas ativas), então este model representa só as ocupadas.
class VagaModel {
  final int? id;
  final String tipoOcupacao; // 'proprio' | 'inquilino' | 'visitante'
  final int? idVeiculo;
  final int? idVisitante;
  final int? idMoradorBeneficiario;
  final String? placa;
  final DateTime? inicio;
  final DateTime? fim;
  final String? ocupanteNome;

  VagaModel({
    this.id,
    required this.tipoOcupacao,
    this.idVeiculo,
    this.idVisitante,
    this.idMoradorBeneficiario,
    this.placa,
    this.inicio,
    this.fim,
    this.ocupanteNome,
  });

  bool get isVisitante => tipoOcupacao == 'visitante';
  bool get isInquilino => tipoOcupacao == 'inquilino';

  static DateTime? _parseDate(dynamic v) {
    if (v == null) return null;
    return DateTime.tryParse(v.toString());
  }

  factory VagaModel.fromJson(Map<String, dynamic> json) {
    return VagaModel(
      id: json['id'],
      tipoOcupacao: (json['tipo_ocupacao'] ?? 'proprio').toString(),
      idVeiculo: json['id_veiculo'],
      idVisitante: json['id_visitante'],
      idMoradorBeneficiario: json['id_morador_beneficiario'],
      placa: json['placa']?.toString(),
      inicio: _parseDate(json['inicio']),
      fim: _parseDate(json['fim']),
      ocupanteNome: json['ocupante_nome']?.toString(),
    );
  }
}

/// Resposta de /vagas/get-all: total de vagas do apto + as ocupadas.
class VagasResumo {
  final int qtdVagas;
  final int ocupadas;
  final List<VagaModel> vagas;

  VagasResumo({required this.qtdVagas, required this.ocupadas, required this.vagas});

  int get livres => (qtdVagas - ocupadas).clamp(0, qtdVagas);

  factory VagasResumo.fromJson(Map<String, dynamic> json) {
    final raw = (json['vagas'] as List?) ?? [];
    return VagasResumo(
      qtdVagas: (json['qtd_vagas'] ?? 0) is int
          ? json['qtd_vagas'] ?? 0
          : int.tryParse('${json['qtd_vagas']}') ?? 0,
      ocupadas: (json['ocupadas'] ?? raw.length) is int
          ? json['ocupadas'] ?? raw.length
          : int.tryParse('${json['ocupadas']}') ?? raw.length,
      vagas: raw.map((e) => VagaModel.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  static VagasResumo empty() => VagasResumo(qtdVagas: 0, ocupadas: 0, vagas: []);
}

/// Item selecionável (visitante ou inquilino) para liberar uma vaga.
class BeneficiarioItem {
  final int id;
  final String nome;
  final String? doc;
  // Se o visitante tem foto cadastrada. Sem foto, o facial/portão não abre
  // (só PIN/código). Default true quando o backend não informa, pra não
  // exibir aviso falso em endpoints antigos.
  final bool temFoto;
  BeneficiarioItem({required this.id, required this.nome, this.doc, this.temFoto = true});

  factory BeneficiarioItem.fromJson(Map<String, dynamic> json) => BeneficiarioItem(
        id: json['id'],
        nome: (json['nome'] ?? '').toString(),
        doc: json['doc_identificacao']?.toString(),
        temFoto: json['tem_foto'] == null
            ? true
            : (json['tem_foto'] == true ||
                json['tem_foto'] == 1 ||
                json['tem_foto'].toString() == '1'),
      );
}
