jest.mock('dns', () => {
  const real = jest.requireActual('dns');
  return { ...real, lookup: jest.fn() };
});

import * as http from 'http';
import axios from 'axios';
import { agentesSemRedeInterna, ipEhPrivado, lookupSeguro, urlExternaSegura } from './url-segura.util';

const dnsMock = jest.requireMock('dns') as { lookup: jest.Mock };

function responderDns(enderecos: { address: string; family: number }[]) {
  dnsMock.lookup.mockImplementation((_h: string, _o: any, cb: any) => cb(null, enderecos));
}

function chamarLookup(host: string, opts: any) {
  return new Promise<{ err: any; addr: any; family: any }>((resolve) =>
    lookupSeguro(host, opts, (err: any, addr?: any, family?: any) => resolve({ err, addr, family })),
  );
}

describe('ipEhPrivado — IPv6 com IPv4 interno embutido', () => {
  it.each([
    '::ffff:a9fe:a9fe', // ::ffff:169.254.169.254 como o WHATWG URL serializa
    '::ffff:7f00:1', // ::ffff:127.0.0.1
    '::ffff:a00:5', // ::ffff:10.0.0.5
    '0:0:0:0:0:ffff:a9fe:a9fe',
    '::ffff:0:a9fe:a9fe', // SIIT
    '::a9fe:a9fe', // IPv4-compatible (::/96)
    '64:ff9b::a9fe:a9fe', // NAT64
    '2002:a9fe:a9fe::1', // 6to4
    'fec0::1', // site-local
    'fe80::1%eth0',
    'fd00:ec2::254', // IMDS IPv6 da AWS
    '::',
  ])('trata %s como privado', (ip) => expect(ipEhPrivado(ip)).toBe(true));

  it.each(['2001:4860:4860::8888', '::ffff:808:808', '64:ff9b::808:808', '8.8.8.8'])(
    'aceita %s (público)',
    (ip) => expect(ipEhPrivado(ip)).toBe(false),
  );
});

describe('urlExternaSegura — host literal interno em qualquer forma', () => {
  it.each([
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://[::ffff:127.0.0.1]:3000/',
    'http://[::ffff:10.0.0.5]/',
    'http://[64:ff9b::169.254.169.254]/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://0251.0376.0251.0376/',
  ])('bloqueia %s', async (u) => expect(await urlExternaSegura(u)).toBe(false));
});

describe('lookupSeguro — o IP validado é o IP conectado (DNS rebinding)', () => {
  afterEach(() => dnsMock.lookup.mockReset());

  it('recusa nome que resolve para endereço interno', async () => {
    responderDns([{ address: '169.254.169.254', family: 4 }]);
    const { err } = await chamarLookup('rebind.exemplo.com', {});
    expect(err?.code).toBe('EHOSTBLOQUEADO');
  });

  it('recusa se QUALQUER endereço da resposta for interno', async () => {
    responderDns([
      { address: '8.8.8.8', family: 4 },
      { address: '::ffff:a9fe:a9fe', family: 6 },
    ]);
    const { err } = await chamarLookup('rebind.exemplo.com', {});
    expect(err?.code).toBe('EHOSTBLOQUEADO');
  });

  it('devolve endereço público (forma simples e forma all:true)', async () => {
    responderDns([{ address: '8.8.8.8', family: 4 }]);
    expect(await chamarLookup('ok.exemplo.com', {})).toEqual({ err: null, addr: '8.8.8.8', family: 4 });
    const todos = await chamarLookup('ok.exemplo.com', { all: true });
    expect(todos.err).toBeNull();
    expect(todos.addr).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });

  it('axios com agentesSemRedeInterna não conecta num servidor interno', async () => {
    const server = http.createServer((_req, res) => res.end('segredo-interno'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as any;
    responderDns([{ address: '127.0.0.1', family: 4 }]);
    try {
      await expect(
        axios.get(`http://rebind.exemplo.com:${port}/`, {
          ...agentesSemRedeInterna(),
          proxy: false,
          timeout: 3000,
        }),
      ).rejects.toThrow(/endereço interno/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
