/**
 * Gera o executável único do Agente Local (Node SEA — Single Executable App).
 *
 * Produz um .exe (Windows) / binário (Linux/macOS) que roda sozinho, SEM
 * precisar de Node instalado na máquina do condomínio.
 *
 * Uso:  node build-exe.mjs        (ou: npm run build:exe)
 * Requer: o mesmo Node que vai ser embutido (use Node 20+; ideal Node 24).
 */
import { execSync } from 'node:child_process';
import { copyFileSync, rmSync, existsSync } from 'node:fs';
import { platform } from 'node:os';

const isWin = platform() === 'win32';
const isMac = platform() === 'darwin';
const out = isWin ? 'click-agent.exe' : 'click-agent';
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

console.log(`Empacotando o agente com o Node ${process.version} (${platform()})...\n`);

// 1. Gera o blob com o código embutido
run('node --experimental-sea-config sea-config.json');

// 2. Copia o binário do Node atual para o nome final
if (existsSync(out)) rmSync(out);
copyFileSync(process.execPath, out);

// 3. Injeta o blob no binário (postject vem via npx)
const macArg = isMac ? ' --macho-segment-name NODE_SEA' : '';
run(`npx --yes postject ${out} NODE_SEA_BLOB sea-prep.blob --sentinel-fuse ${FUSE}${macArg}`);

// 4. Limpa o blob temporário
if (existsSync('sea-prep.blob')) rmSync('sea-prep.blob');

console.log(`\n✅ Gerado: ${out}`);
console.log('Copie esse arquivo + um .env (veja .env.example) para a máquina da portaria.');
if (isWin) {
  console.log('Para iniciar com o Windows, rode install-windows.bat na mesma pasta.');
}
