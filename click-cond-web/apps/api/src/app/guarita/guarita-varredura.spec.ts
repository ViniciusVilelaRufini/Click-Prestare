import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { criarBancoFalso } from './guarita-banco-falso.testutil';
import { GuaritaOperacoesService } from './guarita-operacoes.service';
import { GuaritaAgenteService } from './guarita-agente.service';
import { GuaritaImportacaoService } from './guarita-importacao.service';
import { GuaritaEventosService } from './guarita-eventos.service';
import { GuaritaCapturaService } from './guarita-captura.service';
import { codificarDispositivo } from './guarita-frame.util';
import { violouChaveDoGuarita } from './guarita-comum.util';
import { FacialService } from '../facial/facial.service';

/**
 * Varredura de 24/11 — Guarita: G3 (reivindicação confere o frame entregue),
 * G2 (0x02 sem leitura é incerto; contador do RF não é conflito; desfazer e
 * troca com gravação entregue apagam conferido), G5 (Guarita desativado com
 * remoção pendente), G6 (evento só é do dono com tag gravada e mesma unidade)
 * e G7 (chave única do controle por Guarita).
 */

const DEV = { id: 10, id_condominio: 7, nome: 'Guarita' };
const fr = (unidade: number, bloco: string, rotulo = 'ANA', placa = 'ABC1D23') =>
  codificarDispositivo({ tipo: 3, serialHex: '0F086E', contador: 0, unidade, bloco, rotulo, marca: 6, cor: 10, placa, grupo: 0, receptores: 0xff });

function montar(estadoTag = 'ativo') {
  const db = criarBancoFalso();
  db.semear('facial_Devices', [{ id: 10, id_condominio: 7, nome: 'Guarita', tipo: 'guarita', fabricante: 'linear', ativo: 1 }]);
  db.semear('guarita_Backups', [{ id_condominio: 7, id_device: 10, motivo: 'importacao', total: 0, dados: '[]' }]);
  db.semear('apartamentos', [{ id: 1, id_condominio: 7, bloco: 'B', apto: '308' }, { id: 2, id_condominio: 7, bloco: 'B', apto: '202' }]);
  db.semear('moradores', [{ id: 50, id_condominio: 7, nome: 'Ana Souza', bloco: 'B', apartamento: '308', id_user: 500 }]);
  db.semear('tags', [{ id: 1, id_condominio: 7, codigo: 'G3-0F086E', tipo: 'cartao', id_device: 10, guarita_tipo: 3, guarita_serial: '0F086E', guarita_estado: estadoTag, guarita_frame: fr(308, 'B') }]);
  db.semear('veiculos', [{ id: 70, id_condominio: 7, id_morador: 50, placa: 'ABC1D23', cor: 'Prata', marca_modelo: 'Fiat Uno', id_tag: 1, ativo: 1 }]);
  const ops = new GuaritaOperacoesService(db as any);
  const imp = new GuaritaImportacaoService(db as any, ops);
  const agente = new GuaritaAgenteService(db as any, {} as any, imp, ops);
  return { db, ops, imp, agente };
}
const tag = (db: any) => db.linhas('tags').find((t: any) => t.id === 1);
const opsDe = (db: any, tipo: string) => db.linhas('guarita_Operacoes').filter((o: any) => o.tipo === tipo);

describe('G3 — a reivindicação confere o frame lido e grava o entregue', () => {
  it('edição que troca o frame entre a leitura e a reivindicação: o lote para; o próximo leva o frame novo e é ele que fica confirmado', async () => {
    const m = montar();
    const ed = (await m.ops.enfileirarEdicao(1, 'x'))!;
    const frameAntigo = m.db.linhas('guarita_Operacoes').find((o: any) => o.id === ed.id_operacao).frame_hex;
    // A edição concorrente acontece logo depois da leitura da fila (antes do UPDATE).
    const updateMany = m.db.guarita_Operacoes.updateMany;
    let trocou = false;
    m.db.guarita_Operacoes.updateMany = async (a: any) => {
      if (!trocou && a?.data?.estado === 'enviada') {
        trocou = true;
        m.db.linhas('veiculos')[0].placa = 'XYZ9A87';
        await m.ops.enfileirarEdicao(1, 'x');
      }
      return updateMany(a);
    };
    const primeiro = await m.agente.buscarOperacoes(DEV);
    expect(primeiro.operacoes).toEqual([]);
    const op = m.db.linhas('guarita_Operacoes').find((o: any) => o.id === ed.id_operacao);
    expect(op.estado).toBe('pendente');
    expect(op.frame_hex).not.toBe(frameAntigo);

    const segundo = await m.agente.buscarOperacoes(DEV);
    const entregue = segundo.operacoes.find((o) => o.tipo === 'editar')!;
    expect(entregue.frame_hex).toBe(op.frame_hex);
    await m.agente.registrarResultado(DEV, entregue.id, { ok: true, codigo: 0 });
    expect(tag(m.db).guarita_frame).toBe(entregue.frame_hex);
  });

  it('recadastro depois de incerto: o frame recalculado é gravado na própria reivindicação (não fica o antigo no banco)', async () => {
    const m = montar('incerto');
    const velho = fr(308, 'B', 'ANA', 'OLD0A00');
    m.db.semear('guarita_Operacoes', [
      { id_condominio: 7, id_device: 10, id_tag: 1, tipo: 'cadastrar', estado: 'pendente', frame_hex: velho, criado_por: 'Conferir cadastro sem confirmação' },
    ]);
    const { operacoes } = await m.agente.buscarOperacoes(DEV);
    const cad = operacoes.find((o) => o.tipo === 'cadastrar')!;
    expect(cad.frame_hex).not.toBe(velho);
    const linha = m.db.linhas('guarita_Operacoes').find((o: any) => o.id === cad.id);
    expect(linha).toMatchObject({ estado: 'enviada', frame_hex: cad.frame_hex });
  });
});

describe('G2 — 0x02 sem leitura, contador do RF, desfazer e troca', () => {
  it('cadastro 0x02 sem o Ler (sem conflito informado) → incerto, não conflito', async () => {
    const m = montar('a_vincular');
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    await m.agente.buscarOperacoes(DEV);
    await m.agente.registrarResultado(DEV, id_operacao, { ok: false, codigo: 2, erro: 'Este dispositivo já está cadastrado no Guarita.' });
    expect(tag(m.db).guarita_estado).toBe('incerto');
    expect(opsDe(m.db, 'cadastrar').filter((o: any) => o.estado === 'pendente')).toHaveLength(1); // volta uma vez
  });

  it('RF com ja_estava na mesma unidade e contador andado → ok com o frame lido (o contador não é conflito)', async () => {
    const db = criarBancoFalso();
    db.semear('facial_Devices', [{ id: 10, id_condominio: 7, nome: 'Guarita', tipo: 'guarita', fabricante: 'linear', ativo: 1 }]);
    db.semear('guarita_Backups', [{ id_condominio: 7, id_device: 10, motivo: 'importacao', total: 0, dados: '[]' }]);
    db.semear('apartamentos', [{ id: 1, id_condominio: 7, bloco: 'B', apto: '308' }]);
    db.semear('moradores', [{ id: 50, id_condominio: 7, nome: 'Ana Souza', bloco: 'B', apartamento: '308' }]);
    db.semear('tags', [{ id: 1, id_condominio: 7, codigo: 'G1-1A2B3C4', id_device: 10, guarita_tipo: 1, guarita_serial: '1A2B3C4', guarita_contador: 0x1234, guarita_estado: 'pendente' }]);
    db.semear('veiculos', [{ id: 70, id_condominio: 7, id_morador: 50, placa: 'ABC1D23', cor: 'Prata', marca_modelo: 'Fiat Uno', id_tag: 1, ativo: 1 }]);
    const ops = new GuaritaOperacoesService(db as any);
    const agente = new GuaritaAgenteService(db as any, {} as any, new GuaritaImportacaoService(db as any, ops), ops);
    const { id_operacao } = await ops.enfileirarCadastro(1, 'x');
    const pedido = db.linhas('guarita_Operacoes').find((o: any) => o.id === id_operacao).frame_hex as string;
    await agente.buscarOperacoes(DEV);
    const lido = pedido.slice(0, 8) + '1240' + pedido.slice(12); // contador andou
    await agente.registrarResultado(DEV, id_operacao, { ok: true, codigo: 2, ja_estava: true, lido: { unidade: 308, bloco: 1, frame_hex: lido } });
    expect(db.linhas('tags')[0]).toMatchObject({ guarita_estado: 'gravado', guarita_frame: lido });
  });

  it('desfazer conflito com gravação entregue → apagar conferido pela unidade pedida; o veículo perde a tag', async () => {
    const m = montar('a_vincular');
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    await m.agente.buscarOperacoes(DEV);
    await m.agente.registrarResultado(DEV, id_operacao, { ok: false, codigo: 2, conflito: true, lido: { unidade: 202, bloco: 1 } });
    expect(tag(m.db).guarita_estado).toBe('conflito');
    await expect(m.ops.desfazer(7, 10, 1, 'Zé')).resolves.toEqual({ id_tag: 1, desfeito: false, removendo: true });
    expect(tag(m.db).guarita_estado).toBe('removendo');
    expect(m.db.linhas('veiculos')[0].id_tag).toBeNull();
    for (const o of m.db.linhas('guarita_Operacoes')) if (o.estado === 'enviada') o.estado = 'ok';
    const lote = await m.agente.buscarOperacoes(DEV);
    const apagar = lote.operacoes.find((o) => o.tipo === 'apagar')!;
    expect(apagar).toMatchObject({ esperado: { unidade: 308, bloco: 1 } });
    // Lá está a outra unidade: nada apagado, alerta; um segundo "desfazer" sai só do Prestare (sem laço).
    await m.agente.registrarResultado(DEV, apagar.id, { ok: false, conflito: true, lido: { unidade: 202, bloco: 1 } });
    expect(m.db.linhas('guarita_Alertas').filter((a: any) => a.tipo === 'remocao_pendente')).toHaveLength(1);
    expect(tag(m.db).guarita_estado).toBe('conflito');
    await expect(m.ops.desfazer(7, 10, 1)).resolves.toEqual({ id_tag: 1, desfeito: true });
    expect(tag(m.db)).toBeUndefined();
  });

  it('desfazer conflito sem gravação entregue (veio da importação) → só no Prestare, como antes', async () => {
    const m = montar('conflito');
    await expect(m.ops.desfazer(7, 10, 1)).resolves.toEqual({ id_tag: 1, desfeito: true });
    expect(opsDe(m.db, 'apagar')).toHaveLength(0);
  });

  it('troca de tag em conflito com gravação entregue (captura) → a antiga recebe apagar conferido', async () => {
    const m = montar('a_vincular');
    const { id_operacao } = await m.ops.enfileirarCadastro(1, 'x');
    await m.agente.buscarOperacoes(DEV);
    await m.agente.registrarResultado(DEV, id_operacao, { ok: false, codigo: 2, conflito: true, lido: { unidade: 202, bloco: 1 } });
    for (const o of m.db.linhas('guarita_Operacoes')) if (o.estado === 'enviada') o.estado = 'ok';
    const captura = new GuaritaCapturaService(m.db as any, m.agente, m.ops);
    const r = await captura.cadastrarDigitado(7, 10, { id_veiculo: 70, tipo: 3, codigo_impresso: '016 02158' }, 'Zé');
    expect(r.estado).toBe('pendente');
    expect(tag(m.db).guarita_estado).toBe('removendo');
    expect(opsDe(m.db, 'apagar').filter((o: any) => o.id_tag === 1)).toHaveLength(1);
    expect(m.db.linhas('veiculos')[0].id_tag).toBe(r.id_tag);
  });
});

describe('G5 — Guarita desativado com remoção pendente', () => {
  function facial(db: any) {
    const svc = Object.create(FacialService.prototype);
    svc.prisma = db;
    svc.logger = new Logger('teste');
    svc.auditoria = { registrar: jest.fn(async () => undefined) };
    svc.agent = { isOnline: () => false };
    return svc as any;
  }

  it('desativar (ou trocar o tipo) com tag removendo ou apagar na fila → 409; sem remoção, desativa', async () => {
    const m = montar('removendo');
    m.db.linhas('facial_Devices')[0].ip = '1.1.1.1';
    m.db.linhas('facial_Devices')[0].porta = 9000;
    const svc = facial(m.db);
    await expect(svc.updateDevice(10, { ativo: 0 })).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.updateDevice(10, { tipo: 'botoeira', fabricante: 'genérico' })).rejects.toBeInstanceOf(ConflictException);
    expect(m.db.linhas('facial_Devices')[0].ativo).toBe(1);

    tag(m.db).guarita_estado = 'ativo';
    m.db.semear('guarita_Operacoes', [{ id_condominio: 7, id_device: 10, id_tag: 1, tipo: 'apagar', estado: 'enviada' }]);
    await expect(svc.updateDevice(10, { ativo: 0 })).rejects.toBeInstanceOf(ConflictException);

    m.db.linhas('guarita_Operacoes')[0].estado = 'ok';
    await svc.updateDevice(10, { ativo: 0 });
    expect(m.db.linhas('facial_Devices')[0].ativo).toBe(0);
  });

  it('apagar enfileirado com o Guarita desativado abre alerta remocao_pendente (a remoção fica na fila)', async () => {
    const m = montar('ativo');
    m.db.linhas('facial_Devices')[0].ativo = 0;
    expect(await m.ops.enfileirarRemocao(1, 'x')).toBe(true);
    expect(opsDe(m.db, 'apagar')[0].estado).toBe('pendente');
    const alertas = m.db.linhas('guarita_Alertas').filter((a: any) => a.tipo === 'remocao_pendente');
    expect(alertas).toHaveLength(1);
    expect(alertas[0].descricao).toMatch(/desativado/);
  });

  it('Guarita ativo: enfileirar a remoção não abre alerta', async () => {
    const m = montar('ativo');
    await m.ops.enfileirarRemocao(1, 'x');
    expect(m.db.linhas('guarita_Alertas')).toHaveLength(0);
  });
});

describe('G6 — passagem só é do dono com tag gravada e na unidade dele', () => {
  const hex = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  // Evento tipo 0 de CT 0F086E, receptor CT 1, unidade/bloco do parâmetro.
  const evt = (unid: string, bloco = '01') => hex(`00 0F 08 6E 14 35 07 15 11 26 30 ${unid} ${bloco} 10 00`);
  const lote = (frames: string[]) => ({
    eventos: frames.map((frame_hex) => ({ frame_hex, origem: 'ao_vivo', recebido_em: '2026-11-15T17:35:10Z' })),
    relogio_delta_s: 0,
  });

  function comEventos(estadoTag: string) {
    const m = montar(estadoTag);
    const eventos = new GuaritaEventosService(m.db as any);
    const agente = new GuaritaAgenteService(m.db as any, {} as any, undefined, undefined, eventos);
    return { ...m, agente };
  }

  it('tag ativa e evento da unidade da dona → Ana; evento de outra unidade → não identificado · unidade 202', async () => {
    const m = comEventos('ativo');
    await m.agente.registrarEventos(DEV, lote([evt('03 08'), evt('02 02')]));
    const nomes = m.db.linhas('acessos_Facial').map((a: any) => [a.tipo_pessoa, a.nome_pessoa]);
    expect(nomes).toEqual([
      ['morador', 'Ana Souza'],
      ['desconhecido', 'Não identificado · unidade 202 bloco B'],
    ]);
  });

  it.each(['conflito', 'ausente', 'removendo', 'a_vincular'])('tag %s → não identificado, mesmo na unidade da dona', async (estado) => {
    const m = comEventos(estado);
    await m.agente.registrarEventos(DEV, lote([evt('03 08')]));
    expect(m.db.linhas('acessos_Facial')[0]).toMatchObject({ tipo_pessoa: 'desconhecido', id_pessoa: null });
  });
});

describe('G7 — um controle por Guarita (chave única)', () => {
  it('violouChaveDoGuarita reconhece o nome do índice (MySQL) e a lista de campos', () => {
    expect(violouChaveDoGuarita({ code: 'P2002', meta: { target: 'un_tag_guarita' } })).toBe(true);
    expect(violouChaveDoGuarita({ code: 'P2002', meta: { target: ['id_device', 'guarita_tipo', 'guarita_serial'] } })).toBe(true);
    expect(violouChaveDoGuarita({ code: 'P2002', meta: { target: 'un_tag_cond_codigo' } })).toBe(false);
    expect(violouChaveDoGuarita({ code: 'P2025' })).toBe(false);
  });

  it('duas confirmações ao mesmo tempo: a segunda recebe "já está cadastrado", e fica uma tag só', async () => {
    const m = montar('ativo');
    m.db.semear('veiculos', [{ id: 71, id_condominio: 7, id_morador: 50, placa: 'DEF4G56', cor: 'Preto', marca_modelo: 'Fiat Uno', id_tag: null, ativo: 1 }]);
    m.db.semear('veiculos', [{ id: 72, id_condominio: 7, id_morador: 50, placa: 'GHI7J89', cor: 'Preto', marca_modelo: 'Fiat Uno', id_tag: null, ativo: 1 }]);
    const captura = new GuaritaCapturaService(m.db as any, m.agente, m.ops);
    // As duas passam pela conferência de repetida antes de qualquer uma criar.
    const findFirst = m.db.tags.findFirst;
    let conferencias = 0;
    let liberar: () => void = () => undefined;
    const ambas = new Promise<void>((r) => (liberar = r));
    m.db.tags.findFirst = async (a: any) => {
      const r = await findFirst(a);
      if (a?.where?.guarita_serial === '10086E' && a?.where?.guarita_tipo === 3) {
        conferencias++;
        if (conferencias === 2) liberar();
        await ambas;
      }
      return r;
    };
    const resultados = await Promise.allSettled([
      captura.cadastrarDigitado(7, 10, { id_veiculo: 71, tipo: 3, codigo_impresso: '016 02158' }, 'A'),
      captura.cadastrarDigitado(7, 10, { id_veiculo: 72, tipo: 3, codigo_impresso: '016 02158' }, 'B'),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const recusada = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(recusada.reason).toBeInstanceOf(BadRequestException);
    expect(recusada.reason.message).toBe('Este dispositivo já está cadastrado neste Guarita.');
    expect(m.db.linhas('tags').filter((t: any) => t.guarita_serial === '10086E')).toHaveLength(1);
  });
});
