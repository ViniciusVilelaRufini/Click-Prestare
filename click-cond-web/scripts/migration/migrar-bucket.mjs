/**
 * Migra os arquivos do bucket antigo (storage-click-dev, outra conta AWS,
 * objetos public-read) para o bucket privado da Prestare
 * (prestare-arquivos-850401152034, sa-east-1, SSE-KMS por padrão do bucket)
 * e reescreve as URLs gravadas no banco.
 *
 * O bucket antigo NUNCA é alterado: só é LIDO por HTTPS público (GET na URL
 * que está no banco). Nada de DeleteObject/PutObject nele.
 *
 * Uso (na raiz de click-cond-web, ou no CloudShell com o repo clonado):
 *   node scripts/migration/migrar-bucket.mjs              # dry-run (padrão)
 *   node scripts/migration/migrar-bucket.mjs --executar   # copia e reescreve
 *
 * Variáveis:
 *   DATABASE_URL  mysql://user:senha@host:porta/base (lida também do .env)
 *   Credenciais AWS: cadeia padrão do SDK (perfil, env, CloudShell, role).
 *   Precisam de s3:HeadObject/GetObject/PutObject no bucket novo e
 *   kms:GenerateDataKey/Decrypt na chave do bucket.
 *   ATENÇÃO: no .env local AWS_ACCESS_KEY_ID pode ser a chave antiga de outra
 *   conta — o script ignora AWS_ACCESS_KEY/AWS_SECRET_KEY, mas se o shell
 *   tiver AWS_ACCESS_KEY_ID exportado é ela que vale. Rode com o perfil da
 *   conta 850401152034 (ex.: AWS_PROFILE=prestare) ou no CloudShell.
 *
 * Idempotente:
 *   - objeto já presente no bucket novo (HeadObject 200) não é recopiado;
 *   - só são reescritas URLs que ainda apontam para o bucket antigo, e só
 *     depois de o objeto existir no bucket novo (o que falhou continua
 *     apontando para o antigo, que segue público, e entra no relatório);
 *   - data: / base64 inline é ignorado (não está em bucket nenhum).
 *
 * Saída do dry-run: contagem por tabela/coluna, objetos inexistentes no
 * bucket antigo (404/403), colunas fora da lista que também contêm URLs do
 * bucket antigo (varredura do information_schema) e linhas cuja URL nova
 * estouraria o tamanho da coluna.
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

// Do .env só interessa a conexão do banco: nenhuma credencial AWS dele pode
// vazar para a cadeia padrão do SDK (a chave antiga é de outra conta).
{
  const doArquivo = {};
  dotenv.config({ processEnv: doArquivo, quiet: true });
  for (const k of ['DATABASE_URL', 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (process.env[k] === undefined && doArquivo[k] !== undefined) process.env[k] = doArquivo[k];
  }
}

const EXECUTAR = process.argv.includes('--executar');
const VERBOSO = process.argv.includes('--verbose');

const BUCKET_ANTIGO = 'storage-click-dev';
const BUCKET_NOVO = 'prestare-arquivos-850401152034';
const REGIAO_NOVA = 'sa-east-1';
const BASE_NOVA = `https://${BUCKET_NOVO}.s3.${REGIAO_NOVA}.amazonaws.com`;

/**
 * Colunas que guardam URL de arquivo enviado (upload via StorageService /
 * Express legada). Levantadas do prisma/schema.prisma (@@map/@map) e dos
 * chamadores de uploadDataUrl. Colunas de texto livre/JSON (anexos) são
 * tratadas igual: toda ocorrência de URL do bucket antigo dentro do valor.
 */
const COLUNAS = [
  ['Users', 'photo'],
  ['Users', 'profile_image'],
  ['Condominios', 'photo'],
  ['Moradores', 'foto_pessoa'],
  ['Moradores', 'foto_documento'],
  ['Visitantes', 'foto_pessoa'],
  ['Visitantes', 'foto_documento'],
  ['Prestadores_servico', 'foto_pessoa'],
  ['Prestadores_servico', 'foto_documento'],
  ['pessoas', 'foto_pessoa'],
  ['pessoas', 'foto_documento'],
  ['Convites_Visita', 'foto_url'],
  ['Areas_Sociais', 'imagem'],
  ['Assembleias', 'link'],
  ['Assembleias', 'anexos'], // texto com lista de URLs
  ['Documentos', 'link_doc'],
  ['Manutencoes', 'anexos'], // texto com lista de URLs
  ['Ocorrencias', 'anexos'], // texto com lista de URLs
  ['Financeiro', 'photo'],
  ['Financeiro', 'url_comprovante'],
  ['Financeiro', 'url_boleto'],
  ['Encomendas', 'foto_volume'],
  ['Encomendas', 'retirado_foto'],
  ['Encomendas', 'retirado_assinatura'],
  ['delivery_entregadores', 'foto'],
  ['Authors', 'profile_image'],
  ['Products', 'images'],
];

/**
 * Colunas que guardam a KEY (não a URL) de um objeto do mesmo bucket: só o
 * objeto é copiado, o valor no banco não muda. Mídias do WhatsApp do CRM eram
 * gravadas SEM ACL pública — se o bucket antigo não as servir publicamente,
 * aparecem como inacessíveis no relatório (sem como copiar sem a chave antiga).
 */
const COLUNAS_KEY = [['crm_whatsapp_mensagens', 'media_chave']];

/**
 * Histórico: citam URLs antigas, mas não são reescritas (trilha de auditoria
 * não se edita) nem contam como "descoberta". Só aparecem no relatório.
 */
const COLUNAS_SO_HISTORICO = [['audit_logs', 'detalhes']];

/**
 * URL do bucket antigo em qualquer forma que o S3 gera:
 *   https://storage-click-dev.s3.amazonaws.com/<key>
 *   https://storage-click-dev.s3.us-east-1.amazonaws.com/<key>
 *   https://storage-click-dev.s3-us-east-1.amazonaws.com/<key>
 *   https://s3.amazonaws.com/storage-click-dev/<key> (path-style)
 * A key termina em espaço, aspas, vírgula, colchete, < > ou query/fragmento.
 */
const RE_URL_ANTIGA = new RegExp(
  String.raw`https?://(?:${BUCKET_ANTIGO}\.s3[.-][a-z0-9.-]*amazonaws\.com|s3[.-][a-z0-9.-]*amazonaws\.com/${BUCKET_ANTIGO})/([^\s"'<>,\]\\?#]+)(?:\?[^\s"'<>,\]\\#]*)?`,
  'gi',
);

function buildConfig() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
      connectTimeout: 20000,
    };
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 20000,
  };
}

/** Todas as URLs do bucket antigo em um valor: [{ url, caminho, key }]. */
function urlsAntigas(valor) {
  if (typeof valor !== 'string' || !valor) return [];
  // data:/base64 inline não está em bucket nenhum.
  if (valor.startsWith('data:')) return [];
  const achadas = [];
  for (const m of valor.matchAll(RE_URL_ANTIGA)) {
    const caminho = m[1]; // como está na URL (pode ter %XX)
    let key;
    try {
      key = decodeURIComponent(caminho);
    } catch {
      continue;
    }
    if (!key || key.split('/').includes('..')) continue;
    achadas.push({ url: m[0], caminho, key });
  }
  return achadas;
}

const urlNova = (caminho) => `${BASE_NOVA}/${caminho}`;

const TIPO_POR_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', mp4: 'video/mp4', opus: 'audio/opus', m4a: 'audio/mp4',
};

function tipoDoArquivo(key, header) {
  const h = (header || '').split(';')[0].trim().toLowerCase();
  if (h && h !== 'application/octet-stream' && h !== 'binary/octet-stream') return h;
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return TIPO_POR_EXT[ext] || h || 'application/octet-stream';
}

const s3 = new S3Client({ region: REGIAO_NOVA });

async function existeNoNovo(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET_NOVO, Key: key }));
    return true;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NotFound') return false;
    throw err;
  }
}

/** GET público no bucket antigo (sem credencial; o bucket antigo nunca é alterado). */
async function baixarAntigo(item) {
  const alvo = `https://${BUCKET_ANTIGO}.s3.amazonaws.com/${item.caminho}`;
  const res = await fetch(alvo, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) return { ok: false, status: res.status };
  const corpo = Buffer.from(await res.arrayBuffer());
  return { ok: true, corpo, tipo: tipoDoArquivo(item.key, res.headers.get('content-type')) };
}

/** HEAD público no antigo, para o dry-run listar o que não existe mais. */
async function existeNoAntigo(item) {
  const alvo = `https://${BUCKET_ANTIGO}.s3.amazonaws.com/${item.caminho}`;
  try {
    const res = await fetch(alvo, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(30000) });
    return res.status;
  } catch (err) {
    return `erro: ${err?.message ?? err}`;
  }
}

const q = (id) => '`' + String(id).replace(/`/g, '``') + '`';

async function colunasDoBanco(conn) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS tipo, CHARACTER_MAXIMUM_LENGTH AS max
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND DATA_TYPE IN ('char','varchar','tinytext','text','mediumtext','longtext','json')`,
  );
  const mapa = new Map();
  for (const r of rows) mapa.set(`${r.t}.${r.c}`.toLowerCase(), { tabela: r.t, coluna: r.c, tipo: r.tipo, max: r.max });
  return mapa;
}

async function main() {
  console.log(`== Migração ${BUCKET_ANTIGO} -> ${BUCKET_NOVO} (${EXECUTAR ? 'EXECUTAR' : 'dry-run'}) ==\n`);
  const conn = await mysql.createConnection(buildConfig());
  try {
    const doBanco = await colunasDoBanco(conn);

    // 1) Colunas da lista (as que não existem no banco viram aviso).
    const alvos = [];
    for (const [t, c] of COLUNAS) {
      const info = doBanco.get(`${t}.${c}`.toLowerCase());
      if (!info) console.log(`aviso: ${t}.${c} não existe neste banco — pulada`);
      else alvos.push({ ...info, modo: 'url' });
    }
    const alvosKey = [];
    for (const [t, c] of COLUNAS_KEY) {
      const info = doBanco.get(`${t}.${c}`.toLowerCase());
      if (info) alvosKey.push({ ...info, modo: 'key' });
    }

    // 2) Varredura: qualquer outra coluna de texto que mencione o bucket antigo.
    const listadas = new Set([...COLUNAS, ...COLUNAS_KEY].map(([t, c]) => `${t}.${c}`.toLowerCase()));
    const historico = new Set(COLUNAS_SO_HISTORICO.map(([t, c]) => `${t}.${c}`.toLowerCase()));
    for (const [t, c] of COLUNAS_SO_HISTORICO) {
      const info = doBanco.get(`${t}.${c}`.toLowerCase());
      if (!info) continue;
      const [[{ n }]] = await conn.query(
        `SELECT COUNT(*) AS n FROM ${q(info.tabela)} WHERE INSTR(${q(info.coluna)}, ?) > 0`,
        [BUCKET_ANTIGO],
      );
      if (Number(n)) console.log(`info: ${info.tabela}.${info.coluna} cita o bucket antigo em ${n} linha(s) — histórico, não é reescrito`);
    }
    const descobertas = [];
    for (const [chave, info] of doBanco) {
      if (listadas.has(chave) || historico.has(chave)) continue;
      const [[{ n }]] = await conn.query(
        `SELECT COUNT(*) AS n FROM ${q(info.tabela)} WHERE INSTR(${q(info.coluna)}, ?) > 0`,
        [BUCKET_ANTIGO],
      );
      if (Number(n) > 0) descobertas.push({ ...info, modo: 'url', linhas: Number(n) });
    }
    if (descobertas.length) {
      console.log('\nColunas FORA da lista que contêm URL do bucket antigo (serão migradas também):');
      for (const d of descobertas) console.log(`  ${d.tabela}.${d.coluna}: ${d.linhas} linha(s)`);
    }

    // 3) Levantamento por coluna.
    const objetos = new Map(); // key -> { caminho, key, refs: [] }
    const porColuna = [];
    for (const alvo of [...alvos, ...descobertas]) {
      const [rows] = await conn.query(
        `SELECT ${q(alvo.coluna)} AS v FROM ${q(alvo.tabela)} WHERE INSTR(${q(alvo.coluna)}, ?) > 0`,
        [BUCKET_ANTIGO],
      );
      let urls = 0;
      let dataUrl = 0;
      const estouro = [];
      const distintas = new Map(); // url antiga -> item
      for (const { v } of rows) {
        const valor = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
        if (valor.startsWith('data:')) {
          dataUrl++;
          continue;
        }
        const achadas = urlsAntigas(valor);
        urls += achadas.length;
        let novoValor = valor;
        for (const a of achadas) {
          distintas.set(a.url, a);
          novoValor = novoValor.split(a.url).join(urlNova(a.caminho));
          if (!objetos.has(a.key)) objetos.set(a.key, { ...a, refs: [] });
          objetos.get(a.key).refs.push(`${alvo.tabela}.${alvo.coluna}`);
        }
        if (alvo.max && novoValor.length > Number(alvo.max)) estouro.push(novoValor.length);
      }
      porColuna.push({ ...alvo, linhas: rows.length, urls, dataUrl, distintas, estouro });
    }
    for (const alvo of alvosKey) {
      const [rows] = await conn.query(
        `SELECT DISTINCT ${q(alvo.coluna)} AS v FROM ${q(alvo.tabela)} WHERE ${q(alvo.coluna)} IS NOT NULL AND ${q(alvo.coluna)} <> ''`,
      );
      for (const { v } of rows) {
        const key = String(v).replace(/^\/+/, '');
        if (!key || key.split('/').includes('..')) continue;
        const caminho = key.split('/').map(encodeURIComponent).join('/');
        if (!objetos.has(key)) objetos.set(key, { url: null, caminho, key, refs: [] });
        objetos.get(key).refs.push(`${alvo.tabela}.${alvo.coluna} (key)`);
      }
      porColuna.push({ ...alvo, linhas: rows.length, urls: rows.length, dataUrl: 0, distintas: new Map(), estouro: [] });
    }

    console.log('\nPor tabela/coluna (linhas com o bucket antigo / URLs / data: ignorados):');
    for (const c of porColuna) {
      console.log(
        `  ${c.tabela}.${c.coluna}${c.modo === 'key' ? ' [key]' : ''}: ${c.linhas} linha(s), ${c.urls} URL(s), ${c.distintas.size} distinta(s)` +
          (c.dataUrl ? `, ${c.dataUrl} data: ignorado(s)` : '') +
          (c.estouro.length ? `  !! ${c.estouro.length} linha(s) estourariam a coluna (max ${c.max})` : ''),
      );
    }
    console.log(`\nObjetos distintos a migrar: ${objetos.size}`);

    const colunasComEstouro = new Set(porColuna.filter((c) => c.estouro.length).map((c) => `${c.tabela}.${c.coluna}`));

    // 4) Objetos: presença no novo, existência no antigo, cópia.
    const faltando = [];
    const copiados = [];
    const jaNoNovo = [];
    const prontos = new Set(); // keys disponíveis no bucket novo
    let semVerificarNovo = 0;
    for (const obj of objetos.values()) {
      let noNovo = false;
      try {
        noNovo = await existeNoNovo(obj.key);
      } catch (err) {
        // No --executar, sem acesso ao bucket novo não há o que fazer: aborta.
        if (EXECUTAR) throw err;
        if (!semVerificarNovo++) console.log(`aviso: sem acesso ao bucket novo (${err?.name ?? err}); dry-run segue sem essa checagem`);
      }
      if (noNovo) {
        jaNoNovo.push(obj.key);
        prontos.add(obj.key);
        continue;
      }
      if (!EXECUTAR) {
        const status = await existeNoAntigo(obj);
        if (status !== 200) faltando.push({ key: obj.key, status, refs: obj.refs });
        continue;
      }
      const baixado = await baixarAntigo(obj);
      if (!baixado.ok) {
        faltando.push({ key: obj.key, status: baixado.status, refs: obj.refs });
        continue;
      }
      // Sem ACL e sem SSE explícito: vale o padrão do bucket (privado, SSE-KMS).
      await s3.send(
        new PutObjectCommand({ Bucket: BUCKET_NOVO, Key: obj.key, Body: baixado.corpo, ContentType: baixado.tipo }),
      );
      copiados.push(obj.key);
      prontos.add(obj.key);
      if (VERBOSO) console.log(`  copiado ${obj.key} (${baixado.tipo}, ${baixado.corpo.length} B)`);
    }

    console.log(`\nJá presentes no bucket novo: ${jaNoNovo.length}`);
    if (EXECUTAR) console.log(`Copiados agora: ${copiados.length}`);
    if (faltando.length) {
      console.log(`\nInacessíveis/inexistentes no bucket antigo (${faltando.length}) — URLs desses ficam como estão:`);
      for (const f of faltando) console.log(`  [${f.status}] ${f.key}  <- ${[...new Set(f.refs)].join(', ')}`);
    }

    // 5) Reescrita das URLs (só as que ainda apontam para o antigo e cujo objeto está no novo).
    if (!EXECUTAR) {
      console.log('\nDry-run: nada foi copiado nem reescrito. Rode com --executar.');
      return;
    }
    let reescritas = 0;
    for (const c of porColuna) {
      if (c.modo !== 'url' || !c.distintas.size) continue;
      if (colunasComEstouro.has(`${c.tabela}.${c.coluna}`)) {
        console.log(`  PULADA ${c.tabela}.${c.coluna}: URL nova estouraria o tamanho da coluna (ajuste o schema antes).`);
        continue;
      }
      for (const a of c.distintas.values()) {
        if (!prontos.has(a.key)) continue;
        const [r] = await conn.query(
          `UPDATE ${q(c.tabela)} SET ${q(c.coluna)} = REPLACE(${q(c.coluna)}, ?, ?) WHERE INSTR(${q(c.coluna)}, ?) > 0`,
          [a.url, urlNova(a.caminho), a.url],
        );
        reescritas += r.affectedRows ?? 0;
      }
    }
    console.log(`\nLinhas reescritas: ${reescritas}`);

    // 6) Conferência: o que ainda aponta para o bucket antigo.
    console.log('\nConferência pós-execução (linhas que ainda citam o bucket antigo):');
    for (const c of porColuna) {
      if (c.modo !== 'url') continue;
      const [[{ n }]] = await conn.query(
        `SELECT COUNT(*) AS n FROM ${q(c.tabela)} WHERE INSTR(${q(c.coluna)}, ?) > 0`,
        [BUCKET_ANTIGO],
      );
      if (Number(n)) console.log(`  ${c.tabela}.${c.coluna}: ${n}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Falhou:', err?.message ?? err);
  process.exitCode = 1;
});
