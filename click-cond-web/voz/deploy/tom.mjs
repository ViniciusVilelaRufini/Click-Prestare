#!/usr/bin/env node
// Gera um tom senoidal em signed linear 16 bits, little-endian, 8 kHz mono —
// o formato .sln do Asterisk. Usado para o "beep" do aviso de fim de conversa.
//   node tom.mjs <saida.sln> [hz=1000] [segundos=0.2]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function gerarTom({ hz = 1000, segundos = 0.2, taxa = 8000, volume = 0.5 } = {}) {
  const amostras = Math.round(taxa * segundos);
  const buf = Buffer.alloc(amostras * 2);
  const rampa = Math.min(80, Math.floor(amostras / 4)); // 10 ms de entrada/saída, sem estalo
  for (let i = 0; i < amostras; i += 1) {
    const envelope = Math.min(1, i / rampa, (amostras - 1 - i) / rampa);
    const v = Math.round(Math.sin((2 * Math.PI * hz * i) / taxa) * 32767 * volume * envelope);
    buf.writeInt16LE(v, i * 2);
  }
  return buf;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [saida, hz = '1000', segundos = '0.2'] = process.argv.slice(2);
  if (!saida) {
    console.error('uso: tom.mjs <saida.sln> [hz] [segundos]');
    process.exit(1);
  }
  writeFileSync(saida, gerarTom({ hz: Number(hz), segundos: Number(segundos) }));
}
