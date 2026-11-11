'use strict';

/**
 * Scripts .bat/.cmd do instalador: o filtro do `tasklist` é IMAGENAME (um N
 * só). Com "IMAGENNAME" o tasklist recusa o filtro e a checagem "o agente
 * está rodando?" falha sempre.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

test('scripts .bat/.cmd/.vbs: nenhum usa o filtro inexistente IMAGENNAME do tasklist', () => {
  const scripts = fs.readdirSync(RAIZ).filter((f) => /\.(bat|cmd|vbs|ps1)$/i.test(f));
  assert.ok(scripts.includes('install-windows.bat') && scripts.includes('status-agent.cmd'));
  for (const nome of scripts) {
    const texto = fs.readFileSync(path.join(RAIZ, nome), 'utf8');
    assert.ok(!/IMAGENNAME/i.test(texto), `${nome} ainda usa IMAGENNAME`);
  }
});

test('install-windows.bat (1 ponto) e status-agent.cmd (1 ponto) filtram por IMAGENAME', () => {
  // Os dois perderam um ponto: achar o node do agente deixou de usar tasklist
  // (ele não mostra a linha de comando — ver os testes abaixo).
  for (const [nome, pontos] of [['install-windows.bat', 1], ['status-agent.cmd', 1]]) {
    const texto = fs.readFileSync(path.join(RAIZ, nome), 'utf8');
    assert.equal((texto.match(/\/FI "IMAGENAME eq /g) || []).length, pontos, nome);
  }
});

test('install-windows.bat: encerra o node antigo do agente pela LINHA DE COMANDO, nunca qualquer node.exe', () => {
  const texto = fs.readFileSync(path.join(RAIZ, 'install-windows.bat'), 'utf8');
  // O laço antigo (`tasklist /V /FO LIST` + tokens=2) nunca casava: o tasklist
  // não mostra a linha de comando, e o token 2 de uma linha "Rótulo: valor"
  // não é o PID — o taskkill falhava calado.
  assert.ok(!/tasklist[^\r\n]*\/FO LIST/i.test(texto), 'sobrou o laço tasklist /FO LIST');
  assert.ok(!/taskkill[^\r\n]*\/IM node\.exe/i.test(texto), 'nunca matar node.exe pelo nome da imagem');
  const linhas = texto.split(/\r?\n/).filter((l) => /Stop-Process/.test(l));
  assert.equal(linhas.length, 1, 'uma única linha encerra o node do agente');
  const linha = linhas[0];
  assert.match(linha, /^powershell -NoProfile /);
  assert.match(linha, /Get-CimInstance Win32_Process/);
  // As DUAS condições juntas: é node.exe E a linha de comando tem o bundle do agente.
  assert.match(linha, /\$_\.Name -eq 'node\.exe' -and \$_\.CommandLine -like '\*click-agent\.cjs\*'/);
  assert.match(linha, /Stop-Process -Id \$_\.ProcessId -Force/);
  // Dentro de um .bat, `%` e aspas duplas internas quebrariam o comando.
  const comando = linha.slice(linha.indexOf('"') + 1, linha.lastIndexOf('"'));
  assert.ok(!/["%]/.test(comando), 'o comando não pode ter aspas duplas internas nem %');
  // Continua antes do passo que sobrescreve os arquivos.
  assert.ok(texto.indexOf('Stop-Process') < texto.indexOf('=== 2/4'), 'tem de vir antes do passo 2/4');
});

test('status-agent.cmd (M1): acha o node do agente pela LINHA DE COMANDO (mesma consulta do install), só LISTANDO', () => {
  const texto = fs.readFileSync(path.join(RAIZ, 'status-agent.cmd'), 'utf8');
  // `tasklist /V` não mostra a linha de comando: o findstr por click-agent.cjs nunca casava.
  assert.ok(!/tasklist[^\r\n]*\/V/i.test(texto), 'sobrou o tasklist /V (não enxerga a linha de comando)');
  assert.ok(!/tasklist[^\r\n]*node\.exe/i.test(texto), 'sobrou a busca do node pelo tasklist');
  const linhas = texto.split(/\r?\n/).filter((l) => /Get-CimInstance/.test(l));
  assert.equal(linhas.length, 1, 'uma única linha consulta os processos');
  const linha = linhas[0].trim();
  assert.match(linha, /^powershell -NoProfile -Command "/);
  // A MESMA consulta do install-windows.bat (as duas condições juntas).
  const filtro = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*click-agent.cjs*' }";
  assert.ok(linha.includes(filtro), 'filtro diferente do install-windows.bat');
  assert.ok(fs.readFileSync(path.join(RAIZ, 'install-windows.bat'), 'utf8').includes(filtro));
  // Script de STATUS: nunca encerra nada.
  assert.ok(!/Stop-Process|taskkill|Terminate|Remove-/i.test(texto), 'status-agent.cmd não pode encerrar processo');
  // Dentro de um .cmd, `%` e aspas duplas internas quebrariam o comando.
  const comando = linha.slice(linha.indexOf('"') + 1, linha.lastIndexOf('"'));
  assert.ok(!/["%]/.test(comando), 'o comando não pode ter aspas duplas internas nem %');
  // Continua avisando quando não há nada rodando.
  assert.match(texto, /if errorlevel 1 echo\s+\^\(nenhum agente rodando\^\)/);
});

test('status-agent.cmd (M1): o padrão da "última versão no log" casa com a linha que o agente realmente grava ("versão", com til)', () => {
  const texto = fs.readFileSync(path.join(RAIZ, 'status-agent.cmd'), 'utf8');
  const m = /Select-String -Path '[^']*agent-service\.log' -Pattern '([^']+)'/.exec(texto);
  assert.ok(m, 'não achei o Select-String do log');
  const padrao = new RegExp(m[1], 'i'); // Select-String: regex, sem diferenciar maiúsculas
  // A linha que o agente grava (ver main() em src/index.js) — conferida contra a fonte.
  const fonte = fs.readFileSync(path.join(RAIZ, 'src', 'index.js'), 'utf8');
  assert.match(fonte, /console\.log\(`\[agente\] iniciando — versão \$\{AGENT_VERSION\} — API: \$\{API_URL\}`\);/);
  const linha = '[agente] iniciando — versão 2026.11.10.1 — API: https://api.prestarecondominios.com.br';
  assert.match(linha, padrao);
  // O log é UTF-8; lido como ANSI (PowerShell 5.1 sem BOM) o travessão vira 3
  // caracteres e o "ã" vira 2 — o padrão tem de casar nos dois casos.
  const comoAnsi = Buffer.from(linha, 'utf8').toString('latin1');
  assert.match(comoAnsi, padrao);
  // E não casa com qualquer linha do log.
  assert.doesNotMatch('[agente] modo condomínio: 1 token gerencia todos os dispositivos', padrao);
  assert.ok(!/["%]/.test(m[1]), 'padrão sem aspas duplas nem % (está dentro de um .cmd)');
});

test('harness/run.js: passa POLL_INTERVAL_MIN_MS=300 ao agente (o piso padrão de 1000 ms engoliria o POLL_INTERVAL_MS=300)', () => {
  const texto = fs.readFileSync(path.join(RAIZ, 'harness', 'run.js'), 'utf8');
  const env = texto.slice(texto.indexOf('const agente = spawn('), texto.indexOf("stdio: ['ignore'"));
  assert.match(env, /POLL_INTERVAL_MS: '300',/);
  assert.match(env, /POLL_INTERVAL_MIN_MS: '300',/);
});
