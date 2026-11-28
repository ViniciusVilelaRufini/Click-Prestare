import * as crypto from 'crypto';
import * as http2 from 'http2';
import type { AddressInfo } from 'net';
import { ApnsClient, assinarJwtApns, tokenMorto } from './apns.client';

describe('ApnsClient', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it('JWT ES256 com kid e iss, assinatura crua de 64 bytes que verifica', () => {
    const jwt = assinarJwtApns(pem, 'KEY123', 'TEAM456', 1700000000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ iss: 'TEAM456', iat: 1700000000 });
    const assinatura = Buffer.from(s, 'base64url');
    expect(assinatura.length).toBe(64);
    const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, assinatura);
    expect(ok).toBe(true);
  });

  it('sem chave não envia e responde status 0', async () => {
    const cliente = new ApnsClient(async () => null, 'https://127.0.0.1:1');
    await expect(cliente.enviar('abc', { aps: {} }, 10)).resolves.toEqual({ status: 0, motivo: 'sem-chave' });
  });

  it('carregamento da chave que falha também vira status 0', async () => {
    const cliente = new ApnsClient(async () => {
      throw new Error('S3 fora');
    }, 'https://127.0.0.1:1');
    await expect(cliente.enviar('abc', { aps: {} }, 10)).resolves.toEqual({ status: 0, motivo: 'sem-chave' });
  });

  it('token morto: 410 e 400 BadDeviceToken/Unregistered', () => {
    expect(tokenMorto({ status: 410 })).toBe(true);
    expect(tokenMorto({ status: 400, motivo: 'BadDeviceToken' })).toBe(true);
    expect(tokenMorto({ status: 400, motivo: 'Unregistered' })).toBe(true);
    expect(tokenMorto({ status: 400, motivo: 'BadTopic' })).toBe(false);
    expect(tokenMorto({ status: 200 })).toBe(false);
    expect(tokenMorto({ status: 0, motivo: 'rede' })).toBe(false);
  });
});

describe('ApnsClient — cabeçalhos (servidor HTTP/2 local)', () => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  let servidor: http2.Http2Server;
  let host: string;
  let recebidos: http2.IncomingHttpHeaders[];

  beforeAll(async () => {
    servidor = http2.createServer();
    servidor.on('stream', (stream, headers) => {
      recebidos.push(headers);
      stream.respond({ ':status': 200 });
      stream.end();
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()));
    host = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  beforeEach(() => (recebidos = []));
  afterAll(async () => {
    await new Promise<void>((r) => servidor.close(() => r()));
  });

  it('sem opções mantém os cabeçalhos de Live Activity de hoje', async () => {
    const cliente = new ApnsClient(async () => pem, host);
    await expect(cliente.enviar('tok1', { aps: {} }, 10)).resolves.toEqual({ status: 200 });
    const h = recebidos[0];
    expect(h[':path']).toBe('/3/device/tok1');
    expect(h['apns-topic']).toBe('br.com.clickprestare.app.push-type.liveactivity');
    expect(h['apns-push-type']).toBe('liveactivity');
    expect(h['apns-priority']).toBe('10');
    expect(h['apns-expiration']).toBeUndefined();
    expect(String(h['authorization'])).toMatch(/^bearer /);
  });

  it('VoIP: tópico .voip e apns-push-type voip; expiração quando pedida', async () => {
    const cliente = new ApnsClient(async () => pem, host);
    await cliente.enviar('tok2', { id: '1' }, 10, { topico: 'br.com.clickprestare.app.voip', tipo: 'voip', expiracao: 1_800_000_060 });
    const h = recebidos[0];
    expect(h['apns-topic']).toBe('br.com.clickprestare.app.voip');
    expect(h['apns-push-type']).toBe('voip');
    expect(h['apns-priority']).toBe('10');
    expect(h['apns-expiration']).toBe('1800000060');
  });
});
