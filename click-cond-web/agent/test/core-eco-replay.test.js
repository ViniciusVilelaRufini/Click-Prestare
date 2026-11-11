'use strict';

/**
 * agent/src/core/eco-replay.js — memória dos eventos AO VIVO recentes, por
 * aparelho, para o replay do log interno não reenviar como `backlog` uma
 * passagem que o stream já entregou (o "eco" do replay).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  criarMemoriaDeEco,
  JANELA_ECO_MS,
  IDADE_MAX_MS,
  MAX_ENTRADAS_POR_APARELHO,
} = require('../src/core/eco-replay');

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const s = (n) => n * 1000;

test('constantes: janela de 15 s, memória de 10 min e 500 entradas por aparelho', () => {
  assert.equal(JANELA_ECO_MS, 15 * 1000);
  assert.equal(IDADE_MAX_MS, 10 * 60 * 1000);
  assert.equal(MAX_ENTRADAS_POR_APARELHO, 500);
});

test('eco simples: registro do replay da mesma pessoa, perto do evento ao vivo, é descartado', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'morador_42', T0);
  // CreateTime do aparelho 10 s atrás do relógio do agente: ainda é o mesmo acesso.
  assert.equal(eco.ehEco(1, { pessoa: 'morador_42', instanteMs: T0 - s(10), marca: 101 }, T0 + s(5)), true);
});

test('casamento por contagem: duas passagens e um só evento ao vivo → uma é enviada', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'morador_42', T0);
  const agora = T0 + s(40);
  const r1 = eco.ehEco(1, { pessoa: 'morador_42', instanteMs: T0 + s(1), marca: 101 }, agora);
  const r2 = eco.ehEco(1, { pessoa: 'morador_42', instanteMs: T0 + s(30), marca: 102 }, agora);
  assert.deepEqual([r1, r2], [true, false], 'o evento ao vivo consome no máximo um registro');
});

test('casamento por contagem: dois eventos ao vivo consomem dois registros, o terceiro passa', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'morador_42', T0);
  eco.registrarAoVivo(1, 'morador_42', T0 + s(20));
  const agora = T0 + s(50);
  const res = [101, 102, 103].map((marca, i) =>
    eco.ehEco(1, { pessoa: 'morador_42', instanteMs: T0 + s(i * 20), marca }, agora),
  );
  assert.deepEqual(res, [true, true, false]);
});

test('entre dois eventos ao vivo na janela, consome o mais próximo do registro', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'p', T0);
  eco.registrarAoVivo(1, 'p', T0 + s(50));
  const agora = T0 + s(60);
  // O registro de T0+48 casa com o evento de T0+50 (não com o de T0)...
  assert.equal(eco.ehEco(1, { pessoa: 'p', instanteMs: T0 + s(48), marca: 2 }, agora), true);
  // ...então o de T0 ainda está livre para o registro de T0-10 (a 10 s dele).
  assert.equal(eco.ehEco(1, { pessoa: 'p', instanteMs: T0 - s(10), marca: 1 }, agora), true);
});

test('evento ao vivo fora da janela (mais de 15 s do CreateTime) não consome', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'morador_42', T0);
  const agora = T0 + s(120);
  assert.equal(eco.ehEco(1, { pessoa: 'morador_42', instanteMs: T0 + s(16), marca: 101 }, agora), false);
  assert.equal(eco.ehEco(1, { pessoa: 'morador_42', instanteMs: T0 - s(16), marca: 100 }, agora), false);
  // No limite exato da janela ainda é eco, e o evento continuava disponível.
  assert.equal(eco.ehEco(1, { pessoa: 'morador_42', instanteMs: T0 + JANELA_ECO_MS, marca: 102 }, agora), true);
});

test('pessoas diferentes não se confundem', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'morador_42', T0);
  assert.equal(eco.ehEco(1, { pessoa: 'morador_43', instanteMs: T0, marca: 101 }, T0 + s(1)), false);
  assert.equal(eco.ehEco(1, { pessoa: 'morador_42', instanteMs: T0, marca: 102 }, T0 + s(1)), true);
});

test('pessoa é comparada como texto (UserID numérico do aparelho x string do stream)', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 42, T0);
  assert.equal(eco.ehEco(1, { pessoa: '42', instanteMs: T0, marca: 1 }, T0), true);
});

test('aparelhos diferentes não se confundem', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'morador_42', T0);
  assert.equal(eco.ehEco(2, { pessoa: 'morador_42', instanteMs: T0, marca: 101 }, T0 + s(1)), false);
  assert.equal(eco.ehEco(1, { pessoa: 'morador_42', instanteMs: T0, marca: 101 }, T0 + s(1)), true);
});

test('o MESMO registro relido (marca represada) continua eco e não gasta outro evento ao vivo', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'p', T0);
  eco.registrarAoVivo(1, 'p', T0 + s(10));
  const agora = T0 + s(30);
  assert.equal(eco.ehEco(1, { pessoa: 'p', instanteMs: T0, marca: 7 }, agora), true);
  // Replay seguinte relê a marca 7 (a baseline ficou represada por uma falha).
  assert.equal(eco.ehEco(1, { pessoa: 'p', instanteMs: T0, marca: 7 }, agora), true);
  // O segundo evento ao vivo continua disponível para a marca 8; a 9 passa.
  assert.equal(eco.ehEco(1, { pessoa: 'p', instanteMs: T0 + s(10), marca: 8 }, agora), true);
  assert.equal(eco.ehEco(1, { pessoa: 'p', instanteMs: T0 + s(20), marca: 9 }, agora), false);
});

test('instante inválido (timestamp ilegível) nunca é eco', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'p', T0);
  assert.equal(eco.ehEco(1, { pessoa: 'p', instanteMs: NaN, marca: 1 }, T0), false);
  assert.equal(eco.ehEco(1, { pessoa: 'p', instanteMs: undefined, marca: 1 }, T0), false);
  assert.equal(eco.tamanho(1), 1, 'não consumiu nada');
});

test('expiração: evento ao vivo com mais de 10 min sai da memória', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'p', T0);
  assert.equal(eco.tamanho(1), 1);
  const agora = T0 + IDADE_MAX_MS + 1;
  // Mesmo com o CreateTime "casando" (relógio do aparelho parado), não consome.
  assert.equal(eco.ehEco(1, { pessoa: 'p', instanteMs: T0, marca: 1 }, agora), false);
  assert.equal(eco.tamanho(1), 0);
});

test('expiração também ao registrar: entradas velhas não se acumulam', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'a', T0);
  eco.registrarAoVivo(1, 'b', T0 + IDADE_MAX_MS + 1);
  assert.equal(eco.tamanho(1), 1);
});

test('limite de tamanho: guarda só as 500 entradas mais novas por aparelho', () => {
  const eco = criarMemoriaDeEco();
  for (let i = 0; i < MAX_ENTRADAS_POR_APARELHO + 20; i++) eco.registrarAoVivo(1, `p${i}`, T0 + i);
  eco.registrarAoVivo(2, 'outro', T0);
  assert.equal(eco.tamanho(1), MAX_ENTRADAS_POR_APARELHO);
  assert.equal(eco.tamanho(2), 1, 'o limite é por aparelho');
  const agora = T0 + s(1);
  assert.equal(eco.ehEco(1, { pessoa: 'p0', instanteMs: T0, marca: 1 }, agora), false, 'a mais antiga saiu');
  assert.equal(eco.ehEco(1, { pessoa: 'p519', instanteMs: T0, marca: 2 }, agora), true);
});

test('limites configuráveis (janela, idade, tamanho)', () => {
  const eco = criarMemoriaDeEco({ janelaMs: 1000, idadeMaxMs: 5000, maxEntradas: 2 });
  eco.registrarAoVivo(1, 'a', T0);
  eco.registrarAoVivo(1, 'b', T0 + 1);
  eco.registrarAoVivo(1, 'c', T0 + 2);
  assert.equal(eco.tamanho(1), 2);
  assert.equal(eco.ehEco(1, { pessoa: 'b', instanteMs: T0 + 1500, marca: 1 }, T0 + 2000), false);
  assert.equal(eco.ehEco(1, { pessoa: 'b', instanteMs: T0 + 900, marca: 2 }, T0 + 2000), true);
});

test('cobrirAte(): evento ao vivo já coberto pela marca d\'água não consome uma passagem NOVA', () => {
  // Entrada ao vivo em T0; a marca d'água avançou por cima dela. O stream cai,
  // a pessoa SAI 40 s depois (só no log). O replay traz só a saída — sem
  // `cobrirAte`, ela seria descartada como "eco" da entrada.
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'morador_42', T0);
  eco.cobrirAte(1, T0 + s(2));
  assert.equal(eco.tamanho(1), 0);
  assert.equal(eco.ehEco(1, { pessoa: 'morador_42', instanteMs: T0 + s(40), marca: 102 }, T0 + s(50)), false);
});

test('cobrirAte(): só remove o que chegou até o instante dado, e só daquele aparelho', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'a', T0);
  eco.registrarAoVivo(1, 'b', T0 + s(10));
  eco.registrarAoVivo(2, 'a', T0);
  eco.cobrirAte(1, T0 + s(5));
  assert.equal(eco.tamanho(1), 1);
  assert.equal(eco.tamanho(2), 1);
  assert.equal(eco.ehEco(1, { pessoa: 'b', instanteMs: T0 + s(10), marca: 1 }, T0 + s(11)), true);
});

test('cobrirAte(..., { manterConsumidos: true }): preserva o que já casou com um registro (marca represada)', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'a', T0);
  eco.registrarAoVivo(1, 'b', T0);
  const agora = T0 + s(5);
  assert.equal(eco.ehEco(1, { pessoa: 'a', instanteMs: T0, marca: 7 }, agora), true);
  eco.cobrirAte(1, agora, { manterConsumidos: true });
  assert.equal(eco.tamanho(1), 1, 'o não consumido (b) saiu; o consumido (a) ficou');
  // A marca 7 relida continua eco; "b" não consome mais nada.
  assert.equal(eco.ehEco(1, { pessoa: 'a', instanteMs: T0, marca: 7 }, agora), true);
  assert.equal(eco.ehEco(1, { pessoa: 'b', instanteMs: T0, marca: 8 }, agora), false);
  // Sem a opção, sai tudo.
  eco.cobrirAte(1, agora);
  assert.equal(eco.tamanho(1), 0);
});

// ---------- Revisão: I2 (decisão sobre a lista inteira), I1 e I3 ----------

const { avancarMarcaCobrindoEco } = require('../src/core/eco-replay');
const reg = (pessoa, instanteMs, marca) => ({ pessoa, instanteMs, marca });

test('separarEcos(): devolve { ecos, reais } com os MESMOS objetos recebidos, na ordem do replay', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'a', T0);
  const r1 = reg('a', T0 + s(1), 1);
  const r2 = reg('b', T0 + s(2), 2);
  const r3 = reg('a', T0 + s(3), 3);
  const { ecos, reais } = eco.separarEcos(1, [r1, r2, r3], T0 + s(10));
  assert.deepEqual(ecos, [r1]);
  assert.deepEqual(reais, [r2, r3]);
  assert.equal(ecos[0], r1);
  assert.equal(reais[1], r3);
  assert.deepEqual(eco.separarEcos(1, [], T0), { ecos: [], reais: [] });
  assert.deepEqual(eco.separarEcos(1, null, T0), { ecos: [], reais: [] });
});

test('I2: ao vivo em T+40 s, registros em T e T+40 s → o eco é o de T+40 s; o de T é uma passagem REAL', () => {
  // Com a janela antiga (60 s) e o casamento guloso registro a registro, o
  // registro de T (real, nunca entregue) casava primeiro com o evento ao vivo
  // de T+40 s e era descartado; o de T+40 s (o eco de verdade) era reenviado.
  for (const janelaMs of [undefined, 60 * 1000]) {
    const eco = criarMemoriaDeEco(janelaMs ? { janelaMs } : {});
    eco.registrarAoVivo(1, 'morador_42', T0 + s(40));
    const antigo = reg('morador_42', T0, 101);
    const recente = reg('morador_42', T0 + s(40), 102);
    const { ecos, reais } = eco.separarEcos(1, [antigo, recente], T0 + s(45));
    assert.deepEqual(ecos, [recente], `janela ${janelaMs}`);
    assert.deepEqual(reais, [antigo], `janela ${janelaMs}`);
  }
});

test('I2: cada evento ao vivo casa com o registro mais PRÓXIMO da lista, não com o primeiro que aparece', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'p', T0 + s(10));
  const longe = reg('p', T0, 1); // a 10 s
  const perto = reg('p', T0 + s(11), 2); // a 1 s
  const depois = reg('p', T0 + s(22), 3); // a 12 s
  const { ecos, reais } = eco.separarEcos(1, [longe, perto, depois], T0 + s(30));
  assert.deepEqual(ecos, [perto]);
  assert.deepEqual(reais, [longe, depois]);
});

test('I2: dois eventos ao vivo e três registros — os dois pares mais próximos casam, o que sobra é real', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'p', T0 + s(10));
  eco.registrarAoVivo(1, 'p', T0 + s(20));
  const a = reg('p', T0 + s(2), 1);
  const b = reg('p', T0 + s(11), 2);
  const c = reg('p', T0 + s(19), 3);
  const { ecos, reais } = eco.separarEcos(1, [a, b, c], T0 + s(30));
  assert.deepEqual(ecos, [b, c]);
  assert.deepEqual(reais, [a]);
});

test('I2: janela reduzida para 15 s — registro a 16 s do evento ao vivo é real (na dúvida, não descarta)', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'p', T0);
  assert.deepEqual(eco.separarEcos(1, [reg('p', T0 + s(16), 1)], T0 + s(20)).ecos, []);
  assert.equal(eco.separarEcos(1, [reg('p', T0 + s(15), 2)], T0 + s(20)).ecos.length, 1);
});

test('separarEcos(): registro relido (marca represada) continua eco sem gastar outro evento ao vivo; registro ilegível é real', () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'p', T0);
  eco.registrarAoVivo(1, 'p', T0 + s(10));
  const agora = T0 + s(30);
  const r7 = reg('p', T0, 7);
  assert.deepEqual(eco.separarEcos(1, [r7], agora).ecos, [r7]);
  const r8 = reg('p', T0 + s(9), 8);
  const r9 = reg('p', T0 + s(12), 9);
  const ruim = reg('p', NaN, 10);
  const { ecos, reais } = eco.separarEcos(1, [r7, r8, r9, ruim, null], agora);
  assert.deepEqual(ecos, [r7, r8]);
  assert.deepEqual(reais, [r9, ruim, null]);
});

test('I1: evento ao vivo chega DURANTE a busca do avanço de marca (T+1,5 s) — não fica órfão; registro real em T+41,5 s não é eco', async () => {
  // A leitura do log começou em T e terminou em T+2 s. Um evento ao vivo
  // entrou em T+1,5 s (o registro dele já estava no log lido → ficou sob a
  // marca nova e nunca volta num replay). Antes, a limpeza usava o instante
  // do INÍCIO da busca (T): o evento sobrava na memória e consumia a próxima
  // passagem real da mesma pessoa.
  const eco = criarMemoriaDeEco({ janelaMs: 60 * 1000 }); // janela larga: o defeito não pode depender dela
  const relogio = { t: T0 };
  const marcas = new Map([[1, 100]]);
  const mudou = await avancarMarcaCobrindoEco({
    eco,
    deviceId: 1,
    lerMarca: () => marcas.get(1),
    agora: () => relogio.t,
    avancar: async () => {
      relogio.t = T0 + s(1.5);
      eco.registrarAoVivo(1, 'morador_42', relogio.t);
      marcas.set(1, 101);
      relogio.t = T0 + s(2); // fim da busca
    },
  });
  assert.equal(mudou, true);
  assert.equal(eco.tamanho(1), 0, 'o que chegou até o FIM da busca saiu da memória');
  const real = reg('morador_42', T0 + s(41.5), 102);
  assert.deepEqual(eco.separarEcos(1, [real], T0 + s(50)), { ecos: [], reais: [real] });
  // E com a janela padrão, uma passagem real a poucos segundos também não some.
  const real2 = reg('morador_42', T0 + s(9), 103);
  assert.deepEqual(eco.separarEcos(1, [real2], T0 + s(50)).reais, [real2]);
});

test('I1: avanço que NÃO mudou a marca (ou falhou, ou com replay em curso) não limpa a memória', async () => {
  const eco = criarMemoriaDeEco();
  eco.registrarAoVivo(1, 'p', T0);
  const base = { eco, deviceId: 1, agora: () => T0 + s(5) };
  // Marca igual.
  assert.equal(await avancarMarcaCobrindoEco({ ...base, lerMarca: () => 7, avancar: async () => {} }), false);
  // Sem marca (aparelho nunca teve baseline).
  assert.equal(await avancarMarcaCobrindoEco({ ...base, lerMarca: () => undefined, avancar: async () => {} }), false);
  // Replay em curso: quem limpa é ele.
  let m = 7;
  assert.equal(
    await avancarMarcaCobrindoEco({ ...base, lerMarca: () => m, avancar: async () => { m = 8; }, ocupado: () => true }),
    false,
  );
  // Driver lançou: não rejeita e não limpa.
  assert.equal(
    await avancarMarcaCobrindoEco({ ...base, lerMarca: () => m, avancar: async () => { throw new Error('timeout'); } }),
    false,
  );
  assert.equal(eco.tamanho(1), 1);
});

test('I1: evento registrado DEPOIS, mas recebido antes do instante já coberto pela marca, não entra na memória', () => {
  // O registro na memória agora acontece depois da resposta da nuvem (I3):
  // se nesse meio tempo a marca d'água cobriu aquele instante, o evento não
  // volta mais num replay — guardá-lo só serviria para consumir uma passagem nova.
  const eco = criarMemoriaDeEco();
  eco.cobrirAte(1, T0 + s(2));
  eco.registrarAoVivo(1, 'p', T0 + s(1));
  assert.equal(eco.tamanho(1), 0);
  eco.registrarAoVivo(1, 'p', T0 + s(3));
  assert.equal(eco.tamanho(1), 1, 'o que chegou depois do instante coberto entra normalmente');
  eco.registrarAoVivo(2, 'p', T0 + s(1));
  assert.equal(eco.tamanho(2), 1, 'a cobertura é por aparelho');
});

test('I3: evento RECUSADO de vez pela nuvem não entra na memória de eco — o replay o trata como real', () => {
  const eco = criarMemoriaDeEco();
  const entrou = eco.registrarAposEnvio(1, 'morador_42', T0, { aceito: false, enfileirado: false });
  assert.equal(entrou, false);
  assert.equal(eco.tamanho(1), 0);
  const r = reg('morador_42', T0 + s(1), 101);
  assert.deepEqual(eco.separarEcos(1, [r], T0 + s(5)), { ecos: [], reais: [r] });
});

test('I3: evento ACEITO pela nuvem, ou guardado na fila offline (entrega garantida), entra na memória', () => {
  const eco = criarMemoriaDeEco();
  assert.equal(eco.registrarAposEnvio(1, 'a', T0, { aceito: true, enfileirado: false }), true);
  assert.equal(eco.registrarAposEnvio(1, 'b', T0, { aceito: false, enfileirado: true }), true);
  assert.equal(eco.registrarAposEnvio(1, 'c', T0), false, 'sem desfecho conhecido, não registra');
  assert.equal(eco.tamanho(1), 2);
  const ra = reg('a', T0, 1);
  const rb = reg('b', T0, 2);
  const rc = reg('c', T0, 3);
  assert.deepEqual(eco.separarEcos(1, [ra, rb, rc], T0 + s(1)), { ecos: [ra, rb], reais: [rc] });
});
