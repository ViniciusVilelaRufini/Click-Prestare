import express from 'express';
import proxyaddr from 'proxy-addr';

describe('Proteção contra IP Forjado — Trust Proxy (F4)', () => {
  it('com trust proxy = 1, ignora IP falso forjado pelo cliente no header X-Forwarded-For', () => {
    const app = express();
    app.set('trust proxy', 1);

    const req: any = {
      headers: {
        // O atacante envia '203.0.113.195' no header original.
        // O ALB da AWS anexa o IP real do cliente que fez a conexão ('198.51.100.22').
        'x-forwarded-for': '203.0.113.195, 198.51.100.22',
      },
      connection: { remoteAddress: '10.0.0.1' }, // IP privado do ALB
      socket: { remoteAddress: '10.0.0.1' },
    };

    const trustFn = app.get('trust proxy fn');
    const resolvedIp = proxyaddr(req, trustFn);

    // O Express deve confiar apenas no 1º salto (ALB) e extrair o IP real '198.51.100.22'
    expect(resolvedIp).toBe('198.51.100.22');
    expect(resolvedIp).not.toBe('203.0.113.195');
  });

  it('com trust proxy = true (inseguro antigo), aceitaria o IP forjado pelo atacante', () => {
    const appInseguro = express();
    appInseguro.set('trust proxy', true);

    const req: any = {
      headers: {
        'x-forwarded-for': '203.0.113.195, 198.51.100.22',
      },
      connection: { remoteAddress: '10.0.0.1' },
      socket: { remoteAddress: '10.0.0.1' },
    };

    const trustFn = appInseguro.get('trust proxy fn');
    const resolvedIp = proxyaddr(req, trustFn);

    // No modo inseguro anterior (true), o Express confiava em todos os saltos
    expect(resolvedIp).toBe('203.0.113.195');
  });
});
