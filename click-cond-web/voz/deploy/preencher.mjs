#!/usr/bin/env node
// Preenche modelos de configuração com valores do ambiente, sem passar
// segredos pela linha de comando nem por sed.
//
//   node preencher.mjs <modelo> <saida>        troca __NOME__ por process.env.NOME
//   node preencher.mjs --env <saida> NOME...   grava NOME='valor' (EnvironmentFile do systemd)
//
// Falha (código 1) se faltar variável ou se o valor tiver caractere que
// quebraria o .conf do Asterisk/coturn ou o EnvironmentFile.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VALOR_SEGURO = /^[\x21-\x7e]+$/; // ASCII visível, sem espaço nem quebra de linha
const PROIBIDOS = /[;'"\\$`#]/; // comentário do .conf, aspas e expansões

export function validarValor(nome, valor) {
  if (valor === undefined || valor === null || valor === '') throw new Error(`variável ${nome} ausente`);
  if (!VALOR_SEGURO.test(valor) || PROIBIDOS.test(valor)) throw new Error(`variável ${nome} tem caractere não permitido`);
  return valor;
}

export function preencherModelo(texto, env) {
  return texto.replace(/__([A-Z][A-Z0-9_]*)__/g, (_m, nome) => validarValor(nome, env[nome]));
}

export function arquivoEnv(nomes, env) {
  return nomes.map((n) => `${n}='${validarValor(n, env[n])}'`).join('\n') + '\n';
}

function principal(argv) {
  if (argv[0] === '--env') {
    const [, saida, ...nomes] = argv;
    if (!saida || !nomes.length) throw new Error('uso: preencher.mjs --env <saida> NOME...');
    writeFileSync(saida, arquivoEnv(nomes, process.env), { mode: 0o600 });
    return;
  }
  const [modelo, saida] = argv;
  if (!modelo || !saida) throw new Error('uso: preencher.mjs <modelo> <saida>');
  writeFileSync(saida, preencherModelo(readFileSync(modelo, 'utf8'), process.env), { mode: 0o640 });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    principal(process.argv.slice(2));
  } catch (e) {
    console.error(`[preencher] ${e.message}`);
    process.exit(1);
  }
}
