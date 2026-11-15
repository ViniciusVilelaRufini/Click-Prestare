import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { montarConsole } from './guarita-console.testutil';

/**
 * Portões do Guarita, abertura pelo relé (UM comando na ponte, uma linha de
 * auditoria) e o estado do aparelho para o console.
 */

const OPERADOR: any = { sub: 1, nome: 'Porteiro Zé', id_condominio: 7, typeAccess: 'Sindico' };
const PORTEIRO: any = { sub: 2, nome: 'Porteiro', id_condominio: 7, tipo_sub: 'funcionario_portaria' };
const MORADOR: any = { sub: 9, nome: 'Morador', typeAccess: 'Morador' };
const FUNCIONARIO_APP: any = { sub: 8, nome: 'Func', typeAccess: 'Funcionario' };

const PORTAO = { nome: 'Garagem entrada', tipo_receptor: 1, num_receptor: 3, botao: 1, rele: 2, sentido: 'entrada' };

describe('Guarita — portões (CRUD)', () => {
  it('cria, lista, atualiza (PUT inteiro) e remove; CAN 1..8 e relé/botão 1..4 guardados como vieram', async () => {
    const { ctrl } = montarConsole(jest.fn);
    const p: any = await ctrl.criarPortao(7, 10, PORTAO, OPERADOR);
    expect(p).toMatchObject({ id: expect.any(Number), ...PORTAO });
    const atualizado: any = await ctrl.atualizarPortao(7, 10, p.id, { ...PORTAO, nome: 'Saída', num_receptor: 8, botao: null, rele: null, sentido: null }, OPERADOR);
    expect(atualizado).toMatchObject({ nome: 'Saída', num_receptor: 8, botao: null, rele: null, sentido: null });
    expect(await ctrl.listarPortoes(7, 10, OPERADOR)).toHaveLength(1);
    await expect(ctrl.removerPortao(7, 10, p.id, OPERADOR)).resolves.toEqual({ ok: true });
    expect(await ctrl.listarPortoes(7, 10, OPERADOR)).toHaveLength(0);
  });

  it.each([
    [{ ...PORTAO, num_receptor: 0 }],
    [{ ...PORTAO, num_receptor: 9 }],
    [{ ...PORTAO, tipo_receptor: 5 }],
    [{ ...PORTAO, rele: 5 }],
    [{ ...PORTAO, botao: 0 }],
    [{ ...PORTAO, sentido: 'cima' }],
    [{ ...PORTAO, nome: '' }],
  ])('portão inválido %j → 400', async (corpo) => {
    const { ctrl } = montarConsole(jest.fn);
    await expect(ctrl.criarPortao(7, 10, corpo as any, OPERADOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('configuração do Guarita (portões, importar, conferir, 29) só para síndico; o porteiro lista e abre', async () => {
    const { ctrl, bridge } = montarConsole(jest.fn);
    await expect(ctrl.criarPortao(7, 10, PORTAO, PORTEIRO)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.importar(7, 10, PORTEIRO)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.conferir(7, 10, PORTEIRO)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.atualizarReceptores(7, 10, PORTEIRO)).rejects.toBeInstanceOf(ForbiddenException);
    const p: any = await ctrl.criarPortao(7, 10, PORTAO, OPERADOR);
    expect(await ctrl.listarPortoes(7, 10, PORTEIRO)).toHaveLength(1);
    await expect(ctrl.abrirPortao(7, 10, p.id, PORTEIRO)).resolves.toEqual({ enviado: true });
    expect(bridge.enqueue).toHaveBeenCalledTimes(1);
  });

  it('Guarita de outro condomínio → 404; morador → 403', async () => {
    const { ctrl } = montarConsole(jest.fn);
    await expect(ctrl.listarPortoes(7, 20, OPERADOR)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctrl.criarPortao(7, 10, PORTAO, MORADOR)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Guarita — abrir portão', () => {
  it('gera exatamente UM guarita_rele na ponte, com num_receptor 1..8 como guardado, e uma linha de auditoria', async () => {
    const { ctrl, bridge, auditoria } = montarConsole(jest.fn);
    const p: any = await ctrl.criarPortao(7, 10, PORTAO, OPERADOR);
    await expect(ctrl.abrirPortao(7, 10, p.id, OPERADOR)).resolves.toEqual({ enviado: true });
    expect(bridge.enqueue).toHaveBeenCalledTimes(1);
    expect(bridge.enqueue).toHaveBeenCalledWith(10, {
      type: 'guarita_rele',
      payload: { tipo_receptor: 1, num_receptor: 3, rele: 2 },
    });
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar.mock.calls[0][0]).toMatchObject({
      id_condominio: 7,
      usuario_nome: 'Porteiro Zé',
      acao: 'MANUAL_OVERRIDE',
      modulo: 'guarita',
      entidade_id: p.id,
    });
  });

  it('portão sem relé → 400, nada na ponte', async () => {
    const { ctrl, bridge } = montarConsole(jest.fn);
    const p: any = await ctrl.criarPortao(7, 10, { ...PORTAO, rele: null }, OPERADOR);
    await expect(ctrl.abrirPortao(7, 10, p.id, OPERADOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(bridge.enqueue).not.toHaveBeenCalled();
  });

  it('agente ligado mas antigo (não fala com o Guarita) → diz para atualizar o agente, nada na ponte', async () => {
    const velho = montarConsole(jest.fn, { agenteOnline: false });
    (velho.bridge as any).agenteSemGuarita = jest.fn(async () => true);
    const p: any = await velho.ctrl.criarPortao(7, 10, PORTAO, OPERADOR);
    await expect(velho.ctrl.abrirPortao(7, 10, p.id, OPERADOR)).rejects.toThrow(/Atualize o agente/);
    expect(velho.bridge.enqueue).not.toHaveBeenCalled();
  });

  it('agente offline ou Guarita desconectado → erro claro, nada na ponte (e auditado)', async () => {
    const off = montarConsole(jest.fn, { agenteOnline: false });
    const p: any = await off.ctrl.criarPortao(7, 10, PORTAO, OPERADOR);
    await expect(off.ctrl.abrirPortao(7, 10, p.id, OPERADOR)).rejects.toThrow(/Agente Local/);
    expect(off.bridge.enqueue).not.toHaveBeenCalled();

    const desc = montarConsole(jest.fn);
    const p2: any = await desc.ctrl.criarPortao(7, 10, PORTAO, OPERADOR);
    await desc.agente.registrarEstado({ id: 10, id_condominio: 7, nome: 'G' }, { conectado: false, autorizado: true, erro: 'sem resposta' });
    await expect(desc.ctrl.abrirPortao(7, 10, p2.id, OPERADOR)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(desc.bridge.enqueue).not.toHaveBeenCalled();
    expect(desc.auditoria.registrar).toHaveBeenCalledTimes(1);
  });

  it('a ponte devolve falha → erro com a mensagem, uma chamada só', async () => {
    const { ctrl, bridge } = montarConsole(jest.fn);
    bridge.enqueue.mockResolvedValueOnce({ ok: false, error: 'Tempo esgotado: o agente local não respondeu.' });
    const p: any = await ctrl.criarPortao(7, 10, PORTAO, OPERADOR);
    await expect(ctrl.abrirPortao(7, 10, p.id, OPERADOR)).rejects.toThrow('Tempo esgotado');
    expect(bridge.enqueue).toHaveBeenCalledTimes(1);
  });

  it('morador e funcionário do app sem sessão do console → 403 (mesma permissão do Acionar Abertura)', async () => {
    const { ctrl, bridge } = montarConsole(jest.fn);
    const p: any = await ctrl.criarPortao(7, 10, PORTAO, OPERADOR);
    await expect(ctrl.abrirPortao(7, 10, p.id, MORADOR)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.abrirPortao(7, 10, p.id, FUNCIONARIO_APP)).rejects.toBeInstanceOf(ForbiddenException);
    expect(bridge.enqueue).not.toHaveBeenCalled();
  });
});

describe('Guarita — estado para o console', () => {
  it('junta o estado do agente com as contagens da fila e das tags', async () => {
    const { ctrl, agente, db } = montarConsole(jest.fn);
    await agente.registrarEstado({ id: 10, id_condominio: 7, nome: 'G' }, {
      conectado: true, autorizado: true, firmware: 'VrG.003s', total_dispositivos: 312, relogio_delta_s: 130,
    });
    db.semear('guarita_Operacoes', [
      { id_condominio: 7, id_device: 10, tipo: 'cadastrar', estado: 'pendente' },
      { id_condominio: 7, id_device: 10, tipo: 'captura', estado: 'pendente' },
    ]);
    db.semear('tags', [
      { id_condominio: 7, codigo: 'G2-1', id_device: 10, guarita_estado: 'falhou' },
      { id_condominio: 7, codigo: 'G2-2', id_device: 10, guarita_estado: 'a_vincular' },
      { id_condominio: 7, codigo: 'G2-3', id_device: 10, guarita_estado: 'a_vincular' },
      { id_condominio: 7, codigo: 'X', id_device: 10, guarita_estado: 'aguardando_aprovacao' },
    ]);
    const e: any = await ctrl.estado(7, 10, OPERADOR);
    expect(e).toMatchObject({
      conectado: true,
      autorizado: true,
      firmware: 'VrG.003s',
      total_dispositivos: 312,
      relogio_delta_s: 130,
      aviso_relogio: true,
      agente_online: true,
      pendentes: 1,
      falhas: 1,
      a_vincular: 2,
      aguardando_aprovacao: 1,
      erro: null,
    });
    expect(e.ultima_comunicacao).toBeTruthy();
    expect(JSON.stringify(e)).not.toMatch(/api_password|palavra/);
  });

  it('sem estado do agente: conectado nulo; 29 que falhou aparece em erro', async () => {
    const { ctrl, db } = montarConsole(jest.fn);
    db.semear('guarita_Operacoes', [
      { id_condominio: 7, id_device: 10, tipo: 'atualizar_receptores', estado: 'falhou', erro: 'O Guarita não respondeu.', concluida_em: new Date() },
    ]);
    const e: any = await ctrl.estado(7, 10, OPERADOR);
    expect(e).toMatchObject({ conectado: null, autorizado: null, relogio_delta_s: null, aviso_relogio: false, erro: 'Receptores não atualizados: O Guarita não respondeu.' });
  });
});
