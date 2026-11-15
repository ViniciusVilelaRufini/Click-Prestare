import { BadRequestException } from '@nestjs/common';
import { criarBancoFalso } from './guarita-banco-falso.testutil';
import { GuaritaOperacoesService } from './guarita-operacoes.service';
import { GuaritaAgenteService } from './guarita-agente.service';
import { GuaritaImportacaoService } from './guarita-importacao.service';
import { TagsService } from '../veiculos/tags.service';
import { VeiculosService } from '../veiculos/veiculos.service';
import { codificarDispositivo } from './guarita-frame.util';

/**
 * C1 + I11 da revisão: o Prestare NUNCA apaga nem regrava o dispositivo de
 * outra unidade. Serial que o Guarita já tem em outra unidade → `conflito`;
 * só a lista branca (podeEscrever) escreve; editar/apagar levam `esperado`.
 */

const DEV = { id: 10, id_condominio: 7, nome: 'Guarita' };

function montar() {
  const db = criarBancoFalso();
  db.semear('facial_Devices', [{ id: 10, id_condominio: 7, nome: 'Guarita', tipo: 'guarita', fabricante: 'linear', ativo: 1 }]);
  db.semear('guarita_Backups', [{ id_condominio: 7, id_device: 10, motivo: 'importacao', total: 0, dados: '[]' }]);
  db.semear('apartamentos', [{ id: 1, id_condominio: 7, bloco: 'B', apto: '308' }]);
  db.semear('moradores', [{ id: 50, id_condominio: 7, nome: 'Ana Souza', bloco: 'B', apartamento: '308', id_user: 500 }]);
  db.semear('tags', [
    { id: 1, id_condominio: 7, codigo: 'G3-0F086E', tipo: 'cartao', id_device: 10, guarita_tipo: 3, guarita_serial: '0F086E', guarita_estado: 'a_vincular' },
  ]);
  db.semear('veiculos', [{ id: 70, id_condominio: 7, id_morador: 50, placa: 'ABC1D23', cor: 'Prata', marca_modelo: 'Fiat Uno', id_tag: 1, ativo: 1 }]);
  const ops = new GuaritaOperacoesService(db as any);
  const agente = new GuaritaAgenteService(db as any, {} as any, new GuaritaImportacaoService(db as any, ops), ops);
  return { db, ops, agente };
}

const operacoes = (db: any, tipo?: string) => db.linhas('guarita_Operacoes').filter((o: any) => !tipo || o.tipo === tipo);
const tag = (db: any) => db.linhas('tags').find((t: any) => t.id === 1);

async function cadastroEntregue(m: ReturnType<typeof montar>) {
  const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
  const lote = await m.agente.buscarOperacoes(DEV);
  expect(lote.operacoes.map((o) => o.tipo)).toEqual(['cadastrar', 'atualizar_receptores']);
  return id_operacao;
}

describe('C1 — cadastro que volta "já cadastrado em outra unidade"', () => {
  it('vira conflito; editar a placa não gera editar; excluir a tag gera apagar conferido pela unidade pedida (F2)', async () => {
    const m = montar();
    const id = await cadastroEntregue(m);
    await m.agente.registrarResultado(DEV, id, { ok: false, codigo: 2, erro: 'Este dispositivo já está cadastrado no Guarita em outra unidade.' });
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'conflito' });
    expect(tag(m.db).guarita_erro).toMatch(/outra unidade/);

    const veiculos = new VeiculosService(m.db as any, m.ops);
    const update = m.db.veiculos.update;
    m.db.veiculos.update = async (a: any) => ({ ...(await update(a)), tag: tag(m.db) });
    await veiculos.update(7, 70, { placa: 'XYZ9A87', id_tag: 1 });
    await expect(new TagsService(m.db as any, m.ops).remove(7, 1)).resolves.toEqual({ ok: true, guarita_remocoes: 1 });
    expect(operacoes(m.db, 'apagar')).toHaveLength(1);
    expect(operacoes(m.db, 'editar')).toHaveLength(0);
    for (const o of m.db.linhas('guarita_Operacoes')) if (o.estado === 'enviada') o.estado = 'ok';
    const lote = await m.agente.buscarOperacoes(DEV);
    expect(lote.operacoes.find((o) => o.tipo === 'apagar')).toMatchObject({ esperado: { unidade: 308, bloco: 1 } });
  });

  it('conflito informado pelo agente (editar com unidade lida diferente) → conflito com a unidade lida; pendentes canceladas', async () => {
    const m = montar();
    const base = codificarDispositivo({ tipo: 3, serialHex: '0F086E', contador: 0, unidade: 308, bloco: 'B', rotulo: 'ANA', marca: 6, cor: 10, placa: 'ABC1D23', grupo: 0, receptores: 0xff });
    Object.assign(tag(m.db), { guarita_estado: 'ativo', guarita_frame: base });
    const ed = (await m.ops.enfileirarEdicao(1, 'x'))!;
    const lote = await m.agente.buscarOperacoes(DEV);
    expect(lote.operacoes.find((o) => o.tipo === 'editar')).toMatchObject({ id: ed.id_operacao, esperado: { unidade: 308, bloco: 1 } });
    await m.agente.registrarResultado(DEV, ed.id_operacao, { ok: false, conflito: true, lido: { unidade: 202, bloco: 1 }, erro: 'outra unidade' });
    expect(tag(m.db).guarita_estado).toBe('conflito');
    expect(tag(m.db).guarita_erro).toMatch(/unidade 202 bloco B/);
    // F2: a edição foi entregue — sai apagar conferido (o agente só apaga se a unidade bater).
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(true);
    expect(operacoes(m.db, 'apagar')).toHaveLength(1);
  });

  it('cadastrar com 0x02 e ja_estava (mesma unidade, com o frame lido) é ok normal', async () => {
    const m = montar();
    const id = await cadastroEntregue(m);
    const pedido = operacoes(m.db, 'cadastrar')[0].frame_hex;
    await m.agente.registrarResultado(DEV, id, { ok: true, codigo: 2, ja_estava: true, lido: { unidade: 308, bloco: 1, frame_hex: pedido } });
    expect(tag(m.db).guarita_estado).toBe('gravado');
  });
});

describe('C1 (d) — remoção com cadastro na fila', () => {
  it('cadastro ainda pendente: é cancelado e a tag sai só do Prestare (nenhum apagar)', async () => {
    const m = montar();
    await m.ops.enfileirarCadastro(1, 'x');
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(false);
    expect(operacoes(m.db, 'cadastrar')[0].estado).toBe('cancelada');
    expect(operacoes(m.db, 'apagar')).toHaveLength(0);
    expect(tag(m.db)).toBeUndefined();
  });

  it('cadastro já entregue: o apagar só sai depois do resultado; cadastro em conflito → o apagar continua (F2)', async () => {
    const m = montar();
    const id = await cadastroEntregue(m);
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(true);
    expect((await m.agente.buscarOperacoes(DEV)).operacoes).toEqual([]); // lote em voo
    await m.agente.registrarResultado(DEV, id, { ok: false, codigo: 2, erro: 'outra unidade' });
    expect(operacoes(m.db, 'apagar')[0].estado).toBe('pendente');
    expect(tag(m.db).guarita_estado).toBe('removendo');
    for (const o of m.db.linhas('guarita_Operacoes')) if (o.estado === 'enviada') o.estado = 'ok';
    const depois = await m.agente.buscarOperacoes(DEV);
    expect(depois.operacoes.find((o) => o.tipo === 'apagar')).toMatchObject({ esperado: { unidade: 308, bloco: 1 } });
  });

  it('cadastro já entregue e ok: o apagar sai com a unidade esperada; cadastro que falha por outro motivo: o apagar continua (F2)', async () => {
    const m = montar();
    const id = await cadastroEntregue(m);
    await m.ops.enfileirarRemocao(1, 'x');
    await m.agente.registrarResultado(DEV, id, { ok: true, codigo: 0 });
    const atualizar = operacoes(m.db, 'atualizar_receptores')[0];
    await m.agente.registrarResultado(DEV, atualizar.id, { ok: true });
    const lote = await m.agente.buscarOperacoes(DEV);
    expect(lote.operacoes.find((o) => o.tipo === 'apagar')).toMatchObject({ esperado: { unidade: 308, bloco: 1 } });

    const m2 = montar();
    const id2 = await cadastroEntregue(m2);
    await m2.ops.enfileirarRemocao(1, 'x');
    await m2.agente.registrarResultado(DEV, id2, { ok: false, codigo: 1 });
    expect(operacoes(m2.db, 'apagar')[0].estado).toBe('pendente');
    expect(tag(m2.db).guarita_estado).toBe('removendo');
  });
});

describe('C1 (c) — a lista branca é uma regra só', () => {
  it('pendente/falhou sem cadastro ok não escreve; com cadastro ok escreve', async () => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'falhou' });
    expect(await m.ops.podeEscrever(tag(m.db))).toBe(false);
    m.db.semear('guarita_Operacoes', [{ id_condominio: 7, id_device: 10, id_tag: 1, tipo: 'cadastrar', estado: 'ok', frame_hex: codificarDispositivo({ tipo: 3, serialHex: '0F086E', contador: 0, unidade: 308, bloco: 'B', rotulo: 'X', marca: 0, cor: 0, placa: '', grupo: 0, receptores: 0xff }) }]);
    expect(await m.ops.podeEscrever(tag(m.db))).toBe(true);
    for (const e of ['a_vincular', 'conflito', 'ausente', 'aguardando_aprovacao', 'recusada', null]) {
      expect(await m.ops.podeEscrever({ ...tag(m.db), guarita_estado: e })).toBe(false);
    }
    for (const e of ['gravado', 'ativo', 'removendo']) {
      expect(await m.ops.podeEscrever({ ...tag(m.db), guarita_estado: e })).toBe(true);
    }
  });
});

describe('C1 (a) — desfazer vínculo', () => {
  it('tag em conflito: a linha sai do Prestare, nenhuma operação no Guarita; outro estado → 400', async () => {
    const m = montar();
    await expect(m.ops.desfazer(7, 10, 1)).rejects.toBeInstanceOf(BadRequestException);
    tag(m.db).guarita_estado = 'conflito';
    await expect(m.ops.desfazer(7, 10, 1)).resolves.toEqual({ id_tag: 1, desfeito: true });
    expect(tag(m.db)).toBeUndefined();
    expect(m.db.linhas('veiculos')[0].id_tag).toBeNull();
    expect(operacoes(m.db)).toHaveLength(0);
  });
});

describe('I11 — importação acha o serial de uma tag ainda não confirmada em OUTRA unidade', () => {
  it('pendente → conflito, cadastro cancelado, frame da outra unidade não é adotado', async () => {
    const m = montar();
    await m.ops.enfileirarCadastro(1, 'x');
    const importar = await new GuaritaImportacaoService(m.db as any, m.ops).solicitar(7, 10, 'conferir', 'x').catch(() => null);
    const idLeitura = importar?.id ?? (await m.db.guarita_Operacoes.create({ data: { id_condominio: 7, id_device: 10, tipo: 'conferir', estado: 'enviada' } })).id;
    const daOutra = codificarDispositivo({ tipo: 3, serialHex: '0F086E', contador: 0, unidade: 202, bloco: 'B', rotulo: 'OUTRO', marca: 0, cor: 0, placa: '', grupo: 0, receptores: 0xff });
    await m.agente.registrarResultado(DEV, idLeitura, { ok: true, parte: 1, frames_hex: [daOutra], fim: true });
    expect(tag(m.db).guarita_estado).toBe('conflito');
    expect(tag(m.db).guarita_frame).toBeFalsy();
    expect(operacoes(m.db, 'cadastrar')[0].estado).toBe('cancelada');
  });

  it('mesmo serial na MESMA unidade não é conflito', async () => {
    const m = montar();
    await m.ops.enfileirarCadastro(1, 'x');
    const leitura = await m.db.guarita_Operacoes.create({ data: { id_condominio: 7, id_device: 10, tipo: 'conferir', estado: 'enviada' } });
    const mesma = codificarDispositivo({ tipo: 3, serialHex: '0F086E', contador: 0, unidade: 308, bloco: 'B', rotulo: 'ANA', marca: 0, cor: 0, placa: '', grupo: 0, receptores: 0xff });
    await m.agente.registrarResultado(DEV, leitura.id, { ok: true, parte: 1, frames_hex: [mesma], fim: true });
    expect(tag(m.db).guarita_estado).toBe('pendente');
  });
});

describe('I3 — remoção que falha e identidade do CT', () => {
  const framePlano = (b0: string, vi = '0000') =>
    '340F086E'.replace('34', b0) + vi + '03080100FF' + '20'.repeat(18) + '00060A' + Buffer.from('ABC1D23').toString('hex').toUpperCase();

  it('apagar que falha: tag continua removendo, alerta remocao_pendente; nova tentativa só na reconexão, até 5', async () => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'ativo', guarita_frame: framePlano('30') });
    await m.ops.enfileirarRemocao(1, 'x');
    const lote = await m.agente.buscarOperacoes(DEV);
    const apagar = lote.operacoes.find((o) => o.tipo === 'apagar')!;
    await m.agente.registrarResultado(DEV, apagar.id, { ok: false, erro: 'O Guarita não respondeu.' });
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'removendo' });
    expect(tag(m.db).guarita_erro).toMatch(/Remoção: O Guarita não respondeu/);
    const alertas = m.db.linhas('guarita_Alertas');
    expect(alertas.map((a: any) => a.tipo)).toEqual(['remocao_pendente']);
    expect(alertas[0].descricao).toMatch(/ainda abre o portão/);

    // Estado repetido (já conectado) não reenfileira; reconexão sim.
    await m.agente.registrarEstado(DEV, { conectado: true, autorizado: true });
    expect(operacoes(m.db, 'apagar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1);
    await m.agente.registrarEstado(DEV, { conectado: true, autorizado: true });
    expect(operacoes(m.db, 'apagar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1);

    // Mais 4 falhas (com reconexões no meio): depois da 5ª, para de tentar.
    for (let i = 0; i < 4; i++) {
      const p = operacoes(m.db, 'apagar').find((o: any) => o.estado === 'pendente');
      p.estado = 'enviada';
      await m.agente.registrarResultado(DEV, p.id, { ok: false, erro: 'O Guarita não respondeu.' });
      await m.agente.registrarEstado(DEV, { conectado: false, autorizado: true });
      await m.agente.registrarEstado(DEV, { conectado: true, autorizado: true });
    }
    expect(operacoes(m.db, 'apagar').filter((o: any) => o.estado === 'falhou')).toHaveLength(5);
    expect(operacoes(m.db, 'apagar').filter((o: any) => o.estado === 'pendente')).toHaveLength(0);
    // Esgotou: não fica "Removendo" para sempre.
    expect(tag(m.db).guarita_estado).toBe('remocao_falhou');
  });

  it('CT com disp_dest (nibble baixo do byte 1): apagar e editar usam o byte 1 lido; edição mantém o "VI" do visitante', async () => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'ativo', guarita_frame: framePlano('34', '5649') });
    await m.ops.enfileirarEdicao(1, 'x');
    const ed = operacoes(m.db, 'editar')[0];
    expect(ed.frame_hex.slice(0, 12)).toBe('340F086E5649');
    m.db.linhas('guarita_Operacoes').forEach((o: any) => (o.estado = 'cancelada'));
    await m.ops.enfileirarRemocao(1, 'x');
    const lote = await m.agente.buscarOperacoes(DEV);
    expect(lote.operacoes.find((o) => o.tipo === 'apagar')!.frame_hex).toBe('340F086E' + '00'.repeat(35));
  });
});
