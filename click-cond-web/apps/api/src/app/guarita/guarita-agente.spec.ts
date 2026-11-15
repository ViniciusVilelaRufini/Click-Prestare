import { BadRequestException, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { GuaritaAgenteService } from './guarita-agente.service';
import { GuaritaAgenteController } from './guarita-agente.controller';
import { criarBancoFalso } from './guarita-banco-falso.spec';
import { FacialService, TIPOS_DISPOSITIVO } from '../facial/facial.service';
import { FacialController, semPalavraDoGuarita } from '../facial/facial.controller';
import { normalizarFabricante, protocoloSemHttp, temCapacidade } from '../facial/fabricantes';
import { AgentBridgeService } from '../facial/agent-bridge.service';
import { RegrasAcessoService } from '../regras-acesso/regras-acesso.service';
import { CaminhosAcessoService } from '../caminhos-acesso/caminhos-acesso.service';

/**
 * Rotas do agente para o Módulo Guarita: autenticação pelo token do agente,
 * fila entregue em ordem e uma vez por pedido, resultado idempotente, estado de
 * conexão — e a palavra de autorização nunca sai em resposta nem em log.
 */

const PALAVRA = 'Senha-Guarita-7';

function montar() {
  const db = criarBancoFalso();
  db.semear('facial_Devices', [
    { id: 10, id_condominio: 7, nome: 'Guarita Garagem', tipo: 'guarita', fabricante: 'linear', ip: '192.168.0.10', porta: 9000, api_password: PALAVRA, webhook_token: 'tok-10', ativo: 1 },
    { id: 11, id_condominio: 7, nome: 'Facial Hall', tipo: 'facial', fabricante: 'intelbras', ip: '192.168.0.11', porta: 80, webhook_token: 'tok-11', ativo: 1 },
    { id: 12, id_condominio: 7, nome: 'Guarita desligado', tipo: 'guarita', fabricante: 'linear', ip: '192.168.0.12', porta: 9000, webhook_token: 'tok-12', ativo: 0 },
    { id: 20, id_condominio: 8, nome: 'Guarita do 8', tipo: 'guarita', fabricante: 'linear', ip: '192.168.0.20', porta: 9000, webhook_token: 'tok-20', ativo: 1 },
  ]);
  const facial: any = {
    resolveAgente: jest.fn(async (token: string) => {
      if (token === 'agente-7') return { idCondominio: 7 };
      if (token === 'agente-8') return { idCondominio: 8 };
      if (token === 'tok-10') return { idCondominio: 7, viaTokenDispositivo: true, idDispositivo: 10 };
      if (token === 'tok-11') return { idCondominio: 7, viaTokenDispositivo: true, idDispositivo: 11 };
      throw new UnauthorizedException('Token do agente inválido');
    }),
  };
  const service = new GuaritaAgenteService(db as any, facial);
  const ctrl = new GuaritaAgenteController(service);
  return { db, facial, service, ctrl };
}

function semearOp(db: any, linhas: Array<Record<string, any>>) {
  return db.semear(
    'guarita_Operacoes',
    linhas.map((l) => ({ id_condominio: 7, id_device: 10, estado: 'pendente', ...l })),
  );
}

describe('GuaritaAgente — autenticação e escopo', () => {
  it('token válido de OUTRO condomínio → 404, sem tocar na fila', async () => {
    const { ctrl, db } = montar();
    semearOp(db, [{ tipo: 'importar' }]);
    await expect(ctrl.operacoes('agente-8', '10')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.linhas('guarita_Operacoes')[0].estado).toBe('pendente');
  });

  it('token inválido → 401 (o mesmo das rotas condo/*)', async () => {
    const { ctrl } = montar();
    await expect(ctrl.operacoes('xyz', '10')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['device que não é guarita', 'agente-7', '11'],
    ['guarita inativo', 'agente-7', '12'],
    ['id inexistente', 'agente-7', '999'],
    ['id não numérico', 'agente-7', 'abc'],
    ['token de dispositivo de OUTRO aparelho', 'tok-11', '10'],
  ])('%s → 404', async (_c, token, id) => {
    const { ctrl } = montar();
    await expect(ctrl.operacoes(token, id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctrl.estado(token, id, { conectado: true, autorizado: true })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('token de dispositivo do PRÓPRIO Guarita (agente antigo) é aceito', async () => {
    const { ctrl } = montar();
    await expect(ctrl.operacoes('tok-10', '10')).resolves.toEqual({ operacoes: [] });
  });
});

describe('GuaritaAgente — GET operacoes', () => {
  const T0 = new Date('2026-11-15T12:00:00Z');
  const depois = (ms: number) => new Date(T0.getTime() + ms);

  function comCopia(db: any) {
    db.semear('guarita_Backups', [{ id_condominio: 7, id_device: 10, motivo: 'importacao', total: 0, dados: '[]' }]);
  }

  it('entrega em ordem de id, uma vez por pedido, e reentrega só depois de 5 min sem resultado', async () => {
    const { service, db } = montar();
    comCopia(db);
    semearOp(db, [
      { tipo: 'cadastrar', frame_hex: '1'.repeat(78) },
      { tipo: 'apagar', frame_hex: '2'.repeat(78) },
    ]);
    const dev = { id: 10, id_condominio: 7, nome: 'G' };

    const a = await service.buscarOperacoes(dev, T0);
    expect(a.operacoes).toEqual([
      { id: 1, tipo: 'cadastrar', frame_hex: '1'.repeat(78) },
      { id: 2, tipo: 'apagar', frame_hex: '2'.repeat(78) },
    ]);
    expect(db.linhas('guarita_Operacoes').map((o: any) => o.estado)).toEqual(['enviada', 'enviada']);

    // Lote em voo: nada sai de novo (nem o que chegar depois).
    semearOp(db, [{ tipo: 'editar', frame_hex: '3'.repeat(78) }]);
    expect((await service.buscarOperacoes(dev, depois(1000))).operacoes).toEqual([]);
    expect((await service.buscarOperacoes(dev, depois(4 * 60 * 1000))).operacoes).toEqual([]);

    // 5 min sem resultado: o lote volta, a partir da mais antiga, com a nova atrás.
    const c = await service.buscarOperacoes(dev, depois(5 * 60 * 1000 + 1));
    expect(c.operacoes.map((o) => o.id)).toEqual([1, 2, 3]);
  });

  it('duas instâncias pedindo ao mesmo tempo: cada operação sai uma vez só', async () => {
    const { db, facial } = montar();
    comCopia(db);
    semearOp(db, [
      { tipo: 'cadastrar', frame_hex: 'A'.repeat(78) },
      { tipo: 'cadastrar', frame_hex: 'B'.repeat(78) },
    ]);
    const i1 = new GuaritaAgenteService(db as any, facial);
    const i2 = new GuaritaAgenteService(db as any, facial);
    const dev = { id: 10, id_condominio: 7, nome: 'G' };
    const [r1, r2] = await Promise.all([i1.buscarOperacoes(dev, T0), i2.buscarOperacoes(dev, T0)]);
    const entregues = [...r1.operacoes, ...r2.operacoes].map((o) => o.id).sort();
    expect(entregues).toEqual([1, 2]);
  });

  it('sem cópia de segurança a gravação não sai; a importação sai sozinha (barreira)', async () => {
    const { service, db } = montar();
    semearOp(db, [{ tipo: 'importar' }, { tipo: 'cadastrar', frame_hex: 'C'.repeat(78) }]);
    const dev = { id: 10, id_condominio: 7, nome: 'G' };
    expect((await service.buscarOperacoes(dev, T0)).operacoes).toEqual([{ id: 1, tipo: 'importar' }]);

    // Importação falhou: sem cópia, a gravação continua presa.
    db.linhas('guarita_Operacoes')[0].estado = 'falhou';
    expect((await service.buscarOperacoes(dev, depois(1000))).operacoes).toEqual([]);

    // Com a cópia gravada, libera.
    comCopia(db);
    expect((await service.buscarOperacoes(dev, depois(2000))).operacoes.map((o) => o.id)).toEqual([2]);
  });

  it('atualizar_receptores só sai 30 s depois da última gravação e sozinho', async () => {
    const { service, db } = montar();
    comCopia(db);
    semearOp(db, [
      { tipo: 'cadastrar', estado: 'ok', concluida_em: T0, frame_hex: 'D'.repeat(78) },
      { tipo: 'atualizar_receptores' },
    ]);
    const dev = { id: 10, id_condominio: 7, nome: 'G' };
    expect((await service.buscarOperacoes(dev, depois(29_000))).operacoes).toEqual([]);
    expect((await service.buscarOperacoes(dev, depois(30_000))).operacoes).toEqual([{ id: 2, tipo: 'atualizar_receptores' }]);
  });

  it('a janela de captura nunca é entregue ao agente', async () => {
    const { service, db } = montar();
    semearOp(db, [{ tipo: 'captura', id_veiculo: 5 }]);
    expect((await service.buscarOperacoes({ id: 10, id_condominio: 7, nome: 'G' }, T0)).operacoes).toEqual([]);
  });
});

describe('GuaritaAgente — POST resultado', () => {
  it('resultado repetido não muda nada (idempotente)', async () => {
    const { ctrl, db } = montar();
    semearOp(db, [{ tipo: 'cadastrar', estado: 'enviada', enviada_em: new Date() }]);

    await expect(ctrl.resultado('agente-7', '10', '1', { ok: true, codigo: 0 })).resolves.toEqual({ ok: true });
    const depoisDoPrimeiro = { ...db.linhas('guarita_Operacoes')[0] };
    expect(depoisDoPrimeiro.estado).toBe('ok');

    await expect(ctrl.resultado('agente-7', '10', '1', { ok: false, codigo: 3, erro: 'x' })).resolves.toEqual({ ok: true });
    expect(db.linhas('guarita_Operacoes')[0]).toEqual(depoisDoPrimeiro);
  });

  it('operação de outro Guarita → 404', async () => {
    const { ctrl, db } = montar();
    db.semear('guarita_Operacoes', [{ id_condominio: 8, id_device: 20, tipo: 'cadastrar', estado: 'enviada' }]);
    await expect(ctrl.resultado('agente-7', '10', '1', { ok: true })).rejects.toBeInstanceOf(NotFoundException);
    expect(db.linhas('guarita_Operacoes')[0].estado).toBe('enviada');
  });

  it('corpo sem "ok" booleano → 400', async () => {
    const { ctrl, db } = montar();
    semearOp(db, [{ tipo: 'cadastrar', estado: 'enviada' }]);
    await expect(ctrl.resultado('agente-7', '10', '1', { codigo: 0 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GuaritaAgente — POST estado e nao-cadastrado', () => {
  it('estado grava ultima_sincr e o estado de conexão (visto pela outra instância)', async () => {
    const { ctrl, db, facial } = montar();
    await ctrl.estado('agente-7', '10', {
      conectado: true,
      autorizado: true,
      firmware: 'VrG.003s',
      total_dispositivos: 312,
      total_eventos: 8000,
      relogio_delta_s: -42,
    });
    expect(db.linhas('facial_Devices').find((d: any) => d.id === 10).ultima_sincr).toBeInstanceOf(Date);
    const outra = new GuaritaAgenteService(db as any, facial);
    await expect(outra.lerEstado(10)).resolves.toMatchObject({
      conectado: true,
      autorizado: true,
      firmware: 'VrG.003s',
      total_dispositivos: 312,
      relogio_delta_s: -42,
      erro: null,
    });
  });

  it('desconectado não mexe em ultima_sincr e guarda o erro', async () => {
    const { ctrl, db, service } = montar();
    await ctrl.estado('agente-7', '10', { conectado: false, autorizado: false, erro: 'Palavra de autorização recusada pelo Guarita' });
    expect(db.linhas('facial_Devices').find((d: any) => d.id === 10).ultima_sincr).toBeUndefined();
    await expect(service.lerEstado(10)).resolves.toMatchObject({ conectado: false, erro: 'Palavra de autorização recusada pelo Guarita' });
  });

  it('não cadastrado: 46 sem contador depois de um 42 com contador não perde o contador', async () => {
    const { ctrl, service } = montar();
    await ctrl.naoCadastrado('agente-7', '10', { comando: 42, tipo: 1, serial_hex: '1a2b3c4', contador: 513, receptor: null, bateria_fraca: false, recebido_em: '2026-11-15T12:00:00Z' });
    await ctrl.naoCadastrado('agente-7', '10', { comando: 46, tipo: 1, serial_hex: '01A2B3C4', contador: null, receptor: 2, bateria_fraca: false, recebido_em: '2026-11-15T12:00:01Z' });
    const lista = await service.listarNaoCadastrados(10);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ tipo: 1, serial_hex: '1A2B3C4', contador: 513, comando: 46 });
  });

  it.each([
    [{ comando: 5, tipo: 2, serial_hex: '0F086E' }],
    [{ comando: 42, tipo: 5, serial_hex: '0F086E' }],
    [{ comando: 42, tipo: 2, serial_hex: 'xyz' }],
    [{ comando: 42, tipo: 2, serial_hex: '1A2B3C4' }],
  ])('não cadastrado inválido %j → 400', async (corpo) => {
    const { ctrl } = montar();
    await expect(ctrl.naoCadastrado('agente-7', '10', corpo)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GuaritaAgente — a palavra de autorização nunca sai em resposta nem em log', () => {
  it('nenhuma rota do agente devolve ou loga a palavra', async () => {
    const { ctrl, db } = montar();
    const logs: string[] = [];
    const espioes = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
      jest.spyOn(Logger.prototype, m).mockImplementation((...a: any[]) => {
        logs.push(a.map(String).join(' '));
      }),
    );
    db.semear('guarita_Backups', [{ id_condominio: 7, id_device: 10, motivo: 'importacao', total: 0, dados: '[]' }]);
    semearOp(db, [{ tipo: 'cadastrar', frame_hex: 'E'.repeat(78) }]);
    const respostas = [
      await ctrl.operacoes('agente-7', '10'),
      await ctrl.resultado('agente-7', '10', '1', { ok: false, codigo: 1, erro: 'Memória do Guarita cheia.' }),
      await ctrl.estado('agente-7', '10', { conectado: false, autorizado: false, erro: 'Palavra de autorização recusada pelo Guarita' }),
      await ctrl.naoCadastrado('agente-7', '10', { comando: 42, tipo: 2, serial_hex: '0F086E', contador: null, receptor: null, bateria_fraca: false, recebido_em: 'x' }),
      await ctrl.eventos('agente-7', '10', { eventos: [], relogio_delta_s: 0 }),
    ];
    for (const e of espioes) e.mockRestore();
    expect(JSON.stringify(respostas)).not.toContain(PALAVRA);
    expect(logs.join('\n')).not.toContain(PALAVRA);
  });

  it('rotas do console: o Guarita sai sem api_password, inclusive para o síndico', async () => {
    const guarita = { id: 10, tipo: 'guarita', nome: 'G', api_password: PALAVRA, webhook_token: 't', id_condominio: 7 };
    const facial = { id: 11, tipo: 'facial', nome: 'F', api_password: 'senha-do-facial', webhook_token: 't2', id_condominio: 7 };
    const service: any = {
      listDevices: jest.fn(async () => [guarita, facial]),
      getDevice: jest.fn(async (id: number) => (id === 10 ? guarita : facial)),
      createDevice: jest.fn(async () => guarita),
      updateDevice: jest.fn(async () => guarita),
    };
    const ctrl = new FacialController(service, {} as any, {} as any, {} as any);
    const sindico: any = { sub: 1, nome: 'S', id_condominio: 7, typeAccess: 'Sindico' };
    const porteiro: any = { sub: 2, nome: 'P', id_condominio: 7 };
    const respostas = [
      await ctrl.list(7, sindico),
      await ctrl.list(7, porteiro),
      await ctrl.get(10, sindico),
      await ctrl.create({ id_condominio: 7 } as any, sindico),
      await ctrl.update(10, {} as any, sindico),
    ];
    expect(JSON.stringify(respostas)).not.toContain(PALAVRA);
    expect((respostas[2] as any).tem_palavra).toBe(true);
    expect(respostas[2]).not.toHaveProperty('api_password');
    // Outros tipos: igual a antes (o síndico continua vendo a senha do facial).
    expect((respostas[0] as any[])[1].api_password).toBe('senha-do-facial');
    expect(semPalavraDoGuarita(facial)).toBe(facial);
  });
});

describe('Guarita no núcleo do facial', () => {
  it('é um tipo de dispositivo aceito e o fabricante linear não lista, não tem câmera nem HTTP', () => {
    expect(TIPOS_DISPOSITIVO).toContain('guarita');
    expect(normalizarFabricante('Linear')).toBe('linear');
    expect(normalizarFabricante('Nice')).toBe('linear');
    for (const cap of ['listagem', 'camera', 'validadeNoAparelho', 'usoUnico', 'eventosViaAgente', 'descoberta'] as const) {
      expect(temCapacidade('linear', cap)).toBe(false);
    }
    expect(protocoloSemHttp('linear')).toMatch(/TCP/);
  });

  it('guarita_rele espera no máximo 10 s', () => {
    const bridge = new AgentBridgeService();
    expect(bridge.timeoutDoComando('guarita_rele')).toBe(10_000);
    expect(bridge.timeoutDoComando('open_door')).toBe(15_000);
  });

  function facialSemConstrutor(prisma: any) {
    const svc = Object.create(FacialService.prototype);
    svc.prisma = prisma;
    svc.logger = new Logger('teste');
    svc.consentimentos = { autorizouBiometria: jest.fn(async () => true) };
    svc.client = { enrollPerson: jest.fn(), updatePerson: jest.fn(), removePerson: jest.fn() };
    svc.runWebhook = jest.fn(async () => ({ ok: true }));
    return svc;
  }

  it('webhook com o token de um Guarita → 400, nunca chega ao runWebhook', async () => {
    const db = criarBancoFalso();
    db.semear('facial_Devices', [{ id: 10, id_condominio: 7, nome: 'G', tipo: 'guarita', webhook_token: 'tok-10', ativo: 1, condominio: { ativo: 1 } }]);
    const prisma = {
      facial_Devices: {
        findFirst: jest.fn(async ({ where }: any) => db.linhas('facial_Devices').find((d: any) => d.webhook_token === where.webhook_token) ?? null),
      },
    };
    const svc = facialSemConstrutor(prisma);
    await expect(svc.processWebhook('tok-10', { external_id: 'G1-1A2B3C4' })).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.runWebhook).not.toHaveBeenCalled();
  });

  it('evento de agente apontando para um Guarita → 400, nunca chega ao runWebhook', async () => {
    const prisma = {
      condominios: { findFirst: jest.fn(async () => ({ id: 7 })) },
      facial_Devices: { findFirst: jest.fn(async () => ({ id: 10, id_condominio: 7, tipo: 'guarita', ativo: 1 })) },
    };
    const svc = facialSemConstrutor(prisma);
    await expect(svc.processAgentEvent('agente-7', 10, { external_id: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.runWebhook).not.toHaveBeenCalled();
  });

  it('syncMorador ignora o Guarita (só terminal facial recebe rosto)', async () => {
    const db = criarBancoFalso();
    db.semear('facial_Devices', [{ id: 10, id_condominio: 7, nome: 'G', tipo: 'guarita', ativo: 1 }]);
    const prisma = {
      isConnected: true,
      moradores: {
        findUnique: jest.fn(async () => ({
          id: 3, id_user: 30, id_condominio: 7, nome: 'Ana', tipo: 'morador', foto_pessoa: 'https://x/foto.jpg',
          data_nascimento: new Date('1980-01-01'), face_id: null, face_sync_error: null, extra2: null,
        })),
        update: jest.fn(),
      },
      facial_Devices: { findMany: jest.fn((args: any) => db.facial_Devices.findMany(args)) },
    };
    const svc = facialSemConstrutor(prisma);
    await expect(svc.syncMorador(3)).resolves.toEqual({ skipped: true, reason: 'no_facial_devices' });
    for (const [args] of prisma.facial_Devices.findMany.mock.calls) expect(args.where.tipo).toBe('facial');
    expect(svc.client.enrollPerson).not.toHaveBeenCalled();
  });
});

describe('Guarita fora das telas genéricas de aparelho', () => {
  function bancoComGuarita() {
    const db = criarBancoFalso();
    db.semear('facial_Devices', [
      { id: 10, id_condominio: 7, nome: 'Guarita', tipo: 'guarita', ativo: 1 },
      { id: 11, id_condominio: 7, nome: 'Facial', tipo: 'facial', ativo: 1 },
      { id: 12, id_condominio: 7, nome: 'Catraca', tipo: 'catraca', ativo: 1 },
    ]);
    return db;
  }

  it('regra de acesso com um Guarita → 400; sem Guarita continua aceita', async () => {
    const db = bancoComGuarita();
    const svc = new RegrasAcessoService(db as any, {} as any, {} as any);
    await expect((svc as any).assertDispositivosDoCondominio([11, 10], 7)).rejects.toThrow(/Módulo Guarita não entra em regras/);
    await expect((svc as any).assertDispositivosDoCondominio([11, 12], 7)).resolves.toBeUndefined();
  });

  it('caminho dos leitores: Guarita não é leitor nem abertura', async () => {
    const db = bancoComGuarita();
    const svc = new CaminhosAcessoService(db as any, {} as any);
    await expect((svc as any).validarEtapas(7, [{ id_leitor: 10 }])).rejects.toThrow(/não identifica ninguém/);
    await expect((svc as any).validarEtapas(7, [{ id_leitor: 11, id_abertura: 10 }])).rejects.toThrow(/não abre passagem/);
    await expect((svc as any).validarEtapas(7, [{ id_leitor: 11, id_abertura: 12 }])).resolves.toBeUndefined();
  });
});

describe('"Testar conexão" do Guarita responde pelo último estado do agente (sem HTTP direto)', () => {
  function montarTeste() {
    const m = montar();
    const facial = Object.create(FacialService.prototype);
    facial.prisma = m.db;
    facial.logger = new Logger('teste');
    facial.agent = { isOnline: jest.fn(() => true) };
    facial.client = { diagnosticar: jest.fn() };
    facial.handleDeviceStatusTransition = jest.fn();
    facial.getDevice = jest.fn(async () => ({ id: 10, id_condominio: 7, tipo: 'guarita', nome: 'G', api_password: PALAVRA }));
    return { ...m, facialSvc: facial };
  }

  it('conectado e autorizado → online, sem chamar o cliente HTTP', async () => {
    const { ctrl, facialSvc } = montarTeste();
    await ctrl.estado('agente-7', '10', { conectado: true, autorizado: true });
    const r = await facialSvc.testDevice(10);
    expect(r).toMatchObject({ online: true, motivo: null });
    expect(facialSvc.client.diagnosticar).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain(PALAVRA);
  });

  it('palavra recusada → credencial_invalida; sem estado e agente offline → agente_offline', async () => {
    const { ctrl, facialSvc } = montarTeste();
    await ctrl.estado('agente-7', '10', { conectado: false, autorizado: false, erro: 'Palavra de autorização recusada pelo Guarita' });
    await expect(facialSvc.testDevice(10)).resolves.toMatchObject({ online: false, motivo: 'credencial_invalida' });

    const outro = montarTeste();
    outro.facialSvc.agent.isOnline = () => false;
    await expect(outro.facialSvc.testDevice(10)).resolves.toMatchObject({ online: false, motivo: 'agente_offline' });
    expect(outro.facialSvc.client.diagnosticar).not.toHaveBeenCalled();
  });
});
