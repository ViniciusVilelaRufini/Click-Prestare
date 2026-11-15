import { criarBancoFalso } from './guarita-banco-falso.testutil';
import { GuaritaOperacoesService } from './guarita-operacoes.service';
import { GuaritaAgenteService } from './guarita-agente.service';
import { GuaritaImportacaoService } from './guarita-importacao.service';
import { codificarDispositivo, decodificarDispositivo } from './guarita-frame.util';

/**
 * Revisão final integrada: as reproduções do revisor (lote com duas gravações
 * da mesma tag, reimportação que adota outra unidade, cadastro sem resposta),
 * rodando contra uma imitação mínima do agente que CONFERE o `esperado` antes
 * de escrever, como o driver real.
 */

const DEV = { id: 10, id_condominio: 7, nome: 'Guarita' };
const fr = (unidade: number, bloco: string, rotulo = 'ANA') =>
  codificarDispositivo({ tipo: 3, serialHex: '0F086E', contador: 0, unidade, bloco, rotulo, marca: 6, cor: 10, placa: 'ABC1D23', grupo: 0, receptores: 0xff });

function montar() {
  const db = criarBancoFalso();
  db.semear('facial_Devices', [{ id: 10, id_condominio: 7, nome: 'Guarita', tipo: 'guarita', fabricante: 'linear', ativo: 1 }]);
  db.semear('guarita_Backups', [{ id_condominio: 7, id_device: 10, motivo: 'importacao', total: 0, dados: '[]' }]);
  db.semear('apartamentos', [{ id: 1, id_condominio: 7, bloco: 'B', apto: '308' }, { id: 2, id_condominio: 7, bloco: 'B', apto: '202' }]);
  db.semear('moradores', [{ id: 50, id_condominio: 7, nome: 'Ana Souza', bloco: 'B', apartamento: '308', id_user: 500 }]);
  db.semear('tags', [{ id: 1, id_condominio: 7, codigo: 'G3-0F086E', tipo: 'cartao', id_device: 10, guarita_tipo: 3, guarita_serial: '0F086E', guarita_estado: 'ativo', guarita_frame: fr(308, 'B') }]);
  db.semear('veiculos', [{ id: 70, id_condominio: 7, id_morador: 50, placa: 'ABC1D23', cor: 'Prata', marca_modelo: 'Fiat Uno', id_tag: 1, ativo: 1 }]);
  const ops = new GuaritaOperacoesService(db as any);
  const imp = new GuaritaImportacaoService(db as any, ops);
  const agente = new GuaritaAgenteService(db as any, {} as any, imp, ops);
  // "Guarita" simulado: serial → frame gravado.
  const guarita = new Map<string, string>([['0F086E', fr(308, 'B')]]);
  return { db, ops, imp, agente, guarita };
}
const tag = (db: any) => db.linhas('tags').find((t: any) => t.id === 1);
const ops = (db: any, tipo: string) => db.linhas('guarita_Operacoes').filter((o: any) => o.tipo === tipo);

/** Imitação do driver: pede um lote, executa na ordem conferindo o `esperado` como o agente real, devolve os resultados. */
async function rodarAgente(m: ReturnType<typeof montar>) {
  let rodou = 0;
  for (let volta = 0; volta < 10; volta++) {
    const { operacoes } = await m.agente.buscarOperacoes(DEV);
    if (!operacoes.length) return rodou;
    for (const op of operacoes) {
      rodou++;
      if (op.tipo === 'atualizar_receptores') {
        await m.agente.registrarResultado(DEV, op.id, { ok: true, codigo: 0 });
        continue;
      }
      const atual = m.guarita.get('0F086E');
      const lido = atual ? decodificarDispositivo(atual) : null;
      const blocoByte = lido ? (lido.bloco === 'B' ? 1 : lido.bloco.charCodeAt(0) - 65) : 0;
      if ((op.tipo === 'editar' || op.tipo === 'apagar') && lido && op.esperado &&
          (lido.unidade !== op.esperado.unidade || blocoByte !== op.esperado.bloco)) {
        await m.agente.registrarResultado(DEV, op.id, { ok: false, conflito: true, lido: { unidade: lido.unidade, bloco: blocoByte }, erro: 'outra unidade' });
        continue;
      }
      if (op.tipo === 'editar') m.guarita.set('0F086E', op.frame_hex as string);
      if (op.tipo === 'apagar') m.guarita.delete('0F086E');
      await m.agente.registrarResultado(DEV, op.id, { ok: true, codigo: 0 });
    }
  }
  return rodou;
}

describe('I1 — reimportação não adota a unidade nova de uma tag controlada', () => {
  async function importar(m: ReturnType<typeof montar>, frames: string[], tipo: 'importar' | 'conferir' = 'importar') {
    const op = await m.db.guarita_Operacoes.create({ data: { id_condominio: 7, id_device: 10, tipo, estado: 'enviada', enviada_em: new Date() } });
    await m.imp.receberResultado(DEV as any, op, { ok: true, frames_hex: frames, parte: 1, fim: true });
  }

  it('Ana/Bruno: o teclado passou o cartão para o 202; a importação marca conflito e o cartão do Bruno não recebe apagar', async () => {
    const m = montar();
    m.guarita.set('0F086E', fr(202, 'B', 'BRUNO'));
    await importar(m, [fr(202, 'B', 'BRUNO')]);
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'conflito', guarita_erro: 'O Guarita mostra este dispositivo em outra unidade.' });
    expect(tag(m.db).guarita_frame).toBe(fr(308, 'B')); // o frame do Prestare ficou
    expect(m.db.linhas('guarita_Alertas').map((a: any) => a.tipo)).toEqual(['dispositivo_em_outra_unidade']);
    // A Ana sai.
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(false);
    await rodarAgente(m);
    expect(ops(m.db, 'apagar')).toHaveLength(0);
    expect(m.guarita.has('0F086E')).toBe(true);
  });

  it('ausente que volta em outra unidade também é conflito; na mesma unidade volta a ativo', async () => {
    const m = montar();
    tag(m.db).guarita_estado = 'ausente';
    await importar(m, [fr(202, 'B', 'BRUNO')], 'conferir');
    expect(tag(m.db).guarita_estado).toBe('conflito');
    const m2 = montar();
    tag(m2.db).guarita_estado = 'ausente';
    await importar(m2, [fr(308, 'B', 'ANA')], 'conferir');
    expect(tag(m2.db).guarita_estado).toBe('ativo');
  });
});

describe('I2 — gravação sem resposta é incerta', () => {
  it('cadastro incerto: estado incerto, o cadastro volta uma vez; morador sai → apagar com a unidade pedida', async () => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'a_vincular', guarita_frame: null });
    m.guarita.delete('0F086E');
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    await m.agente.buscarOperacoes(DEV);
    await m.agente.registrarResultado(DEV, id_operacao, { ok: false, incerto: true, erro: 'O Guarita não respondeu.' });
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'incerto', guarita_erro: 'O Guarita não respondeu. Use Regravar para conferir.' });
    expect(ops(m.db, 'cadastrar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1);
    // Morador sai com a tag incerta: o cadastro repetido é cancelado e sai apagar com a unidade pedida.
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(true);
    // fecha o 29 pendente do lote anterior
    for (const o of m.db.linhas('guarita_Operacoes')) if (o.estado === 'enviada') o.estado = 'ok';
    const lote = await m.agente.buscarOperacoes(DEV);
    expect(lote.operacoes.find((o) => o.tipo === 'apagar')).toMatchObject({ esperado: { unidade: 308, bloco: 1 } });
  });

  it('R4: "não foi gravado" conferido pelo agente (ok:false sem incerto) é falhou, com o erro', async () => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'a_vincular', guarita_frame: null });
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    await m.agente.buscarOperacoes(DEV);
    await m.agente.registrarResultado(DEV, id_operacao, { ok: false, erro: 'O Guarita não respondeu e o dispositivo não foi gravado.' });
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'falhou', guarita_erro: 'O Guarita não respondeu e o dispositivo não foi gravado.' });
  });

  it('R5: o cadastro reenfileirado sai com o frame ATUAL (o morador mudou de unidade no meio)', async () => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'a_vincular', guarita_frame: null });
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    await m.agente.buscarOperacoes(DEV);
    await m.agente.registrarResultado(DEV, id_operacao, { ok: false, incerto: true });
    m.db.linhas('moradores')[0].apartamento = '202';
    for (const o of m.db.linhas('guarita_Operacoes')) if (o.estado === 'enviada') o.estado = 'ok';
    const lote = await m.agente.buscarOperacoes(DEV);
    const repetido = lote.operacoes.find((o) => o.tipo === 'cadastrar')!;
    expect(repetido.frame_hex!.slice(12, 18)).toBe('020201');
  });

  it('segundo cadastro incerto não volta de novo à fila (uma vez só)', async () => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'a_vincular', guarita_frame: null });
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    await m.agente.buscarOperacoes(DEV);
    await m.agente.registrarResultado(DEV, id_operacao, { ok: false, incerto: true });
    for (const o of m.db.linhas('guarita_Operacoes')) if (o.estado === 'enviada') o.estado = 'ok';
    const lote = await m.agente.buscarOperacoes(DEV);
    const repetido = lote.operacoes.find((o) => o.tipo === 'cadastrar')!;
    await m.agente.registrarResultado(DEV, repetido.id, { ok: false, incerto: true });
    expect(ops(m.db, 'cadastrar').filter((o: any) => o.estado === 'pendente')).toHaveLength(0);
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'incerto', guarita_erro: 'O Guarita não respondeu. Use Regravar para conferir.' });
  });

  it('apagar incerto: continua removendo, alerta, e volta à fila', async () => {
    const m = montar();
    await m.ops.enfileirarRemocao(1, 'x');
    const lote = await m.agente.buscarOperacoes(DEV);
    const ap = lote.operacoes.find((o) => o.tipo === 'apagar')!;
    await m.agente.registrarResultado(DEV, ap.id, { ok: false, incerto: true });
    expect(tag(m.db).guarita_estado).toBe('removendo');
    expect(m.db.linhas('guarita_Alertas').map((a: any) => a.tipo)).toContain('remocao_pendente');
    expect(ops(m.db, 'apagar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1);
  });
});

describe('ja_estava mais estrito (cadastrar)', () => {
  async function cadastroEntregue() {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'a_vincular', guarita_frame: null });
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    await m.agente.buscarOperacoes(DEV);
    const pedido = ops(m.db, 'cadastrar')[0].frame_hex as string;
    return { m, id_operacao, pedido };
  }

  it('com o frame lido do mesmo dispositivo e unidade: ok, e o frame confirmado é o LIDO', async () => {
    const { m, id_operacao, pedido } = await cadastroEntregue();
    const lido = pedido.slice(0, 18) + '05' + pedido.slice(20); // grupo diferente no Guarita
    await m.agente.registrarResultado(DEV, id_operacao, { ok: true, codigo: 2, ja_estava: true, lido: { unidade: 308, bloco: 1, frame_hex: lido } });
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'gravado', guarita_frame: lido });
  });

  it('sem o frame lido: incerto', async () => {
    const { m, id_operacao } = await cadastroEntregue();
    await m.agente.registrarResultado(DEV, id_operacao, { ok: true, codigo: 2, ja_estava: true });
    expect(tag(m.db).guarita_estado).toBe('incerto');
  });

  it('frame lido em outra unidade: conflito', async () => {
    const { m, id_operacao, pedido } = await cadastroEntregue();
    const lido = pedido.slice(0, 12) + '020201' + pedido.slice(18);
    await m.agente.registrarResultado(DEV, id_operacao, { ok: true, codigo: 2, ja_estava: true, lido: { frame_hex: lido } });
    expect(tag(m.db).guarita_estado).toBe('conflito');
    expect(tag(m.db).guarita_erro).toMatch(/unidade 202 bloco B/);
  });
});

describe('remoção que esgota as tentativas', () => {
  it('depois de 5 apagar falhos: remocao_falhou, alerta novo aberto, e "remover de novo" põe um apagar na fila', async () => {
    const m = montar();
    await m.ops.enfileirarRemocao(1, 'x');
    for (let i = 0; i < 5; i++) {
      for (const o of m.db.linhas('guarita_Operacoes')) if (o.estado === 'enviada' && o.tipo === 'atualizar_receptores') o.estado = 'ok';
      const ap = (await m.agente.buscarOperacoes(DEV)).operacoes.find((o) => o.tipo === 'apagar');
      expect(ap).toBeDefined();
      await m.agente.registrarResultado(DEV, ap!.id, { ok: false, incerto: true });
    }
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'remocao_falhou' });
    expect(tag(m.db).guarita_erro).toMatch(/Remoção não confirmada depois de 5 tentativas/);
    const alertas = m.db.linhas('guarita_Alertas').filter((a: any) => a.tipo === 'remocao_pendente');
    expect(alertas.some((a: any) => /Remover de novo/.test(a.descricao))).toBe(true);
    expect(ops(m.db, 'apagar').filter((o: any) => o.estado === 'pendente')).toHaveLength(0);
    // Reconexão não tenta mais sozinha.
    await m.agente.registrarEstado(DEV, { conectado: false, autorizado: true });
    await m.agente.registrarEstado(DEV, { conectado: true, autorizado: true });
    expect(ops(m.db, 'apagar').filter((o: any) => o.estado === 'pendente')).toHaveLength(0);
    // Botão do console.
    await expect(m.ops.removerDeNovo(7, 10, 1, 'síndica')).resolves.toMatchObject({ estado: 'removendo' });
    expect(ops(m.db, 'apagar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1);
  });
});

describe('R7 — lido fora de faixa não derruba o resultado', () => {
  it('lido.unidade 12000 e bloco 999 são ignorados e o resto é processado', async () => {
    const m = montar();
    m.db.linhas('moradores')[0].apartamento = '202';
    const ed = (await m.ops.enfileirarEdicao(1, 'x'))!;
    await m.agente.buscarOperacoes(DEV);
    await expect(
      m.agente.registrarResultado(DEV, ed.id_operacao, { ok: true, codigo: 0, lido: { unidade: 12000, bloco: 999 } }),
    ).resolves.toEqual({ ok: true });
    expect(tag(m.db).guarita_estado).toBe('gravado');
    expect(m.agente.validarResultado({ ok: false, conflito: true, lido: { unidade: 12000, bloco: 1, frame_hex: 'zz' } })).toEqual({ ok: false, conflito: true });
  });
});

describe('R6/F2 — conflito de cadastro quando o morador sai', () => {
  it('cadastro entregue que voltou conflito: sai apagar com a unidade pedida; lá está outra → alerta, nada apagado', async () => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'a_vincular', guarita_frame: null });
    m.guarita.set('0F086E', fr(202, 'B', 'BRUNO'));
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    await m.agente.buscarOperacoes(DEV);
    await m.agente.registrarResultado(DEV, id_operacao, { ok: false, codigo: 2, erro: 'outra unidade' });
    expect(tag(m.db).guarita_estado).toBe('conflito');
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(true);
    for (const o of m.db.linhas('guarita_Operacoes')) if (o.estado === 'enviada') o.estado = 'ok';
    await rodarAgente(m);
    expect(m.guarita.get('0F086E')).toBe(fr(202, 'B', 'BRUNO')); // o do Bruno ficou
    expect(m.db.linhas('guarita_Alertas').filter((a: any) => a.tipo === 'remocao_pendente')).toHaveLength(1);
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'conflito' });
  });

  it('nenhuma gravação entregue (o cadastro nem saiu): desfaz só no Prestare, sem alerta e sem apagar', async () => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'a_vincular', guarita_frame: null });
    await m.ops.enfileirarCadastro(1, 'x');
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(false);
    expect(tag(m.db)).toBeUndefined();
    expect(ops(m.db, 'apagar')).toHaveLength(0);
    expect(m.db.linhas('guarita_Alertas')).toHaveLength(0);
  });
});

describe('F2 — conflito depois de cadastro incerto não se desfaz em silêncio', () => {
  async function cenarioDoRevisor(noGuarita: string | null) {
    const { TagsService } = require('../veiculos/tags.service');
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: null, guarita_frame: null });
    if (noGuarita) m.guarita.set('0F086E', noGuarita);
    else m.guarita.delete('0F086E');
    const fecha29 = async (l: any) => {
      for (const o of l.operacoes) if (o.tipo === 'atualizar_receptores') await m.agente.registrarResultado(DEV, o.id, { ok: true, codigo: 0 });
    };
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    const l1 = await m.agente.buscarOperacoes(DEV);
    await m.agente.registrarResultado(DEV, id_operacao, { ok: false, incerto: true });
    await fecha29(l1);
    m.db.linhas('moradores')[0].apartamento = '202';
    const l2 = await m.agente.buscarOperacoes(DEV);
    const c2 = l2.operacoes.find((o: any) => o.tipo === 'cadastrar')!;
    expect(c2.frame_hex!.slice(12, 18)).toBe('020201');
    await m.agente.registrarResultado(DEV, c2.id, { ok: false, codigo: 2, conflito: true, lido: { unidade: 308, bloco: 1, frame_hex: fr(308, 'B') }, erro: 'outra unidade' });
    await fecha29(l2);
    expect(tag(m.db).guarita_estado).toBe('conflito');
    const r = await new TagsService(m.db as any, m.ops).remove(7, 1);
    return { m, r };
  }

  it('cadastro 308 incerto → mora no 202 → recadastro dá conflito (lá está 308) → sai: apagar com esperado 308 confirmado', async () => {
    const { m, r } = await cenarioDoRevisor(fr(308, 'B'));
    expect(r).toEqual({ ok: true, guarita_remocoes: 1 });
    await rodarAgente(m);
    const apagar = ops(m.db, 'apagar');
    // a unidade mais recente primeiro (202, conflito), depois a anterior (308, ok)
    expect(apagar.map((o: any) => [decodificarDispositivo(o.frame_hex).unidade, o.estado])).toEqual([[202, 'falhou'], [308, 'ok']]);
    expect(m.guarita.has('0F086E')).toBe(false);
    expect(tag(m.db)).toBeUndefined();
  });

  it('o dispositivo está numa terceira unidade: nenhum apagar confirma → alerta remocao_pendente e a tag fica visível', async () => {
    const { m } = await cenarioDoRevisor(fr(101, 'B', 'CARLA'));
    await rodarAgente(m);
    expect(ops(m.db, 'apagar')).toHaveLength(2); // no máximo as duas últimas unidades
    expect(m.guarita.get('0F086E')).toBe(fr(101, 'B', 'CARLA'));
    expect(m.db.linhas('guarita_Alertas').filter((a: any) => a.tipo === 'remocao_pendente')).toHaveLength(1);
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'conflito' });
  });

  it('o apagar sai para o agente só com tipo + serial (o resto zerado), como antes', async () => {
    const { m } = await cenarioDoRevisor(fr(308, 'B'));
    const lote = await m.agente.buscarOperacoes(DEV);
    const ap = lote.operacoes.find((o: any) => o.tipo === 'apagar')!;
    expect(ap.frame_hex).toBe('300F086E' + '00'.repeat(35));
    expect(ap.esperado).toEqual({ unidade: 202, bloco: 1 });
  });

  it('cadastro entregue, morador sai com ele em voo e o resultado é falha: o apagar NÃO é cancelado', async () => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'a_vincular', guarita_frame: null });
    m.guarita.delete('0F086E');
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    await m.agente.buscarOperacoes(DEV);
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(true);
    await m.agente.registrarResultado(DEV, id_operacao, { ok: false, erro: 'O Guarita não respondeu e o dispositivo não foi gravado.' });
    expect(ops(m.db, 'apagar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1);
    expect(tag(m.db).guarita_estado).toBe('removendo');
  });
});

describe('R3 — editar que valeu, mesmo voltando incerto/conflito', () => {
  it.each([['incerto'], ['conflito']])('%s com lido.frame_hex = o enviado (fora o byte 30) → ok, frame guardado', async (como) => {
    const m = montar();
    m.db.linhas('moradores')[0].apartamento = '202';
    const ed = (await m.ops.enfileirarEdicao(1, 'x'))!;
    await m.agente.buscarOperacoes(DEV);
    const enviado = ops(m.db, 'editar')[0].frame_hex as string;
    const lido = enviado.slice(0, 58) + '8F' + enviado.slice(60); // byte 30 diferente (bateria/último acionamento)
    await m.agente.registrarResultado(DEV, ed.id_operacao, {
      ok: false,
      ...(como === 'incerto' ? { incerto: true } : { conflito: true }),
      lido: { unidade: 202, bloco: 1, frame_hex: lido },
    });
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'gravado', guarita_frame: lido });
    expect(ops(m.db, 'editar').filter((o: any) => o.estado === 'pendente')).toHaveLength(0);
  });
});

describe('N1 — tag em remoção nunca volta a ativo', () => {
  it('bloquear → remoção falha → editar placa: continua em remoção, alerta aberto, e a nova tentativa acontece', async () => {
    const { TagsService } = require('../veiculos/tags.service');
    const { VeiculosService } = require('../veiculos/veiculos.service');
    const m = montar();
    await new TagsService(m.db as any, m.ops).definirAtivo(7, 1, false);
    const l1 = await m.agente.buscarOperacoes(DEV);
    const ap = l1.operacoes.find((o) => o.tipo === 'apagar')!;
    await m.agente.registrarResultado(DEV, ap.id, { ok: false, codigo: 0xfe, erro: 'O Guarita recusou os dados do dispositivo.' });
    for (const o of l1.operacoes) if (o.tipo === 'atualizar_receptores') await m.agente.registrarResultado(DEV, o.id, { ok: true, codigo: 0 });
    expect(tag(m.db).guarita_estado).toBe('removendo');

    const v = new VeiculosService(m.db as any, m.ops);
    const upd = m.db.veiculos.update;
    m.db.veiculos.update = async (a: any) => Object.assign(await upd(a), { tag: tag(m.db) });
    await v.update(7, 70, { placa: 'XYZ9A87', id_tag: 1 } as any);
    expect(m.db.linhas('veiculos')[0].placa).toBe('XYZ9A87'); // o veículo foi salvo no Prestare
    expect(ops(m.db, 'editar')).toHaveLength(0);
    expect(tag(m.db).guarita_estado).toBe('removendo');
    expect(tag(m.db).guarita_erro).toMatch(/Remoção/);
    expect(m.db.linhas('guarita_Alertas').filter((a: any) => a.tipo === 'remocao_pendente' && !a.visto_em)).toHaveLength(1);

    // Reconexão: a nova tentativa de remoção sai.
    await m.agente.registrarEstado(DEV, { conectado: true, autorizado: true });
    expect(ops(m.db, 'apagar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1);
  });

  it.each(['removendo', 'remocao_falhou', 'conflito', 'incerto', 'ausente', 'recusada', 'aguardando_aprovacao'])(
    'tag %s: editar não entra na fila e o estado não muda',
    async (estado) => {
      const m = montar();
      tag(m.db).guarita_estado = estado;
      expect(await m.ops.enfileirarEdicao(1, 'x')).toBeNull();
      expect(ops(m.db, 'editar')).toHaveLength(0);
      expect(tag(m.db).guarita_estado).toBe(estado);
    },
  );
});

describe('F1 — nada tira uma tag da remoção', () => {
  const fecha29 = async (m: any, l: any) => {
    for (const o of l.operacoes) if (o.tipo === 'atualizar_receptores') await m.agente.registrarResultado(DEV, o.id, { ok: true, codigo: 0 });
  };

  it('editar em voo volta incerto no meio do bloqueio: não volta à fila; apagar falha; a tag continua em remoção', async () => {
    const { TagsService } = require('../veiculos/tags.service');
    const m = montar();
    m.db.linhas('veiculos')[0].placa = 'XYZ9A87';
    const ed = (await m.ops.enfileirarEdicao(1, 'x'))!;
    const l1 = await m.agente.buscarOperacoes(DEV);
    await new TagsService(m.db as any, m.ops).definirAtivo(7, 1, false);
    expect(tag(m.db).guarita_estado).toBe('removendo');
    await m.agente.registrarResultado(DEV, ed.id_operacao, { ok: false, incerto: true });
    expect(ops(m.db, 'editar').filter((o: any) => o.estado === 'pendente')).toHaveLength(0);
    await fecha29(m, l1);
    const l2 = await m.agente.buscarOperacoes(DEV);
    expect(l2.operacoes.map((o: any) => o.tipo)).toEqual(['apagar', 'atualizar_receptores']);
    const ap = l2.operacoes.find((o: any) => o.tipo === 'apagar')!;
    await m.agente.registrarResultado(DEV, ap.id, { ok: false, codigo: 0xfe, erro: 'recusou' });
    await fecha29(m, l2);
    const l3 = await m.agente.buscarOperacoes(DEV);
    expect(l3.operacoes.filter((o: any) => o.tipo === 'editar' || o.tipo === 'cadastrar')).toHaveLength(0);
    for (const o of l3.operacoes) await m.agente.registrarResultado(DEV, o.id, { ok: true, codigo: 0 });
    expect(tag(m.db).guarita_estado).toBe('removendo');
  });

  it.each(['removendo', 'remocao_falhou'])('ok de cadastrar/editar/29 numa tag %s só guarda o frame; o estado não muda', async (estado) => {
    const m = montar();
    m.db.linhas('veiculos')[0].placa = 'XYZ9A87';
    const ed = (await m.ops.enfileirarEdicao(1, 'x'))!;
    const l1 = await m.agente.buscarOperacoes(DEV);
    Object.assign(tag(m.db), { guarita_estado: estado, guarita_erro: 'Remoção: recusou' });
    await m.agente.registrarResultado(DEV, ed.id_operacao, { ok: true, codigo: 0 });
    await fecha29(m, l1);
    expect(tag(m.db)).toMatchObject({ guarita_estado: estado, guarita_erro: 'Remoção: recusou' });
    expect(decodificarDispositivo(tag(m.db).guarita_frame).placa).toBe('XYZ9A87');
    // A próxima remoção confere a unidade do frame confirmado.
    const frames = await m.ops.framesParaRemover(tag(m.db));
    expect(decodificarDispositivo(frames[0]).placa).toBe('XYZ9A87');
  });

  it.each(['removendo', 'remocao_falhou'])('cadastro incerto numa tag %s não volta à fila', async (estado) => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'a_vincular', guarita_frame: null });
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    await m.agente.buscarOperacoes(DEV);
    tag(m.db).guarita_estado = estado;
    await m.agente.registrarResultado(DEV, id_operacao, { ok: false, incerto: true });
    expect(ops(m.db, 'cadastrar').filter((o: any) => o.estado === 'pendente')).toHaveLength(0);
    expect(tag(m.db).guarita_estado).toBe(estado);
  });

  it('falha de editar numa tag em remoção não a tira da remoção', async () => {
    const m = montar();
    m.db.linhas('veiculos')[0].placa = 'XYZ9A87';
    const ed = (await m.ops.enfileirarEdicao(1, 'x'))!;
    await m.agente.buscarOperacoes(DEV);
    tag(m.db).guarita_estado = 'remocao_falhou';
    await m.agente.registrarResultado(DEV, ed.id_operacao, { ok: false, codigo: 0xfe, erro: 'recusou' });
    expect(tag(m.db).guarita_estado).toBe('remocao_falhou');
  });
});

describe('Regravar: saída para tag falhou ou incerto', () => {
  async function cadastroQueVolta(resultado: any) {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'a_vincular', guarita_frame: null });
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    const l1 = await m.agente.buscarOperacoes(DEV);
    await m.agente.registrarResultado(DEV, id_operacao, resultado);
    for (const o of l1.operacoes) if (o.tipo === 'atualizar_receptores') await m.agente.registrarResultado(DEV, o.id, { ok: true, codigo: 0 });
    return m;
  }

  it('falhou: monta o frame ATUAL e põe cadastrar na fila; editar o veículo sozinho não reenvia nada', async () => {
    const m = await cadastroQueVolta({ ok: false, codigo: 0xfe, erro: 'recusou' });
    expect(tag(m.db).guarita_estado).toBe('falhou');
    m.db.linhas('moradores')[0].apartamento = '202';
    expect(await m.ops.enfileirarEdicao(1, 'x')).toBeNull();
    expect(ops(m.db, 'cadastrar').filter((o: any) => o.estado === 'pendente')).toHaveLength(0);
    const r = await m.ops.regravar(7, 10, 1, 'síndica');
    expect(r).toMatchObject({ id_tag: 1, estado: 'pendente' });
    const nova = ops(m.db, 'cadastrar').find((o: any) => o.id === r.id_operacao);
    expect(nova).toMatchObject({ estado: 'pendente' });
    expect(nova.frame_hex.slice(12, 18)).toBe('020201');
  });

  it('incerto: regravar é uma conferência — sem duplicar o cadastro já na fila; ja_estava com o lido → gravado', async () => {
    const m = await cadastroQueVolta({ ok: false, incerto: true });
    expect(tag(m.db).guarita_estado).toBe('incerto');
    expect(ops(m.db, 'cadastrar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1);
    const r = await m.ops.regravar(7, 10, 1, 'síndica');
    expect(ops(m.db, 'cadastrar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1);
    const l = await m.agente.buscarOperacoes(DEV);
    const c = l.operacoes.find((o: any) => o.tipo === 'cadastrar')!;
    expect(c.id).toBe(r.id_operacao);
    await m.agente.registrarResultado(DEV, c.id, { ok: true, codigo: 2, ja_estava: true, lido: { unidade: 308, bloco: 1, frame_hex: c.frame_hex } });
    expect(tag(m.db).guarita_estado).toBe('gravado');
  });

  it('incerto depois do segundo incerto (nada na fila): regravar põe um cadastrar novo', async () => {
    const m = await cadastroQueVolta({ ok: false, incerto: true });
    const l = await m.agente.buscarOperacoes(DEV);
    await m.agente.registrarResultado(DEV, l.operacoes.find((o: any) => o.tipo === 'cadastrar')!.id, { ok: false, incerto: true });
    expect(ops(m.db, 'cadastrar').filter((o: any) => o.estado === 'pendente')).toHaveLength(0);
    for (const o of m.db.linhas('guarita_Operacoes')) if (o.estado === 'enviada') o.estado = 'ok';
    await m.ops.regravar(7, 10, 1, 'síndica');
    expect(ops(m.db, 'cadastrar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1);
  });

  it('gravação em andamento → 400; tag ativo ou pendente → 400', async () => {
    const m = await cadastroQueVolta({ ok: false, incerto: true });
    await m.agente.buscarOperacoes(DEV); // o cadastro repetido está em voo
    expect(tag(m.db).guarita_estado).toBe('incerto');
    await expect(m.ops.regravar(7, 10, 1, 'síndica')).rejects.toThrow('Este dispositivo já tem uma gravação em andamento no Guarita.');
    const m2 = montar();
    await expect(m2.ops.regravar(7, 10, 1, 'síndica')).rejects.toThrow(/Só dá para regravar/);
    tag(m2.db).guarita_estado = 'pendente';
    await expect(m2.ops.regravar(7, 10, 1, 'síndica')).rejects.toThrow(/Só dá para regravar/);
  });
});

describe('Tag com operação pendente no Guarita não é livre para vincular', () => {
  const BLOQUEADOS = ['remocao_falhou', 'removendo', 'incerto', 'conflito'];

  it('GET tags?livres=true esconde remocao_falhou, removendo, incerto, conflito (e ausente)', async () => {
    const { TagsService } = require('../veiculos/tags.service');
    const db = criarBancoFalso();
    const estados = [...BLOQUEADOS, 'ausente', 'ativo', 'a_vincular', null];
    db.semear('tags', estados.map((e, i) => ({ id: i + 1, id_condominio: 7, codigo: `T${i}`, ativo: 1, id_device: e ? 10 : null, guarita_estado: e })));
    const findMany = db.tags.findMany;
    db.tags.findMany = async (a: any) => {
      const { veiculos: _v, ...where } = a.where; // o banco falso não entende `veiculos: { none }`
      return findMany({ ...a, where });
    };
    const livres = await new TagsService(db as any).findAll(7, true);
    expect(livres.map((t: any) => t.guarita_estado)).toEqual(expect.arrayContaining(['ativo', 'a_vincular', null]));
    expect(livres).toHaveLength(3);
  });

  it.each(BLOQUEADOS)('vincular tag %s a um veículo → 400 "Esta tag ainda tem uma operação pendente no Guarita."', async (estado) => {
    const { VeiculosService } = require('../veiculos/veiculos.service');
    const m = montar();
    m.db.semear('tags', [{ id: 2, id_condominio: 7, codigo: 'G3-0F0999', tipo: 'cartao', id_device: 10, guarita_tipo: 3, guarita_serial: '0F0999', guarita_estado: estado, ativo: 1 }]);
    const v = new VeiculosService(m.db as any, m.ops);
    await expect(v.create(7, 50, { placa: 'QWE1R23', id_tag: 2 } as any)).rejects.toThrow('Esta tag ainda tem uma operação pendente no Guarita.');
    await expect(v.update(7, 70, { placa: 'ABC1D23', id_tag: 2 } as any)).rejects.toThrow('Esta tag ainda tem uma operação pendente no Guarita.');
  });
});

describe('FC1 — importação/conferência no meio de uma remoção', () => {
  async function ler(m: ReturnType<typeof montar>, frames: string[], tipo: 'importar' | 'conferir') {
    const op = await m.db.guarita_Operacoes.create({ data: { id_condominio: 7, id_device: 10, tipo, estado: 'enviada', enviada_em: new Date() } });
    await m.imp.receberResultado(DEV as any, op, { ok: true, frames_hex: frames, parte: 1, fim: true });
  }
  const abertos = (db: any) => ops(db, 'apagar').filter((o: any) => o.estado === 'pendente' || o.estado === 'enviada');
  const emOutra = (db: any) => db.linhas('guarita_Alertas').filter((a: any) => a.tipo === 'dispositivo_em_outra_unidade');

  it.each([['importar'], ['conferir']] as const)(
    '%s com o Guarita mostrando outra unidade: a tag continua removendo, o apagar fica, só o alerta (uma vez)',
    async (tipo) => {
      const { TagsService } = require('../veiculos/tags.service');
      const m = montar();
      await new TagsService(m.db as any, m.ops).definirAtivo(7, 1, false);
      expect(tag(m.db).guarita_estado).toBe('removendo');
      m.guarita.set('0F086E', fr(202, 'B', 'BRUNO'));
      await ler(m, [fr(202, 'B', 'BRUNO')], tipo);
      await ler(m, [fr(202, 'B', 'BRUNO')], tipo);
      expect(tag(m.db).guarita_estado).toBe('removendo');
      expect(tag(m.db).guarita_frame).toBe(fr(308, 'B')); // o frame do Prestare fica
      expect(abertos(m.db)).toHaveLength(1);
      expect(emOutra(m.db)).toHaveLength(1);
      // A remoção segue o ciclo: o agente confere a unidade, não apaga o do Bruno, e alerta.
      for (const o of m.db.linhas('guarita_Operacoes')) if (o.estado === 'enviada' && o.tipo !== 'apagar') o.estado = 'ok';
      await rodarAgente(m);
      expect(m.guarita.get('0F086E')).toBe(fr(202, 'B', 'BRUNO'));
      expect(m.db.linhas('guarita_Alertas').filter((a: any) => a.tipo === 'remocao_pendente')).toHaveLength(1);
    },
  );

  it('remocao_falhou: estado e texto ficam; nada é cancelado', async () => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'remocao_falhou', guarita_erro: 'Remoção não confirmada depois de 5 tentativas: x' });
    await ler(m, [fr(202, 'B', 'BRUNO')], 'conferir');
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'remocao_falhou', guarita_erro: 'Remoção não confirmada depois de 5 tentativas: x' });
    expect(emOutra(m.db)).toHaveLength(1);
  });
});

describe('C1 — duas gravações da mesma tag no mesmo lote', () => {
  it('cenário A: troca de unidade e saída logo depois → o dispositivo é removido do Guarita', async () => {
    const m = montar();
    m.db.linhas('moradores')[0].apartamento = '202';
    await m.ops.enfileirarEdicao(1, 'x');
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(true);
    // A remoção cancelou a edição ainda pendente.
    expect(ops(m.db, 'editar')[0].estado).toBe('cancelada');
    await rodarAgente(m);
    expect(m.guarita.has('0F086E')).toBe(false);
    expect(tag(m.db)).toBeUndefined();
  });

  it('cenário A com a edição já entregue: o apagar só sai no lote seguinte, com o esperado do que a edição gravou', async () => {
    const m = montar();
    m.db.linhas('moradores')[0].apartamento = '202';
    await m.ops.enfileirarEdicao(1, 'x');
    const lote1 = await m.agente.buscarOperacoes(DEV);
    expect(lote1.operacoes.map((o) => o.tipo)).toEqual(['editar', 'atualizar_receptores']);
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(true);
    const ed = lote1.operacoes[0];
    m.guarita.set('0F086E', ed.frame_hex as string);
    await m.agente.registrarResultado(DEV, ed.id, { ok: true, codigo: 0 });
    await m.agente.registrarResultado(DEV, lote1.operacoes[1].id, { ok: true, codigo: 0 });
    const lote2 = await m.agente.buscarOperacoes(DEV);
    expect(lote2.operacoes.find((o) => o.tipo === 'apagar')).toMatchObject({ esperado: { unidade: 202, bloco: 1 } });
  });

  it('nunca duas gravações da mesma tag no mesmo lote', async () => {
    const m = montar();
    m.db.semear('guarita_Operacoes', [
      { id_condominio: 7, id_device: 10, id_tag: 1, tipo: 'editar', estado: 'pendente', frame_hex: fr(202, 'B') },
      { id_condominio: 7, id_device: 10, id_tag: 1, tipo: 'apagar', estado: 'pendente', frame_hex: '300F086E' + '00'.repeat(35) },
    ]);
    const lote = await m.agente.buscarOperacoes(DEV);
    expect(lote.operacoes.filter((o) => ['cadastrar', 'editar', 'apagar'].includes(o.tipo))).toHaveLength(1);
  });

  it('cenário B: troca de unidade + edição da placa no mesmo intervalo (fundidas) e saída meses depois → removido', async () => {
    const m = montar();
    m.db.linhas('moradores')[0].apartamento = '202';
    await m.ops.enfileirarEdicao(1, 'x');
    m.db.linhas('veiculos')[0].placa = 'XYZ9A87';
    await m.ops.enfileirarEdicao(1, 'x');
    expect(ops(m.db, 'editar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1);
    await rodarAgente(m);
    expect(tag(m.db).guarita_estado).toBe('ativo');
    expect(decodificarDispositivo(m.guarita.get('0F086E') as string)).toMatchObject({ unidade: 202, placa: 'XYZ9A87' });
    // Meses depois a moradora sai.
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(true);
    await rodarAgente(m);
    expect(m.guarita.has('0F086E')).toBe(false);
  });

  it('conflito num apagar (ou tag em conflito quando o morador sai) gera alerta remocao_pendente e a tag fica visível', async () => {
    const m = montar();
    m.guarita.set('0F086E', fr(202, 'B', 'BRUNO')); // alguém mudou no teclado
    await m.ops.enfileirarRemocao(1, 'x');
    await rodarAgente(m);
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'conflito' });
    expect(tag(m.db).guarita_erro).toMatch(/Não foi possível confirmar a remoção do dispositivo de .* no Guarita\. Confira no aparelho\./);
    const alertas = m.db.linhas('guarita_Alertas').filter((a: any) => a.tipo === 'remocao_pendente');
    expect(alertas).toHaveLength(1);
    expect(m.guarita.has('0F086E')).toBe(true); // o do Bruno não foi apagado

    // Tag já em conflito quando o morador sai: não apaga, mas alerta.
    const m2 = montar();
    tag(m2.db).guarita_estado = 'conflito';
    expect(await m2.ops.enfileirarRemocao(1, 'x')).toBe(false);
    expect(m2.db.linhas('guarita_Alertas').filter((a: any) => a.tipo === 'remocao_pendente')).toHaveLength(1);
    expect(tag(m2.db).guarita_erro).toMatch(/Confira no aparelho/);
  });
});
