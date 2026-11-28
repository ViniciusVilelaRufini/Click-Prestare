// Gera o toque do interfone no console (apps/portaria-web/public/assets/interfone/toque.wav).
// Sem dependência: WAV PCM 16 bits, 8 kHz, mono. 2 s em loop: "trim-trim" (2 × 0,4 s de 440+480 Hz) e silêncio.
// Uso: node scripts/gerar-toque-interfone.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAXA = 8000;
const DURACAO_S = 2;
const TRECHOS = [
  [0.0, 0.4],
  [0.6, 1.0],
]; // segundos com som; o resto é silêncio
const RAMPA_S = 0.01; // sobe/desce suave para não estalar

const n = TAXA * DURACAO_S;
const amostras = new Int16Array(n);
for (let i = 0; i < n; i++) {
  const t = i / TAXA;
  const trecho = TRECHOS.find(([a, b]) => t >= a && t < b);
  if (!trecho) continue;
  const [a, b] = trecho;
  const env = Math.min(1, (t - a) / RAMPA_S, (b - t) / RAMPA_S);
  const v = 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.5 * Math.sin(2 * Math.PI * 480 * t);
  amostras[i] = Math.round(v * env * 0.6 * 32767);
}

const dados = Buffer.from(amostras.buffer);
const cab = Buffer.alloc(44);
cab.write('RIFF', 0);
cab.writeUInt32LE(36 + dados.length, 4);
cab.write('WAVE', 8);
cab.write('fmt ', 12);
cab.writeUInt32LE(16, 16); // tamanho do bloco fmt
cab.writeUInt16LE(1, 20); // PCM
cab.writeUInt16LE(1, 22); // mono
cab.writeUInt32LE(TAXA, 24);
cab.writeUInt32LE(TAXA * 2, 28); // bytes por segundo
cab.writeUInt16LE(2, 32); // alinhamento
cab.writeUInt16LE(16, 34); // bits
cab.write('data', 36);
cab.writeUInt32LE(dados.length, 40);

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'apps/portaria-web/public/assets/interfone/toque.wav');
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, Buffer.concat([cab, dados]));
console.log(`toque gerado: ${destino} (${cab.length + dados.length} bytes)`);
