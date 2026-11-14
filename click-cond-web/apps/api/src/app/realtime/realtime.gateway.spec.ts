import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
