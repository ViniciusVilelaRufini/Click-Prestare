import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'package:click/theme/app_colors.dart';

/// Utilidades para interpretar o que foi escaneado de um boleto/conta:
/// - Distingue PIX (copia-e-cola) de código de barras de boleto
/// - Converte código de barras (44 dígitos) para LINHA DIGITÁVEL (47 banco / 48 arrecadação)
/// - Extrai automaticamente VALOR e DATA DE VENCIMENTO quando codificados no código
/// - Identifica o banco emissor ou tipo de concessionária (Água, Luz, Gás, etc.)

/// Resultado da leitura do scanner.
class BoletoScanResult {
  final String? linhaDigitavel;
  final String? pixCopiaCola;
  final double? valor;
  final String? valorFormatado;
  final String? vencimentoFormatado;
  final String? bancoOuTipo;

  const BoletoScanResult({
    this.linhaDigitavel,
    this.pixCopiaCola,
    this.valor,
    this.valorFormatado,
    this.vencimentoFormatado,
    this.bancoOuTipo,
  });

  bool get isEmpty =>
      (linhaDigitavel == null || linhaDigitavel!.isEmpty) &&
      (pixCopiaCola == null || pixCopiaCola!.isEmpty);
}

/// Mapeia o código do banco compensador para o nome do banco.
String _nomeBanco(String codigo) {
  switch (codigo) {
    case '001':
      return 'Banco do Brasil';
    case '033':
      return 'Santander';
    case '104':
      return 'Caixa Econômica';
    case '237':
      return 'Bradesco';
    case '341':
      return 'Itaú';
    case '748':
      return 'Sicredi';
    case '756':
      return 'Sicoob';
    case '077':
      return 'Banco Inter';
    case '260':
      return 'Nubank';
    case '422':
      return 'Banco Safra';
    case '041':
      return 'Banrisul';
    case '212':
      return 'Banco Original';
    case '655':
      return 'Banco Neon';
    case '389':
      return 'Mercantil do Brasil';
    case '070':
      return 'BRB';
    case '136':
      return 'Unicred';
    default:
      return 'Boleto Bancário';
  }
}

/// Mapeia o segmento da concessionária.
String _tipoArrecadacao(String digitoSegmento) {
  switch (digitoSegmento) {
    case '1':
      return 'Prefeitura / IPTU';
    case '2':
      return 'Água e Saneamento';
    case '3':
      return 'Energia Elétrica / Gás';
    case '4':
      return 'Telefonia / Internet';
    case '5':
      return 'Órgão Governamental';
    default:
      return 'Concessionária';
  }
}

/// Calcula a data de vencimento a partir do fator de vencimento FEBRABAN.
String? _calcularVencimento(int fator) {
  if (fator < 1000 || fator > 9999) return null;

  // Base histórica FEBRABAN: 07/10/1997 (atingiu 9999 em 21/02/2025)
  final base1997 = DateTime(1997, 10, 7);
  final data1997 = base1997.add(Duration(days: fator));

  // Novo ciclo FEBRABAN (a partir de 22/02/2025, onde fator 1000 = 22/02/2025)
  final base2025 = DateTime(2025, 2, 22);
  final data2025 = base2025.add(Duration(days: fator - 1000));

  DateTime dataFinal;
  if (data1997.isBefore(DateTime(2024, 1, 1))) {
    dataFinal = data2025;
  } else {
    dataFinal = data1997;
  }

  final dia = dataFinal.day.toString().padLeft(2, '0');
  final mes = dataFinal.month.toString().padLeft(2, '0');
  final ano = dataFinal.year.toString();
  return '$dia/$mes/$ano';
}

/// Interpreta o valor bruto lido pelo scanner (QR ou código de barras).
BoletoScanResult parseBoletoScan(String raw) {
  final v = raw.trim();
  if (v.isEmpty) return const BoletoScanResult();

  // 1. PIX copia-e-cola (BR Code EMV): começa com "000201" ou contém "br.gov.bcb" / "pix"
  final lower = v.toLowerCase();
  if (v.startsWith('000201') || lower.contains('br.gov.bcb') || lower.contains('pix')) {
    double? valorPix;
    String? valorFmt;
    // Tenta extrair o valor da tag EMV 54 (Ex: 5405120.00)
    final matchValor = RegExp(r'54(\d{2})([0-9.]+)').firstMatch(v);
    if (matchValor != null) {
      final len = int.tryParse(matchValor.group(1) ?? '') ?? 0;
      final rawNum = matchValor.group(2) ?? '';
      if (len > 0 && rawNum.length >= len) {
        final numStr = rawNum.substring(0, len);
        final parsedNum = double.tryParse(numStr);
        if (parsedNum != null && parsedNum > 0) {
          valorPix = parsedNum;
          valorFmt = parsedNum.toStringAsFixed(2).replaceAll('.', ',');
        }
      }
    }
    return BoletoScanResult(
      pixCopiaCola: v,
      valor: valorPix,
      valorFormatado: valorFmt,
      bancoOuTipo: 'Pix',
    );
  }

  // Remove espaços, pontos, traços e quebras de linha para analisar apenas os dígitos
  final digits = v.replaceAll(RegExp(r'[^0-9]'), '');

  // 2. Código de barras com 44 dígitos
  if (digits.length == 44) {
    final linha = boletoBarcodeToLinhaDigitavel(digits);

    if (digits.startsWith('8')) {
      // Concessionária / Arrecadação
      final segmento = digits.length > 1 ? digits[1] : '0';
      final valorCentavos = int.tryParse(digits.substring(4, 15)) ?? 0;
      double? val;
      String? valFmt;
      if (valorCentavos > 0) {
        val = valorCentavos / 100.0;
        valFmt = val.toStringAsFixed(2).replaceAll('.', ',');
      }
      return BoletoScanResult(
        linhaDigitavel: linha,
        valor: val,
        valorFormatado: valFmt,
        bancoOuTipo: _tipoArrecadacao(segmento),
      );
    } else {
      // Boleto bancário
      final banco = digits.substring(0, 3);
      final fatorVenc = int.tryParse(digits.substring(5, 9)) ?? 0;
      final valorCentavos = int.tryParse(digits.substring(9, 19)) ?? 0;

      double? val;
      String? valFmt;
      if (valorCentavos > 0) {
        val = valorCentavos / 100.0;
        valFmt = val.toStringAsFixed(2).replaceAll('.', ',');
      }
      final vencFmt = _calcularVencimento(fatorVenc);

      return BoletoScanResult(
        linhaDigitavel: linha,
        valor: val,
        valorFormatado: valFmt,
        vencimentoFormatado: vencFmt,
        bancoOuTipo: _nomeBanco(banco),
      );
    }
  }

  // 3. Linha digitável bancária com 47 dígitos
  if (digits.length == 47) {
    final banco = digits.substring(0, 3);
    final fatorVenc = int.tryParse(digits.substring(33, 37)) ?? 0;
    final valorCentavos = int.tryParse(digits.substring(37, 47)) ?? 0;

    double? val;
    String? valFmt;
    if (valorCentavos > 0) {
      val = valorCentavos / 100.0;
      valFmt = val.toStringAsFixed(2).replaceAll('.', ',');
    }
    final vencFmt = _calcularVencimento(fatorVenc);

    return BoletoScanResult(
      linhaDigitavel: digits,
      valor: val,
      valorFormatado: valFmt,
      vencimentoFormatado: vencFmt,
      bancoOuTipo: _nomeBanco(banco),
    );
  }

  // 4. Linha digitável de arrecadação com 48 dígitos (começa com 8)
  if (digits.length == 48 && digits.startsWith('8')) {
    final segmento = digits.length > 1 ? digits[1] : '0';
    // Bloco 1 (0..11) tem dígitos 4..10 de valor; Bloco 2 (12..23) tem dígitos 12..15
    final valorStr = digits.substring(4, 11) + digits.substring(12, 16);
    final valorCentavos = int.tryParse(valorStr) ?? 0;

    double? val;
    String? valFmt;
    if (valorCentavos > 0) {
      val = valorCentavos / 100.0;
      valFmt = val.toStringAsFixed(2).replaceAll('.', ',');
    }

    return BoletoScanResult(
      linhaDigitavel: digits,
      valor: val,
      valorFormatado: valFmt,
      bancoOuTipo: _tipoArrecadacao(segmento),
    );
  }

  // Fallback: se tiver pelo menos 20 caracteres ou dígitos, retorna como linha digitável
  return BoletoScanResult(
    linhaDigitavel: digits.isNotEmpty ? digits : v,
    bancoOuTipo: 'Boleto',
  );
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

/// Formata a linha digitável com pontos e espaços para exibição amigável.
String formatarLinhaDigitavelExibicao(String linha) {
  final digits = linha.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.length == 47) {
    // AAABC.CCCCX DDDDD.DDDDDY EEEEE.EEEEEZ K UUUUVVVVVVVVVV
    return '${digits.substring(0, 5)}.${digits.substring(5, 10)} '
        '${digits.substring(10, 15)}.${digits.substring(15, 21)} '
        '${digits.substring(21, 26)}.${digits.substring(26, 32)} '
        '${digits.substring(32, 33)} '
        '${digits.substring(33, 47)}';
  }
  if (digits.length == 48) {
    // AAAAAAAAAAA X BBBBBBBBBBB Y CCCCCCCCCCC Z DDDDDDDDDDD W
    return '${digits.substring(0, 12)} '
        '${digits.substring(12, 24)} '
        '${digits.substring(24, 36)} '
        '${digits.substring(36, 48)}';
  }
  return linha;
}

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

/// Extrai a linha digitável de boletos online (ex: Superlógica) acessando a página simplificada.
Future<String?> extrairLinhaDigitavelDeUrl(String urlBoleto) async {
  if (urlBoleto.isEmpty) return null;
  final miniUrl = urlBoleto.replaceAll('-FaturaHtml-flSegundaVia', '-MiniHtml-flSegundaVia');
  try {
    final response = await http.get(Uri.parse(miniUrl)).timeout(const Duration(seconds: 5));
    if (response.statusCode == 200) {
      final html = response.body;
      final m = RegExp(r'[?&]l=([0-9.\s]+)(?:&|$)').firstMatch(html);
      if (m != null && m.group(1) != null) {
        return Uri.decodeComponent(m.group(1)!).trim();
      }
      final m2 = RegExp(r'\d{5}\.\d{5}\s+\d{5}\.\d{6}\s+\d{5}\.\d{6}\s+\d\s+\d{14}').firstMatch(html);
      if (m2 != null) return m2.group(0)!.trim();
    }
  } catch (_) {}
  return null;
}

/// Ação reutilizável para copiar o código de barras / linha digitável para a área de transferência.
Future<void> copiarLinhaDigitavelOuExtrair(BuildContext context, Map item, {VoidCallback? onExtracted}) async {
  final linha = (item['linha_digitavel'] ?? '').toString().trim();
  if (linha.isNotEmpty) {
    Clipboard.setData(ClipboardData(text: linha));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text("Código do boleto copiado! Cole no app do seu banco para pagar."),
        backgroundColor: Colors.green,
        duration: Duration(seconds: 3),
      ),
    );
    return;
  }

  final urlBoleto = (item['url_boleto'] ?? '').toString().trim();
  if (urlBoleto.isNotEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text("Buscando código do boleto..."),
        backgroundColor: AppColors.textSecondary(context),
        duration: const Duration(seconds: 1),
      ),
    );

    final extraida = await extrairLinhaDigitavelDeUrl(urlBoleto);
    if (extraida != null && extraida.isNotEmpty) {
      item['linha_digitavel'] = extraida;
      Clipboard.setData(ClipboardData(text: extraida));
      onExtracted?.call();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text("Código do boleto copiado! Cole no app do seu banco para pagar."),
            backgroundColor: Colors.green,
            duration: Duration(seconds: 3),
          ),
        );
      }
    } else {
      // Fallback: abre a página do boleto
      launchUrl(Uri.parse(urlBoleto));
    }
  }
}
