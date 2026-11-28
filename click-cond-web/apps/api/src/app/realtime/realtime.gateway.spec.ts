import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConferenciaIndisponivelException } from '../auth/jwt.strategy';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Menor 7 (rodada 1 da raia f): o socket do console só fazia jwt.verify. O porteiro removido, desativado ou com a
 * credencial trocada (e o síndico que perdeu o vínculo) seguia conectado e recebendo os eventos do condomínio —
 * a mesma revogação que o JwtStrategy aplica nas rotas REST não valia aqui, nem na conexão nem depois dela.
 */
describe('RealtimeGateway — revogação da sessão', () => {
  const jwt = new JwtService({ secret: 'test' });
  const token = jwt.sign({ sub: 3, nome: 'P', id_condominio: 7, tipo_sub: 'funcionario_portaria' });

  function build(revogado: { atual: boolean }) {
    const strategy = {
      validate: jest.fn(async (p: any) => {
        if (revogado.atual) throw new UnauthorizedException('Sessão encerrada');
        return p;
      }),
    };
    const moduleRef: any = { get: jest.fn(() => strategy) };
    const gw = new RealtimeGateway(jwt, moduleRef);
    (gw as any).logger = { warn: jest.fn(), log: jest.fn() };
    return { gw, strategy };
  }

  function socket() {
    return { handshake: { auth: { token }, query: {} }, data: {} as any, join: jest.fn(), disconnect: jest.fn() } as any;
  }

  it('recusa a conexão de sessão revogada (mesma regra do JwtStrategy)', async () => {
    const { gw } = build({ atual: true });
    const s = socket();
    await gw.handleConnection(s);
    expect(s.join).not.toHaveBeenCalled();
    expect(s.disconnect).toHaveBeenCalledWith(true);
  });

  it('aceita a sessão válida e entra na sala do condomínio', async () => {
    const { gw } = build({ atual: false });
    const s = socket();
    await gw.handleConnection(s);
    expect(s.join).toHaveBeenCalledWith('condominio:7');
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it('porteiro entra também na sala da portaria (interfone); síndico no console não', async () => {
    const { gw } = build({ atual: false });
    const s = socket();
    await gw.handleConnection(s);
    expect(s.join).toHaveBeenCalledWith('portaria:7');

    const tokenSindico = jwt.sign({ sub: 9, nome: 'S', id_condominio: 7, typeAccess: 'Sindico' });
    const s2 = { ...socket(), handshake: { auth: { token: tokenSindico }, query: {} }, join: jest.fn() } as any;
    await gw.handleConnection(s2);
    expect(s2.join).toHaveBeenCalledWith('condominio:7');
    expect(s2.join).not.toHaveBeenCalledWith('portaria:7');
  });

  it('porteirosOnline consulta a sala da portaria e emitirPortaria emite nela', async () => {
    const { gw } = build({ atual: false });
    const emit = jest.fn();
    const fetchSockets = jest.fn(async () => [{ id: 'a' }]);
    (gw as any).server = { in: jest.fn(() => ({ fetchSockets })), to: jest.fn(() => ({ emit })) };
    await expect(gw.porteirosOnline(7)).resolves.toBe(true);
    expect((gw as any).server.in).toHaveBeenCalledWith('portaria:7');
    fetchSockets.mockResolvedValueOnce([]);
    await expect(gw.porteirosOnline(7)).resolves.toBe(false);
    fetchSockets.mockRejectedValueOnce(new Error('x'));
    await expect(gw.porteirosOnline(7)).resolves.toBe(false);

    gw.emitirPortaria(7, 'interfone:fim', { id: 1 });
    expect((gw as any).server.to).toHaveBeenCalledWith('portaria:7');
    expect(emit).toHaveBeenCalledWith('interfone:fim', { id: 1 });
  });

  it('sem servidor, porteirosOnline é false', async () => {
    const { gw } = build({ atual: false });
    await expect(gw.porteirosOnline(7)).resolves.toBe(false);
  });

  it('conexão já aberta cai na reconferência quando a sessão é revogada depois', async () => {
    const estado = { atual: false };
    const { gw } = build(estado);
    const s = socket();
    await gw.handleConnection(s);
    (gw as any).server = { sockets: { sockets: new Map([['a', s]]) } };

    await gw.reconferirConexoes();
    expect(s.disconnect).not.toHaveBeenCalled();

    estado.atual = true;
    await gw.reconferirConexoes();
    expect(s.disconnect).toHaveBeenCalledWith(true);
  });

  describe('"não deu para conferir" ≠ "revogado" (I3)', () => {
    const tokenOperador = jwt.sign({ sub: 7, papel: 'operador_central', cred: 'c'.repeat(32) });
    const socketOp = () =>
      ({ handshake: { auth: { token: tokenOperador }, query: {} }, data: {} as any, join: jest.fn(), disconnect: jest.fn() }) as any;

    function buildModo(modo: { atual: 'ok' | 'indisponivel' | 'revogado' }) {
      const strategy = {
        validate: jest.fn(async (p: any) => {
          if (modo.atual === 'indisponivel') throw new ConferenciaIndisponivelException();
          if (modo.atual === 'revogado') throw new UnauthorizedException('Sessão da central encerrada.');
          return p;
        }),
      };
      const gw = new RealtimeGateway(jwt, { get: jest.fn(() => strategy) } as any);
      (gw as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
      return gw;
    }

    it('banco com erro na reconferência: o socket do operador já aceito fica; revogado depois cai', async () => {
      const modo = { atual: 'ok' as 'ok' | 'indisponivel' | 'revogado' };
      const gw = buildModo(modo);
      const s = socketOp();
      await gw.handleConnection(s);
      expect(s.join).toHaveBeenCalledWith('central');
      (gw as any).server = { sockets: { sockets: new Map([['a', s]]) } };

      modo.atual = 'indisponivel';
      await gw.reconferirConexoes();
      expect(s.disconnect).not.toHaveBeenCalled();
      expect((gw as any).logger.warn).toHaveBeenCalled();

      modo.atual = 'revogado';
      await gw.reconferirConexoes();
      expect(s.disconnect).toHaveBeenCalledWith(true);
    });

    it('handshake NOVO sem como conferir continua recusado (fail-closed)', async () => {
      const gw = buildModo({ atual: 'indisponivel' });
      const s = socketOp();
      await gw.handleConnection(s);
      expect(s.join).not.toHaveBeenCalled();
      expect(s.disconnect).toHaveBeenCalledWith(true);
    });

    it('JwtStrategy indisponível: operador novo é recusado, o já aceito fica na reconferência', async () => {
      const strategy = { validate: jest.fn(async (p: any) => p) };
      const moduleRef: any = { get: jest.fn(() => strategy) };
      const gw = new RealtimeGateway(jwt, moduleRef);
      (gw as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
      const aceito = socketOp();
      await gw.handleConnection(aceito);
      expect(aceito.join).toHaveBeenCalledWith('central');

      (gw as any).strategy = null;
      moduleRef.get.mockReturnValue(null);
      (gw as any).server = { sockets: { sockets: new Map([['a', aceito]]) } };
      await gw.reconferirConexoes();
      expect(aceito.disconnect).not.toHaveBeenCalled();

      const novo = socketOp();
      await gw.handleConnection(novo);
      expect(novo.disconnect).toHaveBeenCalledWith(true);
    });

    it('token vencido cai na reconferência mesmo com o banco fora', async () => {
      const gw = buildModo({ atual: 'indisponivel' });
      const vencido = jwt.sign({ sub: 7, papel: 'operador_central', cred: 'c'.repeat(32), exp: Math.floor(Date.now() / 1000) - 10 });
      const s = { ...socketOp(), data: { token: vencido } } as any;
      (gw as any).server = { sockets: { sockets: new Map([['a', s]]) } };
      await gw.reconferirConexoes();
      expect(s.disconnect).toHaveBeenCalledWith(true);
    });
  });

  it('JwtStrategy não achado: registra erro e tenta de novo na próxima conexão (não guarda o nulo)', async () => {
    const strategy = { validate: jest.fn(async () => { throw new UnauthorizedException('Sessão encerrada'); }) };
    const moduleRef: any = {
      get: jest.fn().mockImplementationOnce(() => { throw new Error('ainda não registrado'); }).mockReturnValue(strategy),
    };
    const gw = new RealtimeGateway(jwt, moduleRef);
    const logger = { warn: jest.fn(), error: jest.fn() };
    (gw as any).logger = logger;

    await gw.handleConnection(socket());
    expect(logger.error).toHaveBeenCalled();

    const s = socket();
    await gw.handleConnection(s);
    expect(moduleRef.get).toHaveBeenCalledTimes(2);
    expect(s.disconnect).toHaveBeenCalledWith(true);
  });
});
