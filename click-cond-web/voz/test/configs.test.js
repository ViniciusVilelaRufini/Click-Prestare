import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preencherModelo, arquivoEnv, validarValor } from '../deploy/preencher.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel) => readFileSync(path.join(RAIZ, rel), 'utf8');

/** Seções de um .conf do Asterisk: { nome: [linhas sem comentário] } (nomes repetidos são juntados). */
function secoes(texto) {
  const r = {};
  let atual = null;
  for (const bruta of texto.split('\n')) {
    const linha = bruta.replace(/;.*$/, '').trim();
    if (!linha) continue;
    const m = /^\[([^\]]+)\]/.exec(linha);
    if (m) { atual = m[1]; r[atual] ??= []; continue; }
    if (atual) r[atual].push(linha);
  }
  return r;
}

test('pjsip.conf: transportes udp/tcp/wss com IP público, anonymous WebRTC no contexto prestare-entrar', () => {
  const s = secoes(ler('asterisk/pjsip.conf'));
  for (const t of ['transport-udp', 'transport-tcp']) {
    assert.ok(s[t].includes('bind=0.0.0.0:5060'), t);
    assert.ok(s[t].includes('external_media_address=54.21.36.213'), t);
    assert.ok(s[t].includes('external_signaling_address=54.21.36.213'), t);
    assert.ok(s[t].includes('local_net=172.31.0.0/16'), t);
  }
  // Faciais e monitores usam a 5080: o SIP ALG dos roteadores mexe na 5060 e
  // engole as respostas (bancada SS 3530, 28/11).
  const alt = s['transport-udp-5080'];
  assert.ok(alt, 'transport-udp-5080');
  for (const l of ['protocol=udp', 'bind=0.0.0.0:5080', 'external_media_address=54.21.36.213',
    'external_signaling_address=54.21.36.213', 'local_net=172.31.0.0/16']) {
    assert.ok(alt.includes(l), l);
  }
  assert.ok(s['transport-wss'].includes('protocol=wss'));
  const anon = s.anonymous;
  for (const l of ['type=endpoint', 'context=prestare-entrar', 'webrtc=yes', 'allow=ulaw,alaw,h264', 'max_video_streams=1']) {
    assert.ok(anon.includes(l), l);
  }
  assert.ok(!/opus/.test(ler('asterisk/pjsip.conf')), 'sem opus: o Ubuntu não traz codec_opus');
  assert.match(ler('asterisk/pjsip.conf'), /^#include pjsip_prestare\.conf$/m);
  assert.ok(!/max_contacts/.test(ler('asterisk/pjsip.conf')), 'max_contacts vem só do render das contas');
  assert.ok(!/password=/.test(ler('asterisk/pjsip.conf')), 'nenhuma senha fixa');
});

test('extensions.conf: facial e entrar vão ao Stasis prestare; nada disca para fora', () => {
  const txt = ler('asterisk/extensions.conf');
  const s = secoes(txt);
  // _X! aceita ramal de 1 dígito (casas 1–9); _X. exigiria 2 ou mais.
  assert.ok(s['prestare-facial'].includes('exten => _X!,1,Stasis(prestare,facial,${CHANNEL(endpoint)},${EXTEN})'));
  assert.ok(s['prestare-entrar'].includes('exten => entrar,1,Stasis(prestare,entrar,${PJSIP_HEADER(read,X-Prestare-Token)})'));
  assert.ok(s['prestare-monitor'].includes('exten => _X!,1,Hangup()'));
  assert.ok(s['prestare-facial-teste'].some((l) => l.startsWith('exten => _X!,1,')));
  assert.ok(!/_X\./.test(txt), 'nenhum padrão _X. sobrando');
  assert.ok(s['prestare-facial-teste'].some((l) => l.includes('Stasis(prestare,facial,${GLOBAL(PRESTARE_CONTA_TESTE)},${EXTEN})')));
  assert.ok(!/\bDial\(/.test(txt), 'sem Dial');
  assert.ok(!/\binclude\s*=>/.test(txt), 'sem include entre contextos');
});

test('http.conf: Asterisk só em 127.0.0.1:8088, sem TLS e sem /httpstatus', () => {
  const g = secoes(ler('asterisk/http.conf')).general;
  assert.ok(g.includes('bindaddr=127.0.0.1'));
  assert.ok(g.includes('bindport=8088'));
  assert.ok(g.includes('tlsenable=no'));
  assert.ok(g.includes('enable_status=no'));
  assert.ok(!g.some((l) => l.startsWith('tlsbindaddr')), 'nada escutando fora do loopback');
});

test('nginx: TLS na 8089 repassando só /ws ao Asterisk; o resto é 404', () => {
  const n = ler('nginx/prestare-voz.conf');
  assert.match(n, /listen 8089 ssl;/);
  assert.match(n, /ssl_certificate \/etc\/prestare-voz\/tls\/fullchain\.pem;/);
  assert.match(n, /ssl_certificate_key \/etc\/prestare-voz\/tls\/privkey\.pem;/);
  assert.match(n, /location = \/ws \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:8088\/ws;/);
  assert.match(n, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(n, /proxy_set_header Connection "upgrade";/);
  assert.match(n, /proxy_read_timeout 3600s;/);
  assert.match(n, /location \/ \{\s*return 404;\s*\}/);
  assert.equal((n.match(/proxy_pass/g) ?? []).length, 1, 'um único proxy_pass');
  assert.ok(!/\/ari/.test(n), 'ARI nunca é repassada');
});

test('hook de renovação copia os certificados e recarrega nginx, asterisk, prestare-voz e coturn', () => {
  const h = ler('deploy/hook-renovacao.sh');
  assert.match(h, /\/etc\/asterisk\/keys\/voz\.crt/);
  assert.match(h, /\/etc\/asterisk\/keys\/voz\.key/);
  assert.match(h, /\/etc\/prestare-voz\/tls\/fullchain\.pem/);
  assert.match(h, /-g turnserver -m 640 .*\/etc\/prestare-voz\/tls\/privkey\.pem/);
  assert.match(h, /systemctl reload nginx/);
  assert.match(h, /systemctl restart prestare-voz coturn/);
  const i = ler('deploy/instalar.sh');
  assert.match(i, /\/etc\/letsencrypt\/renewal-hooks\/deploy\/prestare\.sh/);
  assert.match(i, /rm -f \/etc\/nginx\/sites-enabled\/default/, 'site padrão ocuparia a porta 80 do certbot');
  assert.match(i, /nginx -t/);
  assert.match(i, /systemctl reload nginx/);
});

test('simular-facial.sh não põe a senha da ARI no argv do curl', () => {
  const s = ler('deploy/simular-facial.sh');
  assert.ok(!/curl[^\n]*-u /.test(s), 'sem -u na linha do curl');
  assert.match(s, /--config -/);
});

test('ari.conf: usuário prestare com senha do SSM', () => {
  const s = secoes(ler('asterisk/ari.conf'));
  assert.ok(s.prestare.includes('type=user'));
  assert.ok(s.prestare.includes('password=__VOZ_ARI_SENHA__'));
});

test('rtp.conf: faixa 10000–20000, ICE e candidato com o IP público', () => {
  const s = secoes(ler('asterisk/rtp.conf'));
  assert.ok(s.general.includes('rtpstart=10000'));
  assert.ok(s.general.includes('rtpend=20000'));
  assert.ok(s.general.includes('icesupport=yes'));
  assert.ok(s.ice_host_candidates.includes('__IP_PRIVADO__ => 54.21.36.213'));
});

test('modules.conf não carrega chan_sip', () => {
  assert.ok(secoes(ler('asterisk/modules.conf')).modules.includes('noload => chan_sip.so'));
});

test('turnserver.conf: auth por segredo, faixa 50000–50999, IP externo', () => {
  const linhas = ler('coturn/turnserver.conf').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const l of ['use-auth-secret', 'static-auth-secret=__VOZ_TURN_SECRET__', 'realm=voz.prestarecondominios.com.br',
    'listening-port=3478', 'min-port=50000', 'max-port=50999', 'external-ip=54.21.36.213/__IP_PRIVADO__', 'no-cli', 'fingerprint']) {
    assert.ok(linhas.includes(l), l);
  }
  assert.ok(linhas.includes('denied-peer-ip=172.16.0.0-172.31.255.255'));
});

test('unidade systemd se chama prestare-voz e lê o EnvironmentFile', () => {
  const u = ler('deploy/prestare-voz.service');
  assert.match(u, /^EnvironmentFile=\/etc\/prestare-voz\.env$/m);
  assert.match(u, /^ExecStart=__NODE__ src\/index\.js$/m);
  assert.match(u, /^ReadWritePaths=\/etc\/asterisk\/pjsip_prestare\.conf$/m);
  assert.match(u, /^WorkingDirectory=\/opt\/prestare-voz\/atual$/m);
});

test('instalar.sh lê os quatro segredos do SSM', () => {
  const s = ler('deploy/instalar.sh');
  assert.match(s, /for nome in VOZ_TOKEN_SECRET VOZ_INTERNAL_TOKEN VOZ_TURN_SECRET VOZ_ARI_SENHA/);
  assert.match(s, /--name "\/prestare\/voz\/\$nome"/);
  assert.match(s, /--with-decryption/);
  assert.match(s, /chmod 600 \/etc\/prestare-voz\.env/);
});

test('preencher troca os marcadores e recusa ausentes ou perigosos', () => {
  assert.equal(preencherModelo('a=__X__\nb=__Y_2__\n', { X: 'um', Y_2: 'dois/+=' }), 'a=um\nb=dois/+=\n');
  assert.throws(() => preencherModelo('a=__X__', {}), /X ausente/);
  for (const ruim of ['tem espaço', 'linha\nnova', 'com;comentario', "aspa'", 'dolar$', 'cerquilha#']) {
    assert.throws(() => validarValor('V', ruim), /não permitido/, ruim);
  }
  assert.equal(arquivoEnv(['A', 'B'], { A: '1', B: 'https://x/api' }), "A='1'\nB='https://x/api'\n");
});

test('scripts de shell passam no bash -n', (t) => {
  const bash = spawnSync('bash', ['--version']);
  if (bash.error || bash.status !== 0) return t.skip('bash indisponível');
  for (const nome of readdirSync(path.join(RAIZ, 'deploy')).filter((n) => n.endsWith('.sh'))) {
    const r = spawnSync('bash', ['-n', path.join(RAIZ, 'deploy', nome)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${nome}: ${r.stderr}`);
  }
});

test('tom do beep: 0,2 s a 8 kHz em 16 bits, sem estalo nas pontas', async () => {
  const { gerarTom } = await import('../deploy/tom.mjs');
  const buf = gerarTom({ hz: 1000, segundos: 0.2 });
  assert.equal(buf.length, 1600 * 2);
  assert.equal(buf.readInt16LE(0), 0);
  assert.equal(buf.readInt16LE(buf.length - 2), 0);
  let pico = 0;
  for (let i = 0; i < buf.length; i += 2) pico = Math.max(pico, Math.abs(buf.readInt16LE(i)));
  assert.ok(pico > 15000 && pico <= 16384, `pico ${pico}`);
});

test('gerar-sons.sh tem os quatro textos do plano', () => {
  const s = ler('deploy/gerar-sons.sh');
  for (const t of ['Apartamento não encontrado. Confira o número e tente de novo.', 'O interfone está indisponível no momento.',
    'Ninguém atendeu. Tente novamente mais tarde.', 'Aguarde um pouco para chamar novamente.']) {
    assert.ok(s.includes(t), t);
  }
  assert.match(s, /--voice-id Camila/);
  assert.match(s, /--sample-rate 8000/);
});
