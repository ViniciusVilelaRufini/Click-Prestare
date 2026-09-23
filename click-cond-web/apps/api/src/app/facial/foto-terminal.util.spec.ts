import sharp from 'sharp';
import { LIMITE_FOTO_TERMINAL, normalizarFotoParaTerminal } from './foto-terminal.util';

/**
 * Faciais Intelbras/Dahua recusam com "Bad Request" foto acima de ~600x1200
 * ou ~100 KB. A foto real que falhou em produção era JPEG 900x1600 / 121 KB,
 * e nada no caminho (portaria-web, API, agente) reduzia a imagem: todo
 * cadastro com foto de câmera ficava pendente para sempre.
 */
async function jpegComRuido(largura: number, altura: number): Promise<Buffer> {
  const pixels = Buffer.alloc(largura * altura * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 2654435761) >>> 24;
  return sharp(pixels, { raw: { width: largura, height: altura, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

describe('normalizarFotoParaTerminal', () => {
  it('reduz foto grande de câmera (900x1600) para caber no terminal', async () => {
    const original = await jpegComRuido(900, 1600);
    expect(original.length).toBeGreaterThan(LIMITE_FOTO_TERMINAL.bytes);

    const saida = Buffer.from(await normalizarFotoParaTerminal(original.toString('base64')), 'base64');
    const meta = await sharp(saida).metadata();

    expect(meta.format).toBe('jpeg');
    expect(meta.width!).toBeLessThanOrEqual(LIMITE_FOTO_TERMINAL.largura);
    expect(meta.height!).toBeLessThanOrEqual(LIMITE_FOTO_TERMINAL.altura);
    expect(saida.length).toBeLessThanOrEqual(LIMITE_FOTO_TERMINAL.bytes);
    // Mantém a proporção (rosto não pode sair esticado).
    expect(Math.abs(meta.width! / meta.height! - 900 / 1600)).toBeLessThan(0.01);
  });

  it('converte PNG para JPEG', async () => {
    const png = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#888' } }).png().toBuffer();
    const saida = Buffer.from(await normalizarFotoParaTerminal(png.toString('base64')), 'base64');
    expect((await sharp(saida).metadata()).format).toBe('jpeg');
  });

  it('foto que já cabe no terminal segue intacta', async () => {
    const pequena = (await sharp({ create: { width: 400, height: 600, channels: 3, background: '#777' } }).jpeg().toBuffer()).toString('base64');
    await expect(normalizarFotoParaTerminal(pequena)).resolves.toBe(pequena);
  });

  it('conteúdo que não é imagem volta sem alteração (não derruba a sincronização)', async () => {
    await expect(normalizarFotoParaTerminal('nao-e-imagem')).resolves.toBe('nao-e-imagem');
  });
});

describe('FacialService.fetchPhotoAsBase64 — toda foto enviada ao terminal passa pela normalização', () => {
  it('data URL de foto grande sai reduzida', async () => {
    const { FacialService } = await import('./facial.service');
    const grande = await jpegComRuido(900, 1600);
    const svc = Object.create(FacialService.prototype);
    const saida = Buffer.from(await svc.fetchPhotoAsBase64(`data:image/jpeg;base64,${grande.toString('base64')}`), 'base64');
    const meta = await sharp(saida).metadata();
    expect(meta.width!).toBeLessThanOrEqual(LIMITE_FOTO_TERMINAL.largura);
    expect(saida.length).toBeLessThanOrEqual(LIMITE_FOTO_TERMINAL.bytes);
  });
});

describe('pacote de deploy (Elastic Beanstalk)', () => {
  it('instala o sharp na mesma versão do projeto — sem ele a foto vai sem reduzir', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const raiz = join(__dirname, '..', '..', '..', '..', '..');
    const versao = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).dependencies.sharp;
    const bundle = readFileSync(join(raiz, 'scripts', 'migration', 'bundle-eb.mjs'), 'utf8');
    expect(versao).toBeTruthy();
    expect(bundle).toContain(`"sharp": "${versao}"`);
  });
});
