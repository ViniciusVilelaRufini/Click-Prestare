import * as crypto from 'crypto';
import { assinarTokenVoz, credencialTurn, montarDadosEntrada, verificarTokenVoz } from './token-voz';

describe('token de voz', () => {
  const segredo = 'segredo-de-teste-bem-comprido';
  const agora = 1_800_000_000;
  const claims = { cid: 12, papel: 'morador' as const, uid: 7, nome: 'Ana' };

  it('assina e verifica (HS256, validade 120 s)', () => {
    const t = assinarTokenVoz(claims, segredo, agora);
    const [h, c] = t.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ ...claims, iat: agora, exp: agora + 120 });
    expect(verificarTokenVoz(t, segredo, agora + 119)).toEqual(claims);
  });

  it('assinatura é HMAC-SHA256 padrão (o serviço de voz verifica com jsonwebtoken)', () => {
    const t = assinarTokenVoz(claims, segredo, agora);
    const [h, c, s] = t.split('.');
    const esperado = crypto.createHmac('sha256', segredo).update(`${h}.${c}`).digest('base64url');
    expect(s).toBe(esperado);
  });

  it('expirado → null', () => {
    const t = assinarTokenVoz(claims, segredo, agora);
    expect(verificarTokenVoz(t, segredo, agora + 121)).toBeNull();
    expect(verificarTokenVoz(t, segredo, agora + 120)).toBeNull();
  });

  it('segredo errado → null', () => {
    const t = assinarTokenVoz(claims, segredo, agora);
    expect(verificarTokenVoz(t, 'outro-segredo', agora)).toBeNull();
  });

  it('segredo vazio não assina nem verifica', () => {
    expect(() => assinarTokenVoz(claims, '', agora)).toThrow();
    const t = assinarTokenVoz(claims, segredo, agora);
    expect(verificarTokenVoz(t, '', agora)).toBeNull();
  });

  it('token adulterado, alg trocado ou lixo → null', () => {
    const t = assinarTokenVoz(claims, segredo, agora);
    const [h, , s] = t.split('.');
    const c2 = Buffer.from(JSON.stringify({ ...claims, uid: 8, iat: agora, exp: agora + 120 })).toString('base64url');
    expect(verificarTokenVoz(`${h}.${c2}.${s}`, segredo, agora)).toBeNull();
    const hNone = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const [, c] = t.split('.');
    expect(verificarTokenVoz(`${hNone}.${c}.`, segredo, agora)).toBeNull();
    expect(verificarTokenVoz('abc', segredo, agora)).toBeNull();
    expect(verificarTokenVoz('', segredo, agora)).toBeNull();
  });

  it('papel central é aceito e papel desconhecido continua recusado', () => {
    const central = { ...claims, papel: 'central' as const };
    expect(verificarTokenVoz(assinarTokenVoz(central, segredo, agora), segredo, agora)).toEqual(central);
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const c = Buffer.from(JSON.stringify({ ...claims, papel: 'centralx', iat: agora, exp: agora + 120 })).toString('base64url');
    const s = crypto.createHmac('sha256', segredo).update(`${h}.${c}`).digest('base64url');
    expect(verificarTokenVoz(`${h}.${c}.${s}`, segredo, agora)).toBeNull();
  });

  it('claims fora do formato → null', () => {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const c = Buffer.from(JSON.stringify({ cid: 1, papel: 'admin', uid: 1, nome: 'x', iat: agora, exp: agora + 120 })).toString('base64url');
    const s = crypto.createHmac('sha256', segredo).update(`${h}.${c}`).digest('base64url');
    expect(verificarTokenVoz(`${h}.${c}.${s}`, segredo, agora)).toBeNull();
  });
});

describe('credencialTurn', () => {
  it('username exp:uid (1 h) e credential base64(HMAC-SHA1)', () => {
    const agora = 1_800_000_000;
    const r = credencialTurn(7, 'turn-segredo', agora);
    expect(r.username).toBe(`${agora + 3600}:7`);
    const esperado = crypto.createHmac('sha1', 'turn-segredo').update(r.username).digest('base64');
    expect(r.credential).toBe(esperado);
    expect(credencialTurn(7, 'turn-segredo', agora)).toEqual(r);
  });
});

describe('montarDadosEntrada', () => {
  it('monta wss, sip_uri e ICE (STUN + TURN udp/tcp com credencial)', () => {
    const d = montarDadosEntrada(55, 'tok', { username: 'u', credential: 'c' });
    expect(d).toEqual({
      id: 55,
      token: 'tok',
      wss: 'wss://voz.prestarecondominios.com.br:8089/ws',
      sip_uri: 'sip:entrar@voz.prestarecondominios.com.br',
      ice: [
        { urls: ['stun:voz.prestarecondominios.com.br:3478'] },
        {
          urls: [
            'turn:voz.prestarecondominios.com.br:3478?transport=udp',
            'turn:voz.prestarecondominios.com.br:3478?transport=tcp',
          ],
          username: 'u',
          credential: 'c',
        },
      ],
    });
  });
});
