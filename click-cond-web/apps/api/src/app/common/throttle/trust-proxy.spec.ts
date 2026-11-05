import express from 'express';
import proxyaddr from 'proxy-addr';
import { extractClientIp, normalizeIp } from '../context/request-context';

describe('Proteção contra IP Forjado e Rate Limit por IP — Trust Proxy (F4)', () => {
  // Cadeia medida em 04/11/2026 (access.log do nginx, depois do ALB): o Node
  // recebe do nginx local o XFF "cliente, <borda CloudFront>, <ALB privado>".
  const reqProducao = (): any => ({
    headers: {
      // Atacante forjou '203.0.113.77'; cliente real '2804:a48:1234::1';
      // borda do CloudFront '3.172.114.98'; ALB (VPC) '172.31.39.40'.
      'x-forwarded-for': '203.0.113.77, 2804:a48:1234::1, 3.172.114.98, 172.31.39.40',
    },
    connection: { remoteAddress: '127.0.0.1' }, // nginx da instância
    socket: { remoteAddress: '127.0.0.1' },
  });

  it('com trust proxy = 3 (nginx + ALB + CloudFront), extrai o IP real do cliente e ignora IP forjado', () => {
    const app = express();
    app.set('trust proxy', 3);

    const resolvedIp = proxyaddr(reqProducao(), app.get('trust proxy fn'));

    expect(resolvedIp).toBe('2804:a48:1234::1');
    expect(resolvedIp).not.toBe('203.0.113.77'); // Não usa o IP falso
    expect(resolvedIp).not.toBe('3.172.114.98'); // Não confunde com o IP do CloudFront
  });

  it('com trust proxy = 2 depois do ALB, o req.ip vira a borda do CloudFront (bug de 04/11)', () => {
    const app = express();
    app.set('trust proxy', 2);

    expect(proxyaddr(reqProducao(), app.get('trust proxy fn'))).toBe('3.172.114.98');
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
        ip: '2804:a48:1234::1', // Express calculou com base em trust proxy = 3
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
