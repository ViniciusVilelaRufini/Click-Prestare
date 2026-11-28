import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarChamada } from '../src/chamada.js';

function relogioFalso(inicio = 1_000_000) {
  const r = () => r.agora;
  r.agora = inicio;
  r.avancar = (s) => { r.agora += s * 1000; };
  return r;
}

function facial(extra = {}) {
  const relogio = relogioFalso();
  const c = criarChamada({ id: 9, tipo: 'facial_unidade', toqueS: 30, toquePortariaS: 45,
    canalOrigem: 'fac', monitores: ['mon-5'], relogio, ...extra });
  return { c, relogio };
}

const nomes = (acoes) => acoes.map((a) => a.acao);

test('iniciar toca de volta, agenda o toque e liga os monitores', () => {
  const { c } = facial();
  assert.equal(c.estado, 'chamando');
  assert.deepEqual(c.iniciar(), [
    { acao: 'tocar_origem' },
    { acao: 'agendar', nome: 'toque', s: 30 },
    { acao: 'ligar_monitor', conta: 'mon-5' },
  ]);
  assert.deepEqual(c.iniciar(), [], 'iniciar só uma vez');
});

test('primeiro que entra leva: atende a origem, faz a ponte e avisa a API', () => {
  const { c } = facial();
  c.iniciar();
  const acoes = c.entrou({ papel: 'morador', uid: 42, canal: 'app1' });
  assert.deepEqual(acoes, [
    { acao: 'atender_origem' },
    { acao: 'atender_canal', canal: 'app1' },
    { acao: 'ponte', canais: ['fac', 'app1'] },
    { acao: 'cancelar_toques' },
    { acao: 'desligar_monitores' },
    { acao: 'evento', evento: 'atendida', papel: 'morador', uid: 42 },
    { acao: 'agendar', nome: 'aviso', s: 150 },
    { acao: 'agendar', nome: 'fim', s: 180 },
  ]);
  assert.equal(c.estado, 'atendida');
  assert.equal(c.canalAtendido, 'app1');
});

test('segundo que entra é recusado', () => {
  const { c } = facial();
  c.iniciar();
  c.entrou({ papel: 'morador', uid: 42, canal: 'app1' });
  assert.deepEqual(c.entrou({ papel: 'portaria', uid: 3, canal: 'web1' }), [{ acao: 'recusar_canal', canal: 'web1' }]);
  assert.equal(c.canalAtendido, 'app1');
});

test('monitor que atende entra como participante sem atender o próprio canal', () => {
  const { c } = facial();
  c.iniciar();
  const acoes = c.monitorAtendeu('mon-5', 'm1');
  assert.deepEqual(nomes(acoes).slice(0, 3), ['atender_origem', 'ponte', 'cancelar_toques']);
  assert.deepEqual(acoes.find((a) => a.acao === 'evento'), { acao: 'evento', evento: 'atendida', papel: 'monitor', uid: 5 });
});

test('toque esgotado pergunta à API; portaria agenda o toque da portaria', () => {
  const { c } = facial();
  c.iniciar();
  assert.deepEqual(c.expirou('toque'), [{ acao: 'evento', evento: 'toque_esgotado' }]);
  assert.deepEqual(c.resposta('portaria'), [{ acao: 'agendar', nome: 'toque_portaria', s: 45 }]);
  assert.equal(c.estado, 'portaria');
  assert.deepEqual(c.resposta('portaria'), [], 'resposta repetida não faz nada');
});

test('toque esgotado e API manda encerrar: mensagem, desliga e registra não atendida', () => {
  const { c } = facial();
  c.iniciar();
  c.expirou('toque');
  assert.deepEqual(c.resposta('encerrar'), [
    { acao: 'tocar_mensagem', som: 'ninguem-atendeu' },
    { acao: 'desligar_tudo' },
    { acao: 'evento', evento: 'encerrada', resultado: 'nao_atendida', duracao_s: 0 },
  ]);
  assert.equal(c.estado, 'encerrada');
});

test('resposta sem toque esgotado pendente é ignorada', () => {
  const { c } = facial();
  c.iniciar();
  assert.deepEqual(c.resposta('encerrar'), []);
  assert.equal(c.estado, 'chamando');
});

test('toque da portaria esgotado encerra como não atendida', () => {
  const { c } = facial();
  c.iniciar();
  c.expirou('toque');
  c.resposta('portaria');
  const acoes = c.expirou('toque_portaria');
  assert.deepEqual(nomes(acoes), ['tocar_mensagem', 'desligar_tudo', 'evento']);
  assert.equal(acoes[2].resultado, 'nao_atendida');
});

test('portaria atende depois da transferência', () => {
  const { c } = facial();
  c.iniciar();
  c.expirou('toque');
  c.resposta('portaria');
  const acoes = c.entrou({ papel: 'portaria', uid: 3, canal: 'web1' });
  assert.ok(nomes(acoes).includes('ponte'));
  assert.equal(c.estado, 'atendida');
});

test('origem desliga durante o toque: cancelada', () => {
  const { c } = facial();
  c.iniciar();
  assert.deepEqual(c.origemDesligou(), [
    { acao: 'desligar_tudo' },
    { acao: 'evento', evento: 'encerrada', resultado: 'cancelada', duracao_s: 0 },
  ]);
  assert.equal(c.estado, 'encerrada');
  assert.deepEqual(c.origemDesligou(), []);
});

test('origem desliga na conversa: resultado conforme quem atendeu, com duração', () => {
  const { c, relogio } = facial();
  c.iniciar();
  c.forcarPortaria();
  c.entrou({ papel: 'portaria', uid: 3, canal: 'web1' });
  relogio.avancar(42);
  assert.deepEqual(c.origemDesligou(), [
    { acao: 'desligar_tudo' },
    { acao: 'evento', evento: 'encerrada', resultado: 'atendida_portaria', duracao_s: 42 },
  ]);
});

test('participante desliga encerra; outro canal desligando não', () => {
  const { c, relogio } = facial();
  c.iniciar();
  c.entrou({ papel: 'morador', uid: 42, canal: 'app1' });
  assert.deepEqual(c.participanteDesligou('outro'), []);
  relogio.avancar(10);
  const acoes = c.participanteDesligou('app1');
  assert.deepEqual(acoes.at(-1), { acao: 'evento', evento: 'encerrada', resultado: 'atendida_morador', duracao_s: 10 });
});

test('toque expirando depois de atendida não faz nada', () => {
  const { c } = facial();
  c.iniciar();
  c.entrou({ papel: 'morador', uid: 42, canal: 'app1' });
  assert.deepEqual(c.expirou('toque'), []);
  assert.deepEqual(c.expirou('toque_portaria'), []);
  assert.deepEqual(c.resposta('encerrar'), []);
});

test('aviso aos 150 s toca o bipe na ponte e fim aos 180 s encerra', () => {
  const { c, relogio } = facial();
  c.iniciar();
  c.entrou({ papel: 'morador', uid: 42, canal: 'app1' });
  assert.deepEqual(c.expirou('aviso'), [{ acao: 'tocar_mensagem_ponte', som: 'beep' }]);
  relogio.avancar(180);
  assert.deepEqual(c.expirou('fim'), [
    { acao: 'desligar_tudo' },
    { acao: 'evento', evento: 'encerrada', resultado: 'atendida_morador', duracao_s: 180 },
  ]);
});

test('forcarPortaria (controle) só vale enquanto chama', () => {
  const { c } = facial();
  c.iniciar();
  assert.deepEqual(c.forcarPortaria(), [{ acao: 'agendar', nome: 'toque_portaria', s: 45 }]);
  assert.equal(c.estado, 'portaria');
  assert.deepEqual(c.forcarPortaria(), []);
  assert.deepEqual(c.expirou('toque'), [], 'toque do apartamento já não vale');
  assert.deepEqual(c.resposta('encerrar'), [], 'resposta tardia não muda nada');
});

test('forcarPortaria com toque esgotado pendente ganha da resposta tardia', () => {
  const { c } = facial();
  c.iniciar();
  c.expirou('toque');
  assert.equal(nomes(c.forcarPortaria())[0], 'agendar');
  assert.deepEqual(c.resposta('encerrar'), []);
  assert.equal(c.estado, 'portaria');
});

test('nada acontece depois de encerrada, e quem entra é recusado', () => {
  const { c } = facial();
  c.iniciar();
  c.origemDesligou();
  assert.deepEqual(c.expirou('toque'), []);
  assert.deepEqual(c.forcarPortaria(), []);
  assert.deepEqual(c.encerrar(), []);
  assert.deepEqual(c.falhou(), []);
  assert.deepEqual(c.expirou('aviso'), []);
  assert.deepEqual(c.monitorAtendeu('mon-5', 'm1'), [{ acao: 'recusar_canal', canal: 'm1' }]);
  assert.deepEqual(c.entrou({ papel: 'morador', uid: 1, canal: 'x' }), [{ acao: 'recusar_canal', canal: 'x' }]);
});

test('encerrar pelo controle: sem atender vira não atendida (facial), atendida mantém o resultado', () => {
  const { c } = facial();
  c.iniciar();
  assert.deepEqual(c.encerrar(), [
    { acao: 'desligar_tudo' },
    { acao: 'evento', evento: 'encerrada', resultado: 'nao_atendida', duracao_s: 0 },
  ]);
  const { c: d } = facial();
  d.iniciar();
  d.forcarPortaria();
  d.entrou({ papel: 'portaria', uid: 3, canal: 'web1' });
  assert.equal(d.encerrar().at(-1).resultado, 'atendida_portaria');
});

test('falhou registra falha', () => {
  const { c } = facial();
  c.iniciar();
  c.entrou({ papel: 'morador', uid: 42, canal: 'app1' });
  const acoes = c.falhou();
  assert.equal(acoes.at(-1).resultado, 'falha');
  assert.equal(c.estado, 'encerrada');
});

test('unidade_portaria começa em portaria e o toque esgotado encerra direto, sem mensagem', () => {
  const c = criarChamada({ id: 1, tipo: 'unidade_portaria', toqueS: 45, toquePortariaS: 45, canalOrigem: 'app', relogio: relogioFalso() });
  assert.equal(c.estado, 'portaria');
  assert.deepEqual(c.iniciar(), [{ acao: 'tocar_origem' }, { acao: 'agendar', nome: 'toque_portaria', s: 45 }]);
  assert.deepEqual(c.expirou('toque_portaria'), [
    { acao: 'desligar_tudo' },
    { acao: 'evento', evento: 'encerrada', resultado: 'nao_atendida', duracao_s: 0 },
  ]);
});

test('unidade_portaria atendida pela portaria', () => {
  const c = criarChamada({ id: 1, tipo: 'unidade_portaria', toqueS: 45, toquePortariaS: 45, canalOrigem: 'app', relogio: relogioFalso() });
  c.iniciar();
  const acoes = c.entrou({ papel: 'portaria', uid: 3, canal: 'web' });
  assert.deepEqual(acoes.find((a) => a.acao === 'ponte'), { acao: 'ponte', canais: ['app', 'web'] });
  assert.equal(c.origemDesligou().at(-1).resultado, 'atendida_portaria');
});

test('portaria_unidade: toque esgotado encerra sem transferir e sem mensagem; encerrar sem atender é cancelada', () => {
  const c = criarChamada({ id: 2, tipo: 'portaria_unidade', toqueS: 30, toquePortariaS: 45, canalOrigem: 'web', monitores: ['mon-1'], relogio: relogioFalso() });
  assert.equal(c.estado, 'chamando');
  assert.deepEqual(nomes(c.iniciar()), ['tocar_origem', 'agendar', 'ligar_monitor']);
  assert.deepEqual(c.expirou('toque'), [
    { acao: 'desligar_tudo' },
    { acao: 'evento', evento: 'encerrada', resultado: 'nao_atendida', duracao_s: 0 },
  ]);
  const d = criarChamada({ id: 3, tipo: 'portaria_unidade', toqueS: 30, toquePortariaS: 45, canalOrigem: 'web', relogio: relogioFalso() });
  d.iniciar();
  assert.equal(d.encerrar().at(-1).resultado, 'cancelada');
});

test('tipo desconhecido é recusado', () => {
  assert.throws(() => criarChamada({ id: 1, tipo: 'x', toqueS: 30, canalOrigem: 'a' }));
});

test('M3: morador só entra com a chamada tocando no apartamento (chamando)', () => {
  const { c } = facial();
  c.iniciar();
  c.expirou('toque');
  c.resposta('portaria');
  assert.equal(c.estado, 'portaria');
  // Token pego antes da transferência; o INVITE chegou depois: não atende mais.
  assert.deepEqual(c.entrou({ papel: 'morador', uid: 42, canal: 'app1' }), [{ acao: 'recusar_canal', canal: 'app1' }]);
  assert.equal(c.estado, 'portaria');
  assert.equal(c.canalAtendido, null);
  // O porteiro continua podendo atender.
  assert.ok(nomes(c.entrou({ papel: 'portaria', uid: 3, canal: 'web1' })).includes('ponte'));
  assert.equal(c.papelAtendido, 'portaria');
});

test('M3: portaria só entra com a chamada na portaria', () => {
  const { c } = facial();
  c.iniciar();
  assert.deepEqual(c.entrou({ papel: 'portaria', uid: 3, canal: 'web1' }), [{ acao: 'recusar_canal', canal: 'web1' }]);
  assert.equal(c.estado, 'chamando');
  assert.ok(nomes(c.entrou({ papel: 'morador', uid: 42, canal: 'app1' })).includes('ponte'));

  const p = criarChamada({ id: 2, tipo: 'portaria_unidade', toqueS: 30, toquePortariaS: 45, canalOrigem: 'web', relogio: relogioFalso() });
  p.iniciar();
  assert.deepEqual(p.entrou({ papel: 'portaria', uid: 3, canal: 'web2' }), [{ acao: 'recusar_canal', canal: 'web2' }]);
  assert.ok(nomes(p.entrou({ papel: 'morador', uid: 42, canal: 'app1' })).includes('ponte'));

  const u = criarChamada({ id: 3, tipo: 'unidade_portaria', toqueS: 45, toquePortariaS: 45, canalOrigem: 'app', relogio: relogioFalso() });
  u.iniciar();
  assert.deepEqual(u.entrou({ papel: 'morador', uid: 9, canal: 'app2' }), [{ acao: 'recusar_canal', canal: 'app2' }]);
  assert.ok(nomes(u.entrou({ papel: 'portaria', uid: 3, canal: 'web' })).includes('ponte'));
});
