import { BadRequestException, Logger } from '@nestjs/common';
import { criarBancoFalso } from './guarita-banco-falso.testutil';
import { GuaritaOperacoesService, nomeCurto } from './guarita-operacoes.service';
import { GuaritaAgenteService } from './guarita-agente.service';
import { GuaritaController } from './guarita.controller';
import { GuaritaImportacaoService } from './guarita-importacao.service';
import { TagsService } from '../veiculos/tags.service';
import { VeiculosService } from '../veiculos/veiculos.service';
import { MoradoresService } from '../moradores/moradores.service';
import { MobileAuthService } from '../auth/mobile-auth.service';

/**
 * Gravação no Guarita a partir de Veículos/Tags e remoção quando o morador
 * sai. O invariante central: NUNCA `apagar` para dispositivo que o Prestare
 * não conhece (`a_vincular`) nem para tag que não é de Guarita.
 */

const OPERADOR: any = { sub: 1, nome: 'Síndica Lia', id_condominio: 7 };
const hex = (s: string) => s.replace(/\s+/g, '').toUpperCase();

function montar(opts: { semCopia?: boolean; semGuarita?: boolean } = {}) {
  const db = criarBancoFalso();
  if (!opts.semGuarita) {
    db.semear('facial_Devices', [{ id: 10, id_condominio: 7, nome: 'Guarita', tipo: 'guarita', fabricante: 'linear', ativo: 1 }]);
  }
  db.semear('facial_Devices', [{ id: 11, id_condominio: 7, nome: 'Facial', tipo: 'facial', fabricante: 'intelbras', ativo: 1 }]);
  if (!opts.semCopia && !opts.semGuarita) {
    db.semear('guarita_Backups', [{ id_condominio: 7, id_device: 10, motivo: 'importacao', total: 0, dados: '[]' }]);
  }
  db.semear('apartamentos', [{ id: 1, id_condominio: 7, bloco: 'B', apto: '308' }]);
  db.semear('moradores', [
    { id: 50, id_condominio: 7, nome: 'Ana Maria de Souza', bloco: 'B', apartamento: '308', id_user: 500, ativo: 1 },
    { id: 51, id_condominio: 7, nome: 'Bruno Lima', bloco: 'B', apartamento: '308', id_user: 501, ativo: 1 },
  ]);
  const ops = new GuaritaOperacoesService(db as any);
  return { db, ops };
}

/** Tag de Guarita ligada a um veículo do morador. */
function tagComVeiculo(db: any, o: { idTag: number; idVeiculo: number; idMorador: number; estado: string; serial: string; tipo?: number; placa?: string; contador?: number | null; frame?: string | null; idDevice?: number | null }) {
  const tipo = o.tipo ?? 2;
  db.semear('tags', [
    {
      id: o.idTag,
      id_condominio: 7,
      codigo: `G${tipo}-${o.serial}`,
      tipo: 'tag_ativo',
      id_device: o.idDevice === undefined ? 10 : o.idDevice,
      guarita_tipo: o.idDevice === null ? null : tipo,
      guarita_serial: o.idDevice === null ? null : o.serial,
      guarita_contador: o.contador ?? null,
      guarita_estado: o.estado,
      guarita_frame: o.frame ?? null,
    },
  ]);
  db.semear('veiculos', [
    { id: o.idVeiculo, id_condominio: 7, id_morador: o.idMorador, placa: o.placa ?? `PLC${o.idVeiculo}A00`, cor: 'Prata', marca_modelo: 'Fiat Uno', id_tag: o.idTag, ativo: 1 },
  ]);
}

const apagares = (db: any) => db.linhas('guarita_Operacoes').filter((o: any) => o.tipo === 'apagar');

describe('Guarita — frame do cadastro', () => {
  it('veículo real do fixture: confere byte a byte', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '0F086E', placa: 'abc-1d23' });
    await ops.enfileirarCadastro(1, 'teste');
    const op = db.linhas('guarita_Operacoes').find((o: any) => o.tipo === 'cadastrar');
    const esperado = hex(`
      20 0F 08 6E 00 00 03 08 01 00 FF
      ${Buffer.from('ANA SOUZA         ', 'ascii').toString('hex')}
      00 06 0A ${Buffer.from('ABC1D23', 'ascii').toString('hex')}`);
    expect(op.frame_hex).toBe(esperado);
    expect(op.id_tag).toBe(1);
    expect(db.linhas('tags')[0].guarita_estado).toBe('pendente');
  });

  it('grupo/receptores do cadastro novo = os mais frequentes entre os do mesmo tipo já lidos do Guarita', async () => {
    const { db, ops } = montar();
    const lido = (serial: string, grupo: string, rec: string) =>
      hex(`20 ${serial} 00 00 00 01 00 ${grupo} ${rec}`) + '20'.repeat(18) + '00160' + '0' + '20'.repeat(7);
    db.semear('tags', [
      { id: 90, id_condominio: 7, codigo: 'G2-000090', id_device: 10, guarita_tipo: 2, guarita_serial: '000090', guarita_estado: 'a_vincular', guarita_frame: lido('00 00 90', '03', '0B') },
      { id: 91, id_condominio: 7, codigo: 'G2-000091', id_device: 10, guarita_tipo: 2, guarita_serial: '000091', guarita_estado: 'a_vincular', guarita_frame: lido('00 00 91', '03', '0B') },
      { id: 92, id_condominio: 7, codigo: 'G2-000092', id_device: 10, guarita_tipo: 2, guarita_serial: '000092', guarita_estado: 'a_vincular', guarita_frame: lido('00 00 92', '00', 'FF') },
    ]);
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '0F086E' });
    await ops.enfileirarCadastro(1, 'teste');
    const f = db.linhas('guarita_Operacoes').find((o: any) => o.tipo === 'cadastrar').frame_hex;
    expect(f.slice(18, 22)).toBe('030B');
  });

  it('RF digitado (sem contador) → 400 com a mensagem da captura', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'pendente', serial: '1A2B3C4', tipo: 1, contador: null });
    await expect(ops.enfileirarCadastro(1, 'x')).rejects.toThrow('Controle remoto só pode ser cadastrado por captura no Guarita.');
    expect(db.linhas('guarita_Operacoes')).toHaveLength(0);
  });

  it('I4: unidade em texto sem número compatível → não grava (sem operação) e a tag mostra o motivo', async () => {
    const { db, ops } = montar();
    db.linhas('moradores').find((m: any) => m.id === 50).apartamento = '308A';
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '0F086E' });
    await expect(ops.enfileirarCadastro(1, 'x')).rejects.toThrow("A unidade 'B / 308A' não tem número compatível com o Guarita.");
    expect(db.linhas('guarita_Operacoes')).toHaveLength(0);
    expect(db.linhas('tags')[0]).toMatchObject({ guarita_estado: 'falhou', guarita_erro: "A unidade 'B / 308A' não tem número compatível com o Guarita." });
  });

  it('I4: bloco vazio vira A só se nenhum apartamento do condomínio tem bloco', async () => {
    const { db, ops } = montar();
    db.linhas('moradores').find((m: any) => m.id === 50).bloco = '';
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '0F086E' });
    await expect(ops.enfileirarCadastro(1, 'x')).rejects.toThrow(/não tem número compatível/);
    db.linhas('apartamentos')[0].bloco = null;
    db.linhas('tags')[0].guarita_estado = 'a_vincular';
    await ops.enfileirarCadastro(1, 'x');
    const op = db.linhas('guarita_Operacoes').find((o: any) => o.tipo === 'cadastrar');
    expect(op.frame_hex.slice(12, 18)).toBe('030800');
  });

  it('nome curto do morador no rótulo', () => {
    expect(nomeCurto('Maria Conceição dos Santos')).toBe('Maria Santos');
    expect(nomeCurto('Ana')).toBe('Ana');
  });
});

describe('Guarita — fila e resultado', () => {
  it('gravação bloqueada até existir cópia: a primeira gravação cria antes uma importação', async () => {
    const { db, ops } = montar({ semCopia: true });
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '0F086E' });
    await ops.enfileirarCadastro(1, 'teste');
    const lista = db.linhas('guarita_Operacoes').map((o: any) => o.tipo);
    expect(lista).toEqual(['importar', 'cadastrar', 'atualizar_receptores']);
    const agente = new GuaritaAgenteService(db as any, {} as any);
    const r = await agente.buscarOperacoes({ id: 10, id_condominio: 7, nome: 'G' });
    expect(r.operacoes.map((o) => o.tipo)).toEqual(['importar']);
  });

  it('dois pedidos para a mesma tag: em ordem, e o resultado da 1ª não sobrescreve o estado antes do da 2ª', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '0F086E' });
    const a = await ops.enfileirarCadastro(1, 'A');
    // Edição com o cadastro ainda NÃO entregue: só troca o frame dele.
    db.linhas('veiculos')[0].placa = 'NEW1A23';
    const fundido = await new GuaritaOperacoesService(db as any).enfileirarEdicao(1, 'B');
    expect(fundido?.id_operacao).toBe(a.id_operacao);
    expect(db.linhas('guarita_Operacoes').filter((o: any) => o.tipo === 'editar')).toHaveLength(0);
    // Cadastro entregue (em voo): a edição entra atrás dele.
    db.linhas('guarita_Operacoes').find((o: any) => o.id === a.id_operacao).estado = 'enviada';
    db.linhas('veiculos')[0].placa = 'NEW2B34';
    const b = (await new GuaritaOperacoesService(db as any).enfileirarEdicao(1, 'B'))!;
    expect(a.id_operacao).toBeLessThan(b.id_operacao);
    expect(db.linhas('guarita_Operacoes').filter((o: any) => o.tipo === 'atualizar_receptores' && o.estado === 'pendente')).toHaveLength(1);

    await ops.aplicarResultado(a.id_operacao, { ok: true, codigo: 0 });
    const tag = () => db.linhas('tags')[0];
    expect(tag().guarita_estado).toBe('pendente'); // a edição ainda está aberta
    expect(tag().guarita_frame).toBe(db.linhas('guarita_Operacoes').find((o: any) => o.id === a.id_operacao).frame_hex);

    await ops.aplicarResultado(b.id_operacao, { ok: true, codigo: 0 });
    expect(tag().guarita_estado).toBe('gravado');
  });

  it('falhou grava guarita_erro com a mensagem do 67; repetido não muda nada', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '0F086E' });
    const { id_operacao } = await ops.enfileirarCadastro(1, 'x');
    await ops.aplicarResultado(id_operacao, { ok: false, codigo: 1 });
    expect(db.linhas('tags')[0]).toMatchObject({ guarita_estado: 'falhou', guarita_erro: 'Memória do Guarita cheia.' });
    await ops.aplicarResultado(id_operacao, { ok: true, codigo: 0 });
    expect(db.linhas('tags')[0].guarita_estado).toBe('falhou');
  });

  it('gravado só com 0x00; ativo só depois do 29 (atualizar_receptores)', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '0F086E' });
    const { id_operacao } = await ops.enfileirarCadastro(1, 'x');
    await ops.aplicarResultado(id_operacao, { ok: true, codigo: 0 });
    expect(db.linhas('tags')[0].guarita_estado).toBe('gravado');
    const atualizar = db.linhas('guarita_Operacoes').find((o: any) => o.tipo === 'atualizar_receptores');
    await ops.aplicarResultado(atualizar.id, { ok: false, erro: 'O Guarita não respondeu.' });
    expect(db.linhas('tags')[0].guarita_estado).toBe('gravado');
    // nova rodada: outra gravação traz outro atualizar
    const ed = await ops.enfileirarEdicao(1, 'x');
    await ops.aplicarResultado(ed.id_operacao, { ok: true, codigo: 0 });
    const outro = db.linhas('guarita_Operacoes').filter((o: any) => o.tipo === 'atualizar_receptores' && o.estado === 'pendente')[0];
    await ops.aplicarResultado(outro.id, { ok: true, codigo: 0 });
    expect(db.linhas('tags')[0].guarita_estado).toBe('ativo');
  });

  it('apagar ok (ou 0x03 "não encontrado") tira a tag do Prestare', async () => {
    for (const r of [{ ok: true, codigo: 0 }, { ok: false, codigo: 3 }]) {
      const { db, ops } = montar();
      tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'ativo', serial: '0F086E' });
      await ops.enfileirarRemocao(1, 'x');
      const op = apagares(db)[0];
      expect(op.frame_hex).toBe(hex('20 0F 08 6E') + '00'.repeat(35));
      await ops.aplicarResultado(op.id, r);
      expect(db.linhas('tags')).toHaveLength(0);
      expect(db.linhas('veiculos')[0].id_tag).toBeNull();
    }
  });
});

describe('Guarita — nunca apaga o que o Prestare não conhece', () => {
  it('a_vincular, tag comum e aguardando aprovação: enfileirarRemocao não gera apagar', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '000001' });
    tagComVeiculo(db, { idTag: 2, idVeiculo: 71, idMorador: 50, estado: 'aguardando_aprovacao', serial: '000002' });
    tagComVeiculo(db, { idTag: 3, idVeiculo: 72, idMorador: 50, estado: null as any, serial: '000003', idDevice: null });
    expect(await ops.enfileirarRemocao(1, 'x')).toBe(false);
    expect(await ops.enfileirarRemocao(2, 'x')).toBe(false);
    expect(await ops.enfileirarRemocao(3, 'x')).toBe(false);
    expect(apagares(db)).toHaveLength(0);
  });

  it('excluir/bloquear tag a_vincular pela tela de Tags: sai do Prestare, nada vai para o Guarita', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '000001' });
    tagComVeiculo(db, { idTag: 2, idVeiculo: 71, idMorador: 50, estado: 'a_vincular', serial: '000002' });
    const tags = new TagsService(db as any, ops);
    // I8: bloquear o que o Prestare não gravou no Guarita é recusado (o portão continuaria abrindo).
    for (const estado of ['a_vincular', 'conflito', 'ausente', 'aguardando_aprovacao', 'recusada']) {
      db.linhas('tags').find((t: any) => t.id === 2).guarita_estado = estado;
      await expect(tags.definirAtivo(7, 2, false)).rejects.toThrow('Esta tag ainda não está sob controle do Prestare no Guarita.');
    }
    db.linhas('tags').find((t: any) => t.id === 2).guarita_estado = 'a_vincular';
    await expect(tags.remove(7, 1)).resolves.toEqual({ ok: true, guarita_remocoes: 0 });
    expect(apagares(db)).toHaveLength(0);
    expect(db.linhas('tags').map((t: any) => t.id)).toEqual([2]);
    expect(db.linhas('tags')[0].ativo).toBe(1);
  });

  it('excluir veículo com tag a_vincular: sem apagar', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '000001' });
    const veiculos = new VeiculosService(db as any, ops);
    await veiculos.remove(7, 70);
    expect(apagares(db)).toHaveLength(0);
  });

  it('conferência + exclusão de morador: nenhuma combinação gera apagar de a_vincular', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '000001' });
    await expect(ops.enfileirarRemocoes(await ops.tagsDoMorador(50), 'x')).resolves.toBe(0);
    expect(apagares(db)).toHaveLength(0);
  });
});

describe('Guarita — exclusão do morador (MoradoresService.remove)', () => {
  function moradoresService(db: any, ops: GuaritaOperacoesService) {
    const facial: any = { unsyncMorador: jest.fn(async () => true) };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const svc = new MoradoresService(db, {} as any, {} as any, facial, auditoria, {} as any, undefined, undefined, ops);
    (svc as any).carregarContextoMorador = jest.fn(async () => null);
    // Cascata do banco: apagar o morador leva os veículos dele.
    const apagar = db.moradores.delete;
    db.moradores.delete = async (args: any) => {
      await db.veiculos.deleteMany({ where: { id_morador: args.where.id } });
      return apagar(args);
    };
    return svc;
  }

  it('morador com 2 tags gera 2 remoções; não toca tags de outros moradores nem tags comuns', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'ativo', serial: '000001' });
    tagComVeiculo(db, { idTag: 2, idVeiculo: 71, idMorador: 50, estado: 'gravado', serial: '000002' });
    tagComVeiculo(db, { idTag: 3, idVeiculo: 72, idMorador: 50, estado: 'a_vincular', serial: '000003' });
    tagComVeiculo(db, { idTag: 4, idVeiculo: 73, idMorador: 51, estado: 'ativo', serial: '000004' });
    db.semear('tags', [{ id: 5, id_condominio: 7, codigo: 'BC614E', tipo: 'rfid' }]);
    db.semear('veiculos', [{ id: 74, id_condominio: 7, id_morador: 50, placa: 'COM1M00', id_tag: 5, ativo: 1 }]);
    const svc = moradoresService(db, ops);

    const r = await svc.remove(50, OPERADOR);

    expect(r).toEqual({ guarita_remocoes: 2 });
    expect(apagares(db).map((o: any) => o.id_tag).sort()).toEqual([1, 2]);
    const estados = Object.fromEntries(db.linhas('tags').map((t: any) => [t.id, t.guarita_estado ?? null]));
    expect(estados).toEqual({ 1: 'removendo', 2: 'removendo', 3: 'a_vincular', 4: 'ativo', 5: null });
  });

  it('condomínio sem Guarita: a resposta da exclusão continua vazia', async () => {
    const { db, ops } = montar({ semGuarita: true });
    db.semear('tags', [{ id: 5, id_condominio: 7, codigo: 'BC614E', tipo: 'rfid' }]);
    db.semear('veiculos', [{ id: 74, id_condominio: 7, id_morador: 50, placa: 'COM1M00', id_tag: 5, ativo: 1 }]);
    const svc = moradoresService(db, ops);
    await expect(svc.remove(50, OPERADOR)).resolves.toBeUndefined();
    expect(db.linhas('guarita_Operacoes')).toHaveLength(0);
  });
});

describe('Guarita — Veículos e Tags do console', () => {
  it('excluir veículo com tag gravada → remoção na fila; a tag some só depois da confirmação', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'ativo', serial: '000001' });
    const veiculos = new VeiculosService(db as any, ops);
    await expect(veiculos.remove(7, 70)).resolves.toEqual({ ok: true, guarita_remocoes: 1 });
    expect(db.linhas('tags')[0].guarita_estado).toBe('removendo');
  });

  it('editar placa do veículo com tag gravada → edição com o frame do Guarita como base', async () => {
    const { db, ops } = montar();
    const base = hex('20 00 00 01 00 00 03 08 01 05 0B') + '20'.repeat(18) + '83' + '16' + '00' + '20'.repeat(7);
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'ativo', serial: '000001', frame: base, placa: 'ABC1D23' });
    const veiculos = new VeiculosService(db as any, ops);
    // O fake não faz include: devolve a tag junto como o Prisma faria.
    const update = db.veiculos.update;
    db.veiculos.update = async (a: any) => ({ ...(await update(a)), tag: db.linhas('tags')[0] });
    await veiculos.update(7, 70, { placa: 'XYZ9A87', cor: 'Prata', marca_modelo: 'Fiat Uno', id_tag: 1 });
    const ed = db.linhas('guarita_Operacoes').find((o: any) => o.tipo === 'editar');
    expect(ed.frame_hex.slice(18, 22)).toBe('050B'); // grupo e receptores do Guarita
    expect(ed.frame_hex.slice(58, 60)).toBe('83'); // flags só leitura preservadas
    expect(Buffer.from(ed.frame_hex.slice(64), 'hex').toString('ascii')).toBe('XYZ9A87');
  });

  it('tag a_vincular escolhida no cadastro do veículo vira ativa, sem gravar', async () => {
    const { db, ops } = montar();
    db.semear('tags', [{ id: 9, id_condominio: 7, codigo: 'G2-000009', id_device: 10, guarita_tipo: 2, guarita_serial: '000009', guarita_estado: 'a_vincular' }]);
    const veiculos = new VeiculosService(db as any, ops);
    const create = db.veiculos.create;
    db.veiculos.create = async (a: any) => ({ ...(await create(a)), tag: db.linhas('tags')[0] });
    await veiculos.create(7, 50, { placa: 'ABC1D23', id_tag: 9 });
    expect(db.linhas('tags')[0].guarita_estado).toBe('ativo');
    expect(db.linhas('guarita_Operacoes')).toHaveLength(0);
  });

  it('bloquear tag gravada → remoção; reativar durante a remoção → 400', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'ativo', serial: '000001' });
    const tags = new TagsService(db as any, ops);
    await expect(tags.definirAtivo(7, 1, false)).resolves.toMatchObject({ ativo: 0, guarita_remocoes: 1 });
    await expect(tags.definirAtivo(7, 1, true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('condomínio sem Guarita: Tags e Veículos como antes', async () => {
    const { db, ops } = montar({ semGuarita: true });
    db.semear('tags', [{ id: 5, id_condominio: 7, codigo: 'BC614E', tipo: 'rfid', ativo: 1 }]);
    db.semear('veiculos', [{ id: 74, id_condominio: 7, id_morador: 50, placa: 'COM1M00', id_tag: 5, ativo: 1 }]);
    const tags = new TagsService(db as any, ops);
    await expect(tags.definirAtivo(7, 5, false)).resolves.not.toHaveProperty('guarita_remocoes');
    const veiculos = new VeiculosService(db as any, ops);
    await expect(veiculos.remove(7, 74)).resolves.toEqual({ ok: true });
    await expect(tags.remove(7, 5)).resolves.toEqual({ ok: true });
    expect(db.linhas('guarita_Operacoes')).toHaveLength(0);
  });
});

describe('Guarita — tag vinculada pelo morador no app (payloads do app 1.2.49)', () => {
  function app(db: any, ops: GuaritaOperacoesService | undefined) {
    const svc = Object.create(MobileAuthService.prototype);
    svc.prisma = db;
    svc.guarita = ops;
    svc.logger = new Logger('teste');
    // O banco falso não faz `include`: anexa a tag como o Prisma faria.
    const findMany = db.veiculos.findMany;
    if (!(findMany as any).comTag) {
      db.veiculos.findMany = Object.assign(
        async (a: any) => {
          const vs = await findMany(a);
          if (!a?.include?.tag) return vs;
          const tags = db.linhas('tags');
          return vs.map((v: any) => ({ ...v, tag: tags.find((t: any) => t.id === v.id_tag) ?? null }));
        },
        { comTag: true },
      );
    }
    return svc as any;
  }

  it('condomínio com Guarita: vincular pelo app → aguardando_aprovacao, sem operação; o app vê guarita_estado', async () => {
    const { db, ops } = montar();
    const svc = app(db, ops);
    // insert do app 1.2.49: { placa, cor, marca_modelo, tag_codigo }
    const criado = await svc.criarVeiculoMorador(500, 7, { placa: 'ABC1D23', cor: 'Prata', marca_modelo: 'Fiat Uno', tag_codigo: '015 02158' });
    expect(criado.guarita_estado).toBe('aguardando_aprovacao');
    expect(criado).toHaveProperty('guarita_erro', null);
    const tag = db.linhas('tags')[0];
    expect(tag).toMatchObject({ id_device: 10, guarita_estado: 'aguardando_aprovacao', guarita_serial: '0F086E' });
    expect(db.linhas('guarita_Operacoes')).toHaveLength(0);
    const lista = await svc.listVeiculosByUser(500, 7);
    expect(lista[0]).toMatchObject({ placa: 'ABC1D23', guarita_estado: 'aguardando_aprovacao' });
  });

  it('condomínio sem Guarita: o mesmo payload dá a mesma resposta de hoje (sem campos novos)', async () => {
    const semGuarita = montar({ semGuarita: true });
    const comServico = app(semGuarita.db, semGuarita.ops);
    const antigo = montar({ semGuarita: true });
    const semServico = app(antigo.db, undefined);
    const payload = { placa: 'ABC1D23', cor: 'Prata', marca_modelo: 'Fiat Uno', tag_codigo: '015 02158' };
    const a = await comServico.criarVeiculoMorador(500, 7, payload);
    const b = await semServico.criarVeiculoMorador(500, 7, payload);
    const limpar = (v: any) => ({ ...v, created_at: undefined, updated_at: undefined });
    expect(limpar(a)).toEqual(limpar(b));
    expect(a).not.toHaveProperty('guarita_estado');
    const la = await comServico.listVeiculosByUser(500, 7);
    const lb = await semServico.listVeiculosByUser(500, 7);
    expect(la).toEqual(lb);
    expect(la[0]).not.toHaveProperty('guarita_estado');
    expect(await comServico.atualizarVeiculoMorador(500, 7, { id: a.id, ...payload })).toEqual({ ok: true });
    expect(await comServico.removerVeiculoMorador(500, 7, a.id)).toEqual({ ok: true });
    expect(semGuarita.db.linhas('guarita_Operacoes')).toHaveLength(0);
  });

  it('para o app: conflito sai como falhou com explicação; ausente e a_vincular não são enviados; erro vai junto', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'conflito', serial: '0F086E' });
    const svc = app(db, ops);
    expect((await svc.listVeiculosByUser(500, 7))[0]).toMatchObject({
      guarita_estado: 'falhou',
      guarita_erro: 'Este código já está em uso em outra unidade. Procure a portaria.',
    });
    for (const e of ['ausente', 'a_vincular']) {
      db.linhas('tags')[0].guarita_estado = e;
      const v = (await svc.listVeiculosByUser(500, 7))[0];
      expect(v).not.toHaveProperty('guarita_estado');
      expect(v).not.toHaveProperty('guarita_erro');
    }
    for (const e of ['remocao_falhou']) {
      db.linhas('tags')[0].guarita_estado = e;
      expect((await svc.listVeiculosByUser(500, 7))[0]).not.toHaveProperty('guarita_estado');
    }
    db.linhas('tags')[0].guarita_estado = 'incerto';
    expect((await svc.listVeiculosByUser(500, 7))[0]).toMatchObject({ guarita_estado: 'pendente', guarita_vale_no_portao: false });
    db.linhas('tags')[0].guarita_estado = 'gravado';
    expect((await svc.listVeiculosByUser(500, 7))[0]).toMatchObject({ guarita_estado: 'gravado', guarita_vale_no_portao: false });
    db.linhas('tags')[0].guarita_estado = 'ativo';
    expect((await svc.listVeiculosByUser(500, 7))[0]).toMatchObject({ guarita_estado: 'ativo', guarita_vale_no_portao: true });
    Object.assign(db.linhas('tags')[0], { guarita_estado: 'falhou', guarita_erro: 'Memória do Guarita cheia.' });
    expect((await svc.listVeiculosByUser(500, 7))[0]).toMatchObject({ guarita_estado: 'falhou', guarita_erro: 'Memória do Guarita cheia.' });
  });

  it('o app reenvia o código da tag do Guarita a cada edição: nada muda', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'ativo', serial: '0F086E', placa: 'ABC1D23' });
    const svc = app(db, ops);
    await expect(svc.atualizarVeiculoMorador(500, 7, { id: 70, placa: 'ABC1D23', tag_codigo: 'G2-0F086E' })).resolves.toEqual({
      ok: true,
      guarita_estado: 'ativo',
      guarita_erro: null,
      guarita_vale_no_portao: true,
    });
    expect(db.linhas('tags')).toHaveLength(1);
    expect(db.linhas('veiculos')[0].id_tag).toBe(1);
    expect(db.linhas('guarita_Operacoes')).toHaveLength(0);
  });

  it('morador apaga o veículo com tag gravada → remoção na fila; resposta igual à de hoje', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'ativo', serial: '0F086E' });
    const svc = app(db, ops);
    await expect(svc.removerVeiculoMorador(500, 7, 70)).resolves.toEqual({ ok: true });
    expect(apagares(db)).toHaveLength(1);
  });

  it('I10: aprovar exige tipo e código impresso (sem padrão); RF → captura; repetido em qualquer tipo → 400', async () => {
    const { db, ops } = montar();
    const svc = app(db, ops);
    await svc.criarVeiculoMorador(500, 7, { placa: 'ABC1D23', tag_codigo: '015 02158' });
    const ctrl = new GuaritaController(new GuaritaImportacaoService(db as any), ops, {} as any, {} as any, {} as any);
    const [t1] = db.linhas('tags');
    await expect(ctrl.aprovar(7, 10, t1.id, {}, OPERADOR)).rejects.toThrow(/Informe o tipo/);
    await expect(ctrl.aprovar(7, 10, t1.id, { tipo: 6 }, OPERADOR)).rejects.toThrow('Código inválido. Use o formato impresso no cartão: 015 02158.');
    await expect(ctrl.aprovar(7, 10, t1.id, { tipo: 1, codigo_impresso: '015 02158' }, OPERADOR)).rejects.toThrow(
      'Controle remoto só pode ser cadastrado por captura no Guarita.',
    );
    db.semear('tags', [{ id_condominio: 7, codigo: 'G3-0F086E', id_device: 10, guarita_tipo: 3, guarita_serial: '0F086E', guarita_estado: 'a_vincular' }]);
    await expect(ctrl.aprovar(7, 10, t1.id, { tipo: 6, codigo_impresso: '015 02158' }, OPERADOR)).rejects.toThrow(/já está cadastrado/);
    db.linhas('tags').pop();
    await expect(ctrl.aprovar(7, 10, t1.id, { tipo: 3, codigo_impresso: 'W: 015 02158' }, OPERADOR)).resolves.toMatchObject({ estado: 'pendente' });
    const cad = db.linhas('guarita_Operacoes').find((o: any) => o.tipo === 'cadastrar');
    expect(cad.frame_hex.slice(0, 8)).toBe('300F086E');
  });

  it('I10: recusar grava recusada (persistente): o MESMO código salvo de novo pelo app não volta; outro código volta a aguardar', async () => {
    const { db, ops } = montar();
    const svc = app(db, ops);
    const v = await svc.criarVeiculoMorador(501, 7, { placa: 'XYZ9A87', tag_codigo: 'ABCDEF12' });
    const ctrl = new GuaritaController(new GuaritaImportacaoService(db as any), ops, {} as any, {} as any, {} as any);
    const t2 = db.linhas('tags')[0];
    await expect(ctrl.recusar(7, 10, t2.id, OPERADOR)).resolves.toEqual({ id_tag: t2.id, estado: 'recusada' });
    // O morador corrige a cor no app (o app reenvia o código).
    await svc.atualizarVeiculoMorador(501, 7, { id: v.id, placa: 'XYZ9A87', cor: 'Azul', tag_codigo: 'ABCDEF12' });
    expect(db.linhas('tags').find((t: any) => t.id === t2.id).guarita_estado).toBe('recusada');
    expect(db.linhas('veiculos').find((x: any) => x.id === v.id).id_tag).toBe(t2.id);
    // Código diferente: outra tag, de novo aguardando aprovação.
    await svc.atualizarVeiculoMorador(501, 7, { id: v.id, placa: 'XYZ9A87', tag_codigo: '015 02158' });
    const nova = db.linhas('veiculos').find((x: any) => x.id === v.id).id_tag;
    expect(db.linhas('tags').find((t: any) => t.id === nova).guarita_estado).toBe('aguardando_aprovacao');
    expect(db.linhas('guarita_Operacoes')).toHaveLength(0);
  });
});

describe('Guarita — atualizar receptores pelo console', () => {
  it('enfileira no máximo um pendente', async () => {
    const { db, ops } = montar();
    const a = await ops.solicitarAtualizarReceptores(7, 10, 'x');
    const b = await ops.solicitarAtualizarReceptores(7, 10, 'x');
    expect(a).toMatchObject({ tipo: 'atualizar_receptores', estado: 'pendente' });
    expect(b.id).toBe(a.id);
    expect(db.linhas('guarita_Operacoes')).toHaveLength(1);
  });
});

describe('Guarita — resultado pela rota do agente', () => {
  it('POST resultado de cadastrar chega ao aplicarResultado (gravado) e o 29 leva a ativo', async () => {
    const { db, ops } = montar();
    tagComVeiculo(db, { idTag: 1, idVeiculo: 70, idMorador: 50, estado: 'a_vincular', serial: '0F086E' });
    await ops.enfileirarCadastro(1, 'x');
    const agente = new GuaritaAgenteService(db as any, {} as any, undefined, ops);
    const dev = { id: 10, id_condominio: 7, nome: 'G' };
    const { operacoes } = await agente.buscarOperacoes(dev);
    expect(operacoes.map((o) => o.tipo)).toEqual(['cadastrar', 'atualizar_receptores']);
    await agente.registrarResultado(dev, operacoes[0].id, { ok: true, codigo: 0 });
    expect(db.linhas('tags')[0].guarita_estado).toBe('gravado');
    await agente.registrarResultado(dev, operacoes[1].id, { ok: true, codigo: 0 });
    expect(db.linhas('tags')[0].guarita_estado).toBe('ativo');
  });
});
