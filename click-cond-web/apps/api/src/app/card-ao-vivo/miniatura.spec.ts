import sharp from 'sharp';
import { MAX_FOTO_BASE64, miniaturaBase64 } from './miniatura';

describe('miniatura da foto do card ao vivo', () => {
  it('foto grande vira JPEG quadrado pequeno que cabe no push (4 KB)', async () => {
    // Ruído: o pior caso para a compressão.
    const lado = 1200;
    const bruto = Buffer.alloc(lado * 900 * 3);
    for (let i = 0; i < bruto.length; i++) bruto[i] = (i * 7919) % 251;
    const foto = await sharp(bruto, { raw: { width: lado, height: 900, channels: 3 } }).jpeg().toBuffer();

    const b64 = await miniaturaBase64(foto);
    expect(b64).not.toBeNull();
    expect(b64!.length).toBeLessThanOrEqual(MAX_FOTO_BASE64);
    const meta = await sharp(Buffer.from(b64!, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(meta.height);
    expect(meta.width!).toBeLessThanOrEqual(96);
  });

  it('bytes que não são imagem: null, sem lançar', async () => {
    expect(await miniaturaBase64(Buffer.from('não é imagem'))).toBeNull();
  });
});
