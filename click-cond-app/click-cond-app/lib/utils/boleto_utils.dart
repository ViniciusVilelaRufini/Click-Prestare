/// Utilidades para interpretar o que foi escaneado de um boleto/conta:
/// distingue PIX (copia-e-cola) de código de barras de boleto e converte o
/// código de barras (44 dígitos) para a LINHA DIGITÁVEL (47 banco / 48 arrecadação),
/// que é o que o morador cola no app do banco para pagar.

/// Resultado da leitura: um dos dois campos vem preenchido.
class BoletoScanResult {
  final String? linhaDigitavel;
  final String? pixCopiaCola;
  const BoletoScanResult({this.linhaDigitavel, this.pixCopiaCola});

  bool get isEmpty => (linhaDigitavel == null || linhaDigitavel!.isEmpty) &&
      (pixCopiaCola == null || pixCopiaCola!.isEmpty);
}

/// Interpreta o valor bruto lido pelo scanner (QR ou código de barras).
BoletoScanResult parseBoletoScan(String raw) {
  final v = raw.trim();
  if (v.isEmpty) return const BoletoScanResult();

  // PIX copia-e-cola (BR Code EMV): começa com "000201" ou contém o domínio do BCB.
  final lower = v.toLowerCase();
  if (v.startsWith('000201') || lower.contains('br.gov.bcb') || lower.contains('pix')) {
    return BoletoScanResult(pixCopiaCola: v);
  }

  // Só dígitos? Pode ser código de barras (44) ou já a linha digitável (47/48).
  final digits = v.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.length == v.length) {
    if (digits.length == 44) {
      return BoletoScanResult(linhaDigitavel: boletoBarcodeToLinhaDigitavel(digits));
    }
    if (digits.length == 47 || digits.length == 48) {
      return BoletoScanResult(linhaDigitavel: digits); // já é a linha digitável
    }
  }

  // Fallback: guarda como linha digitável (o morador confere/edita se precisar).
  return BoletoScanResult(linhaDigitavel: v);
}

/// Converte o código de barras (44 dígitos) na linha digitável.
/// - Boleto bancário: 47 dígitos (5 campos, DV módulo 10 por campo).
/// - Arrecadação/concessionária (energia, começa com '8'): 48 dígitos
///   (4 blocos de 11+DV; módulo 10 ou 11 conforme o dígito de valor efetivo).
String boletoBarcodeToLinhaDigitavel(String barcode) {
  if (barcode.length != 44) return barcode;

  if (barcode.startsWith('8')) {
    // Arrecadação: DV por bloco. digit[2] define o módulo (6/7 = mod10, 8/9 = mod11).
    final mod = barcode[2];
    final usaMod10 = (mod == '6' || mod == '7');
    final buffer = StringBuffer();
    for (var i = 0; i < 4; i++) {
      final bloco = barcode.substring(i * 11, i * 11 + 11);
      final dv = usaMod10 ? _mod10(bloco) : _mod11Arrecadacao(bloco);
      buffer.write(bloco);
      buffer.write(dv);
    }
    return buffer.toString(); // 48 dígitos
  }

  // Boleto bancário.
  final bancoMoeda = barcode.substring(0, 4); // banco(3)+moeda(1)
  final dvGeral = barcode.substring(4, 5); // DV geral do código de barras
  final fatorValor = barcode.substring(5, 19); // fator venc(4)+valor(10)
  final campoLivre = barcode.substring(19, 44); // 25

  final campo1raw = bancoMoeda + campoLivre.substring(0, 5); // 9
  final campo2raw = campoLivre.substring(5, 15); // 10
  final campo3raw = campoLivre.substring(15, 25); // 10

  final campo1 = campo1raw + _mod10(campo1raw).toString();
  final campo2 = campo2raw + _mod10(campo2raw).toString();
  final campo3 = campo3raw + _mod10(campo3raw).toString();

  return '$campo1$campo2$campo3$dvGeral$fatorValor'; // 47 dígitos
}

/// Formata a linha digitável para exibição (com pontos/espaços). Opcional.
int _mod10(String num) {
  var sum = 0;
  var weight = 2;
  for (var i = num.length - 1; i >= 0; i--) {
    var d = int.parse(num[i]) * weight;
    if (d > 9) d = (d ~/ 10) + (d % 10);
    sum += d;
    weight = weight == 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

int _mod11Arrecadacao(String num) {
  var sum = 0;
  var weight = 2;
  for (var i = num.length - 1; i >= 0; i--) {
    sum += int.parse(num[i]) * weight;
    weight = weight == 9 ? 2 : weight + 1;
  }
  var dv = 11 - (sum % 11);
  if (dv >= 10) dv = 0; // resto 0 (dv 11) e resto 1 (dv 10) viram 0
  return dv;
}
