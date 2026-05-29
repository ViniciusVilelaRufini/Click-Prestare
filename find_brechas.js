const fs = require('fs');
const logPath = 'C:\\Users\\vinic\\.gemini\\antigravity\\brain\\b30baedb-3b48-425f-b700-6b1b47070b06\\.system_generated\\logs\\overview.txt';
const fileContent = fs.readFileSync(logPath, 'utf-8');
const lines = fileContent.split('\n');

let out = '';
for (const line of lines) {
  if (line.includes('"step_index":6129')) {
    const data = JSON.parse(line);
    out = data.content;
    break;
  }
}

fs.writeFileSync('brechas_encontradas.txt', out, 'utf-8');
console.log('Gravado brechas_encontradas.txt de tamanho:', out.length);
