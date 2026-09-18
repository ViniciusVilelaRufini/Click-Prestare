import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_ROOT = path.resolve(__dirname, '../../');
const EB_DIR = path.join(WEB_ROOT, 'eb-package');
const ZIP_OUTPUT = path.join(WEB_ROOT, 'deploy-api-aws.zip');

async function bundle() {
  console.log('--- PREPARANDO PACOTE DE IMPLANTAÇÃO PARA ELASTIC BEANSTALK ---');
  
  if (fs.existsSync(EB_DIR)) {
    fs.rmSync(EB_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(EB_DIR, { recursive: true });

  // 1. Copia main.js
  console.log('1. Copiando main.js...');
  fs.copyFileSync(
    path.join(WEB_ROOT, 'apps/api/dist/main.js'),
    path.join(EB_DIR, 'main.js')
  );

  // 2. Copia assets se existirem
  const assetsSrc = path.join(WEB_ROOT, 'apps/api/dist/assets');
  if (fs.existsSync(assetsSrc)) {
    console.log('2. Copiando assets...');
    fs.cpSync(assetsSrc, path.join(EB_DIR, 'assets'), { recursive: true });
  }

  // 3. Copia Prisma Client gerado (mantendo a mesma estrutura relativa)
  console.log('3. Copiando Prisma generated client...');
  const prismaDest = path.join(EB_DIR, 'apps/api/src/app/prisma/generated');
  fs.mkdirSync(prismaDest, { recursive: true });
  fs.cpSync(
    path.join(WEB_ROOT, 'apps/api/src/app/prisma/generated'),
    prismaDest,
    { recursive: true }
  );

  // 4. Copia prisma/schema.prisma
  const prismaSchemaDest = path.join(EB_DIR, 'prisma');
  fs.mkdirSync(prismaSchemaDest, { recursive: true });
  fs.copyFileSync(
    path.join(WEB_ROOT, 'prisma/schema.prisma'),
    path.join(prismaSchemaDest, 'schema.prisma')
  );

  // 5. Cria package.json de produção com todas as dependências do backend
  console.log('4. Criando package.json de produção...');
  const pkg = {
    name: 'click-prestare-api',
    version: '1.0.0',
    private: true,
    scripts: {
      start: 'node main.js'
    },
    dependencies: {
      "@aws-sdk/client-s3": "^3.1048.0",
      "@nestjs/common": "^11.0.0",
      "@nestjs/core": "^11.0.0",
      "@nestjs/jwt": "^11.0.2",
      "@nestjs/passport": "^11.0.5",
      "@nestjs/platform-express": "^11.0.0",
      "@nestjs/platform-socket.io": "^11.1.28",
      "@nestjs/throttler": "^6.5.0",
      "@nestjs/websockets": "^11.1.28",
      "@prisma/client": "^6.19.3",
      "adm-zip": "^0.6.1",
      "axios": "^1.6.0",
      "bcrypt": "^6.0.0",
      "class-transformer": "^0.5.1",
      "class-validator": "^0.15.1",
      "firebase-admin": "^13.9.0",
      "helmet": "^8.1.0",
      "nodemailer": "^8.0.7",
      "passport": "^0.7.0",
      "passport-jwt": "^4.0.1",
      "pdf-parse": "^2.4.5",
      "pdfmake": "^0.3.8",
      "reflect-metadata": "^0.1.13",
      "resend": "^6.12.3",
      "rxjs": "^7.8.0",
      "socket.io": "^4.8.3",
      "socket.io-client": "^4.8.3",
      "tslib": "^2.3.0",
      "xlsx": "^0.18.5"
    },
    engines: {
      node: "24.x"
    }
  };
  fs.writeFileSync(path.join(EB_DIR, 'package.json'), JSON.stringify(pkg, null, 2));

  // 6. Cria Procfile
  console.log('5. Criando Procfile...');
  fs.writeFileSync(path.join(EB_DIR, 'Procfile'), 'web: node main.js\n');

  // 6.1 Cria .env com credenciais de SMTP como fallback
  console.log('5.1 Criando .env com fallback de SMTP...');
  const fallbackEnv = `# Fallback de SMTP caso o console do Elastic Beanstalk não tenha as variáveis
SMTP_SERVICE="gmail"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="viniciusrufini17@gmail.com"
SMTP_PASS="vjtyuvqakfzwztuz"
SMTP_FROM="viniciusrufini17@gmail.com"
SMTP_FROM_NAME="Prestare Condomínios"
MAIL_FROM_NAME="Prestare Condomínios"
`;
  fs.writeFileSync(path.join(EB_DIR, '.env'), fallbackEnv, 'utf8');

  // 7. Gera o arquivo .zip compatível com Linux usando adm-zip
  if (fs.existsSync(ZIP_OUTPUT)) {
    fs.unlinkSync(ZIP_OUTPUT);
  }
  console.log('6. Gerando arquivo zip compatível com Linux (POSIX /)...');
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip();
  zip.addLocalFolder(EB_DIR);
  zip.writeZip(ZIP_OUTPUT);

  const stats = fs.statSync(ZIP_OUTPUT);
  console.log(`\n🎉 Pacote de deploy gerado com sucesso:`);
  console.log(`- Arquivo: ${ZIP_OUTPUT}`);
  console.log(`- Tamanho: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
}

bundle().catch(console.error);
