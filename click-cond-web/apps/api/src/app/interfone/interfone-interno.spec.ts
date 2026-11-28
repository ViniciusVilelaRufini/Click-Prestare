import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { InterfoneInternoController } from './interfone-interno.controller';
import { VozControleClient } from './voz-controle.client';
import { assertVozToken } from './voz-token.util';

describe('assertVozToken', () => {
  const antes = process.env['VOZ_INTERNAL_TOKEN'];
  afterEach(() => {
    if (antes === undefined) delete process.env['VOZ_INTERNAL_TOKEN'];
    else process.env['VOZ_INTERNAL_TOKEN'] = antes;
  });

  it('falha fechado sem a env configurada', () => {
    delete process.env['VOZ_INTERNAL_TOKEN'];
    expect(() => assertVozToken('qualquer')).toThrow();
    expect(() => assertVozToken(undefined)).toThrow();
  });

  it('aceita só o token igual', () => {
    process.env['VOZ_INTERNAL_TOKEN'] = 'segredo-123';
    expect(() => assertVozToken('segredo-123')).not.toThrow();
    expect(() => assertVozToken('segredo-124')).toThrow();
    expect(() => assertVozToken('segredo')).toThrow();
    expect(() => assertVozToken('')).toThrow();
  });
});

describe('InterfoneInternoController', () => {
  const antes = process.env['VOZ_INTERNAL_TOKEN'];
  beforeEach(() => (process.env['VOZ_INTERNAL_TOKEN'] = 'tok'));
  afterAll(() => {
    if (antes === undefined) delete process.env['VOZ_INTERNAL_TOKEN'];
    else process.env['VOZ_INTERNAL_TOKEN'] = antes;
  });

  function montar() {
    const svc = {
      contas: jest.fn(async () => ({ faciais: [], monitores: [] })),
      novaChamadaFacial: jest.fn(async () => ({ ok: false, motivo: 'nao_encontrado' })),
      dadosParaServico: jest.fn(async () => ({})),
      evento: jest.fn(async () => ({ ok: true })),
      registros: jest.fn(async () => ({ ok: true, atualizados: 0 })),
    };
    return { c: new InterfoneInternoController(svc as any), svc };
  }

  it('é pública (sem JWT) — a autorização é o x-voz-token', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, InterfoneInternoController)).toBe(true);
  });

  it('todas as rotas internas respondem com Cache-Control: no-store', () => {
    for (const m of ['contas', 'novaChamada', 'chamada', 'evento', 'registros'] as const) {
      const h = Reflect.getMetadata('__headers__', (InterfoneInternoController.prototype as any)[m]) ?? [];
      expect(h).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    }
  });

  it('sem token ou com token errado, nenhuma rota chega ao serviço', async () => {
    const { c, svc } = montar();
    expect(() => c.contas(undefined)).toThrow();
    expect(() => c.novaChamada('errado', { conta: 'fac-1', numero: '1' })).toThrow();
    expect(() => c.chamada(undefined, 1)).toThrow();
    expect(() => c.evento('x', 1, { evento: 'toque_esgotado' })).toThrow();
    expect(() => c.registros(undefined, { contas: [] })).toThrow();
    expect(svc.contas).not.toHaveBeenCalled();
    expect(svc.novaChamadaFacial).not.toHaveBeenCalled();
    expect(svc.evento).not.toHaveBeenCalled();
  });

  it('com token, repassa ao serviço', async () => {
    const { c, svc } = montar();
    await c.novaChamada('tok', { conta: 'fac-1', numero: '106' });
    expect(svc.novaChamadaFacial).toHaveBeenCalledWith('fac-1', '106');
    await c.evento('tok', 5, { evento: 'toque_esgotado' });
    expect(svc.evento).toHaveBeenCalledWith(5, { evento: 'toque_esgotado' });
  });

  it('nova chamada sem conta/numero → 400', () => {
    const { c } = montar();
    expect(() => c.novaChamada('tok', {} as any)).toThrow(/obrigat/);
  });
});

describe('VozControleClient', () => {
  const antes = { t: process.env['VOZ_INTERNAL_TOKEN'], u: process.env['VOZ_CONTROLE_URL'] };
  afterEach(() => {
    for (const [k, v] of [['VOZ_INTERNAL_TOKEN', antes.t], ['VOZ_CONTROLE_URL', antes.u]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function cliente(resposta: () => Promise<any>) {
    const c = new VozControleClient();
    const fetch = jest.fn(resposta);
    (c as any).fetch = fetch;
    return { c, fetch };
  }

  it('POST no controle com x-voz-token e base padrão', async () => {
    process.env['VOZ_INTERNAL_TOKEN'] = 'tok';
    delete process.env['VOZ_CONTROLE_URL'];
    const { c, fetch } = cliente(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    await expect(c.portaria(7)).resolves.toBe(true);
    const [url, init] = (fetch.mock.calls as any[])[0];
    expect(url).toBe('https://voz.prestarecondominios.com.br/controle/chamadas/7/portaria');
    expect(init.method).toBe('POST');
    expect(init.headers['x-voz-token']).toBe('tok');
    expect(init.signal).toBeDefined();
  });

  it('VOZ_CONTROLE_URL sobrescreve a base; dtmf manda os dígitos', async () => {
    process.env['VOZ_INTERNAL_TOKEN'] = 'tok';
    process.env['VOZ_CONTROLE_URL'] = 'http://127.0.0.1:9999/';
    const { c, fetch } = cliente(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    await expect(c.dtmf(7, '#1')).resolves.toBe(true);
    const [url, init] = (fetch.mock.calls as any[])[0];
    expect(url).toBe('http://127.0.0.1:9999/controle/chamadas/7/dtmf');
    expect(JSON.parse(init.body)).toEqual({ digitos: '#1' });
  });

  it('dtmf inválido não chama o serviço', async () => {
    process.env['VOZ_INTERNAL_TOKEN'] = 'tok';
    const { c, fetch } = cliente(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    await expect(c.dtmf(7, '1;rm')).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('nunca lança: sem token, erro de rede, HTTP de erro ou ok:false → false', async () => {
    delete process.env['VOZ_INTERNAL_TOKEN'];
    let x = cliente(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    await expect(x.c.encerrar(7)).resolves.toBe(false);
    expect(x.fetch).not.toHaveBeenCalled();

    process.env['VOZ_INTERNAL_TOKEN'] = 'tok';
    x = cliente(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(x.c.encerrar(7)).resolves.toBe(false);
    x = cliente(async () => ({ ok: false, status: 404, json: async () => ({ ok: false }) }));
    await expect(x.c.encerrar(7)).resolves.toBe(false);
    x = cliente(async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) }));
    await expect(x.c.encerrar(7)).resolves.toBe(false);
  });
});
