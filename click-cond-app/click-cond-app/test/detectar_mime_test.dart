import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/utils.dart';

/// O app rotulava toda foto como `image/png` fixo no call site. O servidor
/// deriva o Content-Type do S3 e a extensão do arquivo desse rótulo — então
/// um JPEG virava `.png` com Content-Type errado.
///
/// Passou a importar de verdade quando `pickImage` ganhou maxWidth/maxHeight:
/// o picker reencoda em JPEG ao redimensionar, então o rótulo fixo mentiria
/// em 100% dos uploads.
void main() {
  group('detectarMime — identifica o formato pelos bytes, não pelo rótulo', () {
    test('JPEG (FF D8 FF) é detectado mesmo com fallback dizendo png', () {
      final jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];
      expect(detectarMime(jpeg, 'image/png'), 'image/jpeg');
    });

    test('PNG (89 50 4E 47) é detectado', () {
      final png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      expect(detectarMime(png, 'image/jpeg'), 'image/png');
    });

    test('WEBP exige RIFF no início E WEBP no offset 8', () {
      final webp = [
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00, // tamanho
        0x57, 0x45, 0x42, 0x50, // WEBP
      ];
      expect(detectarMime(webp, 'image/png'), 'image/webp');

      // RIFF sem WEBP (ex.: WAV) não pode virar image/webp.
      final riffNaoWebp = [
        0x52, 0x49, 0x46, 0x46,
        0x00, 0x00, 0x00, 0x00,
        0x57, 0x41, 0x56, 0x45, // WAVE
      ];
      expect(detectarMime(riffNaoWebp, 'application/octet-stream'),
          'application/octet-stream');
    });

    test('PDF (%PDF) é detectado — usado em comprovantes, não só imagem', () {
      final pdf = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34];
      expect(detectarMime(pdf, 'image/png'), 'application/pdf');
    });

    test('formato desconhecido cai no fallback informado', () {
      final desconhecido = [0x00, 0x01, 0x02, 0x03, 0x04];
      expect(detectarMime(desconhecido, 'image/png'), 'image/png');
    });

    test('lista curta demais não estoura — cai no fallback', () {
      // Um arquivo vazio ou truncado não pode quebrar o upload inteiro.
      expect(detectarMime([], 'image/png'), 'image/png');
      expect(detectarMime([0xFF, 0xD8], 'image/png'), 'image/png');
      expect(detectarMime([0x89, 0x50, 0x4E], 'image/png'), 'image/png');
    });
  });
}
