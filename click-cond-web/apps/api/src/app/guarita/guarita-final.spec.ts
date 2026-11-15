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
    expect(tag(m.db)).toMatchObject({ guarita_estado: 'incerto', guarita_erro: 'Não foi possível confirmar no Guarita.' });
    expect(ops(m.db, 'cadastrar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1);
    // Morador sai com a tag incerta: o cadastro repetido é cancelado e sai apagar com a unidade pedida.
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(true);
    // fecha o 29 pendente do lote anterior
    for (const o of m.db.linhas('guarita_Operacoes')) if (o.estado === 'enviada') o.estado = 'ok';
    const lote = await m.agente.buscarOperacoes(DEV);
    expect(lote.operacoes.find((o) => o.tipo === 'apagar')).toMatchObject({ esperado: { unidade: 308, bloco: 1 } });
  });

  it('cadastro que falha sem código do 67 (agente antigo) também é incerto, e a saída do morador gera apagar', async () => {
    const m = montar();
    Object.assign(tag(m.db), { guarita_estado: 'a_vincular', guarita_frame: null });
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    await m.agente.buscarOperacoes(DEV);
    await m.agente.registrarResultado(DEV, id_operacao, { ok: false, erro: 'O Guarita não respondeu.' });
    expect(tag(m.db).guarita_estado).toBe('incerto');
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(true);
    expect(ops(m.db, 'apagar')).toHaveLength(1);
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
    expect(tag(m.db).guarita_estado).toBe('incerto');
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
