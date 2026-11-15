import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { criarBancoFalso } from './guarita-banco-falso.testutil';
import { GuaritaImportacaoService } from './guarita-importacao.service';
import { GuaritaAgenteService } from './guarita-agente.service';
import { GuaritaController } from "./guarita.controller";
import { GuaritaOperacoesService } from "./guarita-operacoes.service";
import { codificarDispositivo } from './guarita-frame.util';

/**
 * Importação do cadastro do Guarita: cópia de segurança ANTES de qualquer
 * mudança, montagem das partes (fora de ordem, só com o `fim`), casamento com
 * unidade e veículo, e a conferência que NUNCA apaga nada do Guarita.
 */

const OPERADOR: any = { sub: 1, nome: 'Porteiro Zé', id_condominio: 7 };
const MORADOR: any = { sub: 99, nome: 'Morador', typeAccess: 'Morador' };

function frame(tipo: number, serialHex: string, extra: Partial<Parameters<typeof codificarDispositivo>[0]> = {}) {
  return codificarDispositivo({
    tipo,
    serialHex,
    contador: tipo === 1 ? 0x0102 : 0,
    unidade: 101,
    bloco: 'A',
    rotulo: 'MORADOR',
    marca: 0x16,
    cor: 0,
    placa: '',
    grupo: 0,
    receptores: 0xff,
    ...extra,
  });
}

function montar() {
  const db = criarBancoFalso();
  db.semear('facial_Devices', [
    { id: 10, id_condominio: 7, nome: 'Guarita', tipo: 'guarita', fabricante: 'linear', ip: '10.0.0.10', porta: 9000, ativo: 1, webhook_token: 't' },
    { id: 11, id_condominio: 7, nome: 'Facial', tipo: 'facial', fabricante: 'intelbras', ip: '10.0.0.11', porta: 80, ativo: 1, webhook_token: 't2' },
    { id: 20, id_condominio: 8, nome: 'Guarita do 8', tipo: 'guarita', fabricante: 'linear', ip: '10.0.0.20', porta: 9000, ativo: 1, webhook_token: 't3' },
  ]);
  db.semear('apartamentos', [
    { id: 1, id_condominio: 7, bloco: 'A', apto: '101' },
    { id: 2, id_condominio: 7, bloco: 'Bloco B', apto: '202' },
    { id: 4, id_condominio: 7, bloco: 'C', apto: '303A' },
    { id: 3, id_condominio: 8, bloco: 'A', apto: '101' },
  ]);
  db.semear('moradores', [
    { id: 50, id_condominio: 7, nome: 'Ana', bloco: 'A', apartamento: '101', id_user: 500 },
    { id: 51, id_condominio: 7, nome: 'Bruno', bloco: 'B', apartamento: '202', id_user: 501 },
  ]);
  db.semear('veiculos', [
    { id: 70, id_condominio: 7, id_morador: 50, placa: 'ABC1D23', ativo: 1, id_tag: null },
    { id: 71, id_condominio: 7, id_morador: 51, placa: 'XYZ9876', ativo: 1, id_tag: null },
  ]);
  const facial: any = { resolveAgente: jest.fn(async () => ({ idCondominio: 7 })) };
  const agente = new GuaritaAgenteService(db as any, facial);
  const importacao = new GuaritaImportacaoService(db as any);
  (agente as any).importacao = importacao;
  const ctrl = new GuaritaController(importacao, new GuaritaOperacoesService(db as any));
  const device = { id: 10, id_condominio: 7, nome: 'Guarita' };
  return { db, agente, importacao, ctrl, device };
}

async function abrir(ctrl: GuaritaController, tipo: 'importar' | 'conferir' = 'importar') {
  const r: any = tipo === 'importar' ? await ctrl.importar(7, 10, OPERADOR) : await ctrl.conferir(7, 10, OPERADOR);
  return r.id as number;
}

describe('Guarita — pedir importação/conferência', () => {
  it('cria a operação; outra em andamento → 409', async () => {
    const { ctrl, db } = montar();
    const id = await abrir(ctrl);
    expect(db.linhas('guarita_Operacoes')[0]).toMatchObject({ id, tipo: 'importar', estado: 'pendente', criado_por: 'Porteiro Zé' });
    await expect(ctrl.importar(7, 10, OPERADOR)).rejects.toBeInstanceOf(ConflictException);
    await expect(ctrl.conferir(7, 10, OPERADOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('Guarita de outro condomínio ou device que não é Guarita → 404', async () => {
    const { ctrl } = montar();
    await expect(ctrl.importar(7, 20, OPERADOR)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctrl.importar(7, 11, OPERADOR)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctrl.listarDispositivos(7, 20, undefined, OPERADOR)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctrl.listarBackups(7, 20, OPERADOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('só staff (a mesma permissão de Veículos/Tags): morador → 403', async () => {
    const { ctrl, db } = montar();
    await expect(ctrl.importar(7, 10, MORADOR)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.conferir(7, 10, MORADOR)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.listarDispositivos(7, 10, undefined, MORADOR)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.listarBackups(7, 10, MORADOR)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.baixarBackup(7, 10, 1, MORADOR)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.vincular(7, 10, 1, { id_veiculo: 70 }, MORADOR)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.linhas('guarita_Operacoes')).toHaveLength(0);
  });
});

describe('Guarita — importação em partes', () => {
  it('3 partes fora de ordem montam certo; nada é criado antes do fim', async () => {
    const { ctrl, agente, device, db } = montar();
    const id = await abrir(ctrl);
    await agente.buscarOperacoes(device);
    const f = [frame(2, '000001'), frame(2, '000002'), frame(3, '000003'), frame(6, '000004'), frame(1, '1000005')];

    await agente.registrarResultado(device, id, { ok: true, parte: 2, frames_hex: [f[4]], fim: true });
    await agente.registrarResultado(device, id, { ok: true, parte: 0, frames_hex: [f[0], f[1]] });
    expect(db.linhas('tags')).toHaveLength(0);
    expect(db.linhas('guarita_Backups')).toHaveLength(0);
    expect(db.linhas('guarita_Operacoes')[0].estado).toBe('enviada');

    await agente.registrarResultado(device, id, { ok: true, parte: 1, frames_hex: [f[2], f[3]] });
    const backups = db.linhas('guarita_Backups');
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatchObject({ id_device: 10, motivo: 'importacao', total: 5 });
    expect(JSON.parse(backups[0].dados)).toEqual(f);
    expect(db.linhas('tags').map((t: any) => t.codigo).sort()).toEqual(
      ['G1-1000005', 'G2-000001', 'G2-000002', 'G3-000003', 'G6-000004'].sort(),
    );
    expect(db.linhas('guarita_Operacoes')[0].estado).toBe('ok');
    expect(db.linhas('guarita_Importacoes')).toHaveLength(0);
  });

  it('importação sem "fim" não cria nada (nem cópia, nem tag)', async () => {
    const { ctrl, agente, device, db } = montar();
    const id = await abrir(ctrl);
    await agente.registrarResultado(device, id, { ok: true, parte: 0, frames_hex: [frame(2, '000001')] });
    await agente.registrarResultado(device, id, { ok: true, parte: 1, frames_hex: [frame(2, '000002')] });
    expect(db.linhas('tags')).toHaveLength(0);
    expect(db.linhas('guarita_Backups')).toHaveLength(0);
  });

  it('leitura que falhou no agente: falhou, partes descartadas, nada importado', async () => {
    const { ctrl, agente, device, db } = montar();
    const id = await abrir(ctrl);
    await agente.registrarResultado(device, id, { ok: true, parte: 0, frames_hex: [frame(2, '000001')] });
    await agente.registrarResultado(device, id, { ok: false, erro: 'Leitura incompleta: 1 de 2' });
    expect(db.linhas('guarita_Operacoes')[0]).toMatchObject({ estado: 'falhou', erro: 'Leitura incompleta: 1 de 2' });
    expect(db.linhas('guarita_Importacoes')).toHaveLength(0);
    expect(db.linhas('tags')).toHaveLength(0);
  });

  it('contrato do agente: partes começam em 1; Guarita vazio chega como { frames_hex: [], parte: 1, fim: true }', async () => {
    const { ctrl, agente, device, db } = montar();
    const id = await abrir(ctrl);
    await agente.registrarResultado(device, id, { ok: true, frames_hex: [], parte: 1, fim: true });
    expect(db.linhas('guarita_Backups')[0]).toMatchObject({ total: 0, dados: '[]' });
    expect(db.linhas('tags')).toHaveLength(0);
    expect(db.linhas('guarita_Operacoes')[0].estado).toBe('ok');

    const id2 = await abrir(ctrl);
    await agente.registrarResultado(device, id2, { ok: true, parte: 2, frames_hex: [frame(2, '000002')], fim: true });
    expect(db.linhas('tags')).toHaveLength(0); // falta a parte 1
    await agente.registrarResultado(device, id2, { ok: true, parte: 1, frames_hex: [frame(2, '000001')] });
    expect(db.linhas('tags')).toHaveLength(2);
  });

  it('Guarita vazio (fim sem frames) gera cópia com total 0', async () => {
    const { ctrl, agente, device, db } = montar();
    const id = await abrir(ctrl);
    await agente.registrarResultado(device, id, { ok: true, parte: 0, frames_hex: [], fim: true });
    expect(db.linhas('guarita_Backups')[0]).toMatchObject({ total: 0, dados: '[]' });
    expect(db.linhas('guarita_Operacoes')[0].estado).toBe('ok');
  });

  it('reimportar não duplica tags (atualiza o frame lido)', async () => {
    const { ctrl, agente, device, db } = montar();
    for (const rotulo of ['PRIMEIRA', 'SEGUNDA']) {
      const id = await abrir(ctrl);
      await agente.registrarResultado(device, id, { ok: true, parte: 0, frames_hex: [frame(2, '000001', { rotulo })], fim: true });
    }
    const tags = db.linhas('tags');
    expect(tags).toHaveLength(1);
    expect(tags[0].guarita_frame).toBe(frame(2, '000001', { rotulo: 'SEGUNDA' }));
    expect(db.linhas('guarita_Backups')).toHaveLength(2);
  });

  it('partes repetidas (o agente reenviou) e duas instâncias recebendo o fim: um processamento só', async () => {
    const { ctrl, agente, device, db } = montar();
    const outra = new GuaritaAgenteService(db as any, { resolveAgente: jest.fn() } as any);
    (outra as any).importacao = new GuaritaImportacaoService(db as any);
    const id = await abrir(ctrl);
    await agente.registrarResultado(device, id, { ok: true, parte: 0, frames_hex: [frame(2, '000001')] });
    await agente.registrarResultado(device, id, { ok: true, parte: 0, frames_hex: [frame(2, '000001')] });
    await Promise.all([
      agente.registrarResultado(device, id, { ok: true, parte: 1, frames_hex: [frame(2, '000002')], fim: true }),
      outra.registrarResultado(device, id, { ok: true, parte: 1, frames_hex: [frame(2, '000002')], fim: true }),
    ]);
    expect(db.linhas('guarita_Backups')).toHaveLength(1);
    expect(db.linhas('tags')).toHaveLength(2);
  });
});

describe('Guarita — casamento com unidade e veículo', () => {
  async function importar(frames: string[]) {
    const m = montar();
    const id = await abrir(m.ctrl);
    await m.agente.registrarResultado(m.device, id, { ok: true, parte: 0, frames_hex: frames, fim: true });
    return m;
  }

  it('bloco+unidade casam com o apartamento (comparação normalizada) e a placa única vincula o veículo → ativo', async () => {
    const { db } = await importar([
      frame(2, '000001', { unidade: 101, bloco: 'A', placa: 'ABC1D23' }),
      frame(2, '000002', { unidade: 202, bloco: 'B' }),
    ]);
    const [t1, t2] = db.linhas('tags');
    expect(t1).toMatchObject({ id_apto: 1, guarita_estado: 'ativo', guarita_tipo: 2, guarita_serial: '000001', tipo: 'tag_ativo', id_device: 10 });
    expect(db.linhas('veiculos').find((v: any) => v.id === 70).id_tag).toBe(t1.id);
    expect(t2).toMatchObject({ id_apto: 2, guarita_estado: 'a_vincular' });
  });

  it('I5: placa bate mas a unidade do Guarita não é a do dono do veículo → a_vincular', async () => {
    // XYZ9876 é do Bruno (202 B); o frame diz unidade 101 bloco A.
    const { db } = await importar([frame(2, '000005', { unidade: 101, bloco: 'A', placa: 'XYZ9876' })]);
    expect(db.linhas('tags')[0].guarita_estado).toBe('a_vincular');
    expect(db.linhas('veiculos').find((v: any) => v.id === 71).id_tag).toBeNull();
  });

  it('placa ambígua (dois veículos) não vincula', async () => {
    const m = montar();
    // Mesma placa normalizada em dois veículos ativos (grafias diferentes).
    m.db.semear('veiculos', [{ id: 72, id_condominio: 7, id_morador: 51, placa: 'abc-1d23', ativo: 1, id_tag: null }]);
    const id = await abrir(m.ctrl);
    await m.agente.registrarResultado(m.device, id, { ok: true, parte: 0, frames_hex: [frame(2, '000001', { placa: 'ABC1D23' })], fim: true });
    expect(m.db.linhas('tags')[0].guarita_estado).toBe('a_vincular');
    expect(m.db.linhas('veiculos').every((v: any) => v.id_tag === null)).toBe(true);
  });

  it('veículo que já tem tag não ganha outra', async () => {
    const m = montar();
    m.db.linhas('veiculos').find((v: any) => v.id === 70).id_tag = 999;
    const id = await abrir(m.ctrl);
    await m.agente.registrarResultado(m.device, id, { ok: true, parte: 0, frames_hex: [frame(2, '000001', { placa: 'ABC1D23' })], fim: true });
    expect(m.db.linhas('tags')[0].guarita_estado).toBe('a_vincular');
    expect(m.db.linhas('veiculos').find((v: any) => v.id === 70).id_tag).toBe(999);
  });

  it('I4: texto de unidade que não converte de forma estrita não casa ("303A" não é 303)', async () => {
    const { db } = await importar([frame(3, '000008', { unidade: 303, bloco: 'C' })]);
    expect(db.linhas('tags')[0]).toMatchObject({ id_apto: null, guarita_estado: 'a_vincular' });
  });

  it('unidade inexistente fica a_vincular sem id_apto', async () => {
    const { db } = await importar([frame(3, '000009', { unidade: 905, bloco: 'Z' })]);
    expect(db.linhas('tags')[0]).toMatchObject({ id_apto: null, guarita_estado: 'a_vincular' });
  });

  it('BM/SN (fora da integração) ficam só na cópia de segurança', async () => {
    const bm = '5' + '0'.repeat(77);
    const { db } = await importar([bm, frame(2, '000001')]);
    expect(db.linhas('tags')).toHaveLength(1);
    expect(JSON.parse(db.linhas('guarita_Backups')[0].dados)).toContain(bm);
  });
});

describe('Guarita — conferência nunca apaga', () => {
  async function comImportacao(frames: string[]) {
    const m = montar();
    const id = await abrir(m.ctrl);
    await m.agente.registrarResultado(m.device, id, { ok: true, parte: 0, frames_hex: frames, fim: true });
    return m;
  }

  it('só no Guarita → a_vincular; só no Prestare (ativo/gravado) → cadastrar de novo; divergente → só lista; nenhum apagar', async () => {
    const original = frame(2, '000001', { placa: 'ABC1D23' });
    const m = await comImportacao([original, frame(2, '000002'), frame(3, '000003')]);
    // A tag 000002 foi gravada PELO Prestare (cadastro ok).
    const t2antes = m.db.linhas('tags').find((t: any) => t.guarita_serial === '000002');
    t2antes.guarita_estado = 'gravado';
    m.db.semear('guarita_Operacoes', [{ id_condominio: 7, id_device: 10, id_tag: t2antes.id, tipo: 'cadastrar', estado: 'ok', frame_hex: frame(2, '000002') }]);

    const id = await abrir(m.ctrl, 'conferir');
    const lidoAgora = [
      frame(2, '000001', { placa: 'ABC1D23', rotulo: 'OUTRO NOME' }), // divergente
      // 000002 sumiu do Guarita
      frame(3, '000003'), // igual
      frame(6, '00000A'), // novo, só no Guarita
    ];
    await m.agente.registrarResultado(m.device, id, { ok: true, parte: 0, frames_hex: lidoAgora, fim: true });

    const ops = m.db.linhas('guarita_Operacoes');
    expect(ops.some((o: any) => o.tipo === 'apagar')).toBe(false);
    const cadastrar = ops.filter((o: any) => o.tipo === 'cadastrar' && o.estado === 'pendente');
    expect(cadastrar).toHaveLength(1);
    expect(cadastrar[0].frame_hex).toBe(frame(2, '000002'));
    const t2 = m.db.linhas('tags').find((t: any) => t.guarita_serial === '000002');
    expect(t2.guarita_estado).toBe('pendente');
    expect(cadastrar[0].id_tag).toBe(t2.id);
    expect(m.db.linhas('tags').find((t: any) => t.guarita_serial === '00000A').guarita_estado).toBe('a_vincular');
    // Divergente: o frame guardado não foi "corrigido".
    expect(m.db.linhas('tags').find((t: any) => t.guarita_serial === '000001').guarita_frame).toBe(original);

    const resumo: any = await m.ctrl.operacao(7, 10, id, OPERADOR);
    expect(resumo).toMatchObject({ id, tipo: 'conferir', estado: 'ok', erro: null });
    expect(resumo.resumo).toEqual({ so_no_guarita: 1, so_no_prestare: 1, divergente: 1 });
    expect(resumo.diferencas.so_no_guarita.map((d: any) => d.serial)).toEqual(['00000A']);
    expect(resumo.diferencas.so_no_prestare.map((d: any) => d.serial)).toEqual(['000002']);
    expect(resumo.diferencas.divergente.map((d: any) => d.serial)).toEqual(['000001']);
    expect(m.db.linhas('guarita_Backups').map((b: any) => b.motivo)).toEqual(['importacao', 'conferencia']);
  });

  it('I2: tag importada (ativo) que sumiu do Guarita vira ausente, sem operação; regravar enfileira; voltar ao Guarita tira o ausente', async () => {
    const m = await comImportacao([frame(2, '000001', { placa: 'ABC1D23' })]);
    expect(m.db.linhas('tags')[0].guarita_estado).toBe('ativo');
    const id = await abrir(m.ctrl, 'conferir');
    await m.agente.registrarResultado(m.device, id, { ok: true, parte: 1, frames_hex: [], fim: true });
    expect(m.db.linhas('tags')[0]).toMatchObject({ guarita_estado: 'ausente', guarita_erro: 'Não está mais no Guarita.' });
    expect(m.db.linhas('guarita_Operacoes').filter((o: any) => !['importar', 'conferir'].includes(o.tipo))).toEqual([]);
    const resumo: any = await m.ctrl.operacao(7, 10, id, OPERADOR);
    expect(resumo.diferencas.so_no_prestare[0]).toMatchObject({ ausente: true });

    const ops = new GuaritaOperacoesService(m.db as any);
    const r = await ops.regravar(7, 10, m.db.linhas('tags')[0].id, 'síndica');
    expect(r.estado).toBe('pendente');
    expect(m.db.linhas('guarita_Operacoes').filter((o: any) => o.tipo === 'cadastrar')).toHaveLength(1);

    // Conferência seguinte acha o dispositivo de volta: deixa de ser ausente.
    m.db.linhas('tags')[0].guarita_estado = 'ausente';
    m.db.linhas('guarita_Operacoes').forEach((o: any) => (o.estado = o.estado === 'pendente' ? 'cancelada' : o.estado));
    const id2 = await abrir(m.ctrl, 'conferir');
    await m.agente.registrarResultado(m.device, id2, { ok: true, parte: 1, frames_hex: [frame(2, '000001', { placa: 'ABC1D23' })], fim: true });
    expect(m.db.linhas('tags')[0].guarita_estado).toBe('ativo');
  });

  it('a_vincular que sumiu do Guarita não vira cadastro (o Prestare não o gravou)', async () => {
    const m = await comImportacao([frame(2, '000001')]);
    const id = await abrir(m.ctrl, 'conferir');
    await m.agente.registrarResultado(m.device, id, { ok: true, parte: 0, frames_hex: [], fim: true });
    expect(m.db.linhas('guarita_Operacoes').filter((o: any) => o.tipo !== 'importar' && o.tipo !== 'conferir')).toEqual([]);
  });

  it('a cópia de segurança é gravada antes de qualquer mudança', async () => {
    const m = montar();
    const ordem: string[] = [];
    for (const t of ['guarita_Backups', 'tags', 'veiculos', 'guarita_Operacoes']) {
      const d = (m.db as any)[t];
      for (const metodo of ['create', 'update', 'updateMany', 'upsert']) {
        const orig = d[metodo];
        d[metodo] = async (...a: any[]) => {
          ordem.push(`${t}.${metodo}`);
          return orig(...a);
        };
      }
    }
    const id = await abrir(m.ctrl);
    ordem.length = 0;
    await m.agente.registrarResultado(m.device, id, { ok: true, parte: 0, frames_hex: [frame(2, '000001', { placa: 'ABC1D23' })], fim: true });
    const mudancas = ordem.filter((o) => !o.startsWith('guarita_Operacoes'));
    expect(mudancas[0]).toBe('guarita_Backups.create');
  });
});

describe('Guarita — rotas do console de dispositivos e cópias', () => {
  async function comImportacao() {
    const m = montar();
    const id = await abrir(m.ctrl);
    await m.agente.registrarResultado(m.device, id, {
      ok: true,
      parte: 0,
      frames_hex: [frame(2, '000001', { placa: 'ABC1D23', rotulo: 'ANA' }), frame(3, '000002', { unidade: 202, bloco: 'B' })],
      fim: true,
    });
    return m;
  }

  it('lista com unidade, veículo, estado e erro; filtra por estado', async () => {
    const { ctrl } = await comImportacao();
    const pagina: any = await ctrl.listarDispositivos(7, 10, undefined, OPERADOR);
    expect(pagina).toMatchObject({ total: 2, pagina: 1, por_pagina: 50 });
    const todos: any[] = pagina.itens;
    expect(todos).toHaveLength(2);
    expect(todos[0]).toMatchObject({
      id: expect.any(Number),
      id_tag: todos[0].id,
      codigo: 'G2-000001',
      guarita_tipo: 2,
      tipo_sigla: 'TA',
      guarita_serial: '000001',
      guarita_estado: 'ativo',
      guarita_erro: null,
      unidade: 101,
      bloco: 'A',
      rotulo: 'ANA',
      placa: 'ABC1D23',
      id_apto: 1,
      apartamento: 'Apto 101 · Bloco A',
      id_veiculo: 70,
      veiculo_placa: 'ABC1D23',
      id_morador: 50,
      morador_nome: 'Ana',
    });
    const aVincular: any = await ctrl.listarDispositivos(7, 10, 'a_vincular', OPERADOR);
    expect(aVincular.itens.map((d: any) => d.guarita_serial)).toEqual(['000002']);
    // Busca (serial, placa, rótulo, unidade...) e paginação no servidor.
    expect((await ctrl.listarDispositivos(7, 10, undefined, OPERADOR, 'abc1d')).itens.map((d: any) => d.guarita_serial)).toEqual(['000001']);
    expect((await ctrl.listarDispositivos(7, 10, undefined, OPERADOR, '202')).itens.map((d: any) => d.guarita_serial)).toEqual(['000002']);
    const p2: any = await ctrl.listarDispositivos(7, 10, undefined, OPERADOR, undefined, '2', '1');
    expect(p2).toMatchObject({ total: 2, pagina: 2, por_pagina: 1 });
    expect(p2.itens.map((d: any) => d.guarita_serial)).toEqual(['000002']);
  });

  it('veículos para vincular: só ativos sem tag, por placa, morador ou unidade, até o limite', async () => {
    const { ctrl } = await comImportacao();
    const todos: any[] = await ctrl.veiculosParaVincular(7, 10, undefined, undefined, OPERADOR);
    expect(todos).toEqual([{ id: 71, placa: 'XYZ9876', marca_modelo: null, morador_nome: 'Bruno', apartamento: '202', bloco: 'B' }]);
    expect(await ctrl.veiculosParaVincular(7, 10, 'xyz-98', undefined, OPERADOR)).toHaveLength(1);
    expect(await ctrl.veiculosParaVincular(7, 10, 'bruno', undefined, OPERADOR)).toHaveLength(1);
    expect(await ctrl.veiculosParaVincular(7, 10, 'ana', undefined, OPERADOR)).toHaveLength(0);
  });

  it('cópias: lista sem os dados e download com os frames; cópia de outro Guarita → 404', async () => {
    const { ctrl, db } = await comImportacao();
    const lista: any[] = await ctrl.listarBackups(7, 10, OPERADOR);
    expect(lista).toEqual([expect.objectContaining({ id: 1, motivo: 'importacao', total: 2 })]);
    expect(lista[0]).not.toHaveProperty('dados');
    const download: any = await ctrl.baixarBackup(7, 10, 1, OPERADOR);
    expect(download.frames).toHaveLength(2);
    db.semear('guarita_Backups', [{ id_condominio: 8, id_device: 20, motivo: 'importacao', total: 0, dados: '[]' }]);
    await expect(ctrl.baixarBackup(7, 10, 2, OPERADOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('vincular a_vincular a um veículo livre do condomínio → ativo, sem gravar no Guarita', async () => {
    const { ctrl, db } = await comImportacao();
    const tag = db.linhas('tags').find((t: any) => t.guarita_serial === '000002');
    const r: any = await ctrl.vincular(7, 10, tag.id, { id_veiculo: 71 }, OPERADOR);
    expect(r).toMatchObject({ id_tag: tag.id, estado: 'ativo', id_veiculo: 71 });
    expect(db.linhas('veiculos').find((v: any) => v.id === 71).id_tag).toBe(tag.id);
    expect(db.linhas('guarita_Operacoes').filter((o: any) => o.tipo !== 'importar')).toEqual([]);
  });

  it('vincular a veículo que já tem tag ou de outro condomínio → recusa', async () => {
    const { ctrl, db } = await comImportacao();
    const tag = db.linhas('tags').find((t: any) => t.guarita_serial === '000002');
    await expect(ctrl.vincular(7, 10, tag.id, { id_veiculo: 70 }, OPERADOR)).rejects.toThrow(/já tem uma tag/);
    db.semear('veiculos', [{ id: 80, id_condominio: 8, id_morador: 1, placa: 'OUT0000', ativo: 1, id_tag: null }]);
    await expect(ctrl.vincular(7, 10, tag.id, { id_veiculo: 80 }, OPERADOR)).rejects.toBeInstanceOf(NotFoundException);
  });
});
