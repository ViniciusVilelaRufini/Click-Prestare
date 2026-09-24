import express from 'express';
import proxyaddr from 'proxy-addr';
import { extractClientIp, normalizeIp } from '../context/request-context';

describe('Proteção contra IP Forjado e Rate Limit por IP — Trust Proxy (F4)', () => {
  it('com trust proxy = 2 (AWS CloudFront + ALB), extrai o IP real do cliente e ignora IP forjado', () => {
    const app = express();
    app.set('trust proxy', 2);

    const req: any = {
      headers: {
        // Atacante forjou '203.0.113.77'.
        // O cliente real tem IP '2804:a48:1234::1'.
        // CloudFront repassa para o ALB com seu próprio IP '3.172.114.98'.
        'x-forwarded-for': '203.0.113.77, 2804:a48:1234::1, 3.172.114.98',
      },
      connection: { remoteAddress: '10.0.0.1' }, // IP privado do ALB
      socket: { remoteAddress: '10.0.0.1' },
    };

    const trustFn = app.get('trust proxy fn');
    const resolvedIp = proxyaddr(req, trustFn);

    // O Express confia em 2 saltos (ALB + CloudFront) e extrai o IP REAL do cliente final
    expect(resolvedIp).toBe('2804:a48:1234::1');
    expect(resolvedIp).not.toBe('203.0.113.77'); // Não usa o IP falso
    expect(resolvedIp).not.toBe('3.172.114.98'); // Não confunde com o IP do CloudFront
  });

  it('demonstra por que trust proxy = 1 causou o colapso do rate limit na producao', () => {
    const app = express();
    app.set('trust proxy', 1);

    const req: any = {
      headers: {
        'x-forwarded-for': '2804:a48:1234::1, 3.172.114.98',
      },
      connection: { remoteAddress: '10.0.0.1' },
      socket: { remoteAddress: '10.0.0.1' },
    };

    const trustFn = app.get('trust proxy fn');
    const resolvedIp = proxyaddr(req, trustFn);

    // Com 1 salto, o Express parava no CloudFront (3.172.114.98), agrupando todos os clientes!
    expect(resolvedIp).toBe('3.172.114.98');
  });

  describe('extractClientIp', () => {
    it('usa req.ip calculado pelo Express e ignora header X-Forwarded-For falso injetado pelo atacante', () => {
      const req: any = {
        ip: '2804:a48:1234::1', // Express calculou com base em trust proxy = 2
        headers: {
          'x-forwarded-for': '203.0.113.77', // Injetado maliciosamente
        },
      };

      const extracted = extractClientIp(req);
      expect(extracted).toBe('2804:a48:1234::1');
      expect(extracted).not.toBe('203.0.113.77');
    });

    it('normaliza ::ffff: e ::1 corretamente', () => {
      expect(normalizeIp('::ffff:192.168.1.100')).toBe('192.168.1.100');
      expect(normalizeIp('::1')).toBe('127.0.0.1');
      expect(normalizeIp('198.51.100.5, 10.0.0.1')).toBe('198.51.100.5');
    });

    it('faz fallback para socket remoto se req.ip nao estiver presente', () => {
      const req: any = {
        socket: { remoteAddress: '192.168.1.55' },
      };

      expect(extractClientIp(req)).toBe('192.168.1.55');
    });
  });
});
