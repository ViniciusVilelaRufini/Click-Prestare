import 'package:crypto/crypto.dart';

/// Código dinâmico de acesso (o QR de "Meu acesso", que muda a cada 30 s).
///
/// Código = 'P1' + base32(corpo | mac), 28 caracteres:
///   corpo = id da credencial (uint32 BE) | contador (uint32 BE)
///   mac   = primeiros 8 bytes de HMAC-SHA256(segredo, 'P1' em ASCII | corpo)
///   contador = floor(unix_ms / 30000)
///
/// É o mesmo cálculo de `click-cond-web/apps/api/src/app/credenciais/
/// codigo-dinamico.util.ts`, com os mesmos vetores de teste
/// (test/codigo_dinamico_test.dart). Não mudar um lado sem mudar o outro.
///
/// O segredo e o código gerado nunca vão para log.

const int intervaloMs = 30000;

const String _prefixo = 'P1';
const String _alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

String gerarCodigoDinamico({
  required int id,
  required int contador,
  required List<int> segredo,
}) {
  final corpo = <int>[..._uint32(id), ..._uint32(contador)];
  final mensagem = <int>[..._prefixo.codeUnits, ...corpo];
  final mac = Hmac(sha256, segredo).convert(mensagem).bytes.sublist(0, 8);
  return _prefixo + _base32([...corpo, ...mac]);
}

int contadorDe(DateTime instante) => instante.millisecondsSinceEpoch ~/ intervaloMs;

/// Segundos até o código trocar, de 1 a 30 (no instante exato da troca, 30).
int segundosAteTrocar(DateTime instante) {
  final restanteMs = intervaloMs - (instante.millisecondsSinceEpoch % intervaloMs);
  return (restanteMs + 999) ~/ 1000;
}

List<int> segredoDeHex(String hex) {
  final limpo = hex.trim();
  if (limpo.isEmpty || limpo.length.isOdd || !RegExp(r'^[0-9a-fA-F]+$').hasMatch(limpo)) {
    // Sem o valor na mensagem: é o segredo.
    throw const FormatException('Segredo da credencial em formato inválido.');
  }
  return [
    for (var i = 0; i < limpo.length; i += 2) int.parse(limpo.substring(i, i + 2), radix: 16),
  ];
}

List<int> _uint32(int v) => [
      (v >> 24) & 0xff,
      (v >> 16) & 0xff,
      (v >> 8) & 0xff,
      v & 0xff,
    ];

/// Base32 RFC 4648 sem preenchimento; os bits que sobram no último
/// caractere são zero (16 bytes → 26 caracteres).
String _base32(List<int> bytes) {
  final saida = StringBuffer();
  var acumulado = 0;
  var bits = 0;
  for (final b in bytes) {
    acumulado = ((acumulado << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      saida.write(_alfabeto[(acumulado >> (bits - 5)) & 31]);
      bits -= 5;
    }
  }
  if (bits > 0) {
    saida.write(_alfabeto[(acumulado << (5 - bits)) & 31]);
  }
  return saida.toString();
}
