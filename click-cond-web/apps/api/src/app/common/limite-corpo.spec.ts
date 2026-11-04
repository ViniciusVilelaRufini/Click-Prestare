import * as expressNs from 'express';
import * as http from 'http';
import { JwtService } from '@nestjs/jwt';
import {
  LIMITE_HARDWARE,
  LIMITE_PADRAO,
  LIMITE_PUBLICO_FOTO,
  LIMITE_UPLOAD,
  faixaDoCorpo,
  parserDeCorpo,
} from './limite-corpo';

/**
 * Pentest P-06: o JSON/urlencoded de até 100 MB era lido inteiro em memória
 * ANTES de qualquer guard. Agora o padrão é 2 MB; só as rotas que recebem
 * arquivo em base64 têm mais, e a faixa grande (35 MB, cobre os 25 MB
 * decodificados do StorageService) exige um JWT com assinatura válida, para
 * que ninguém sem conta faça a API materializar corpos grandes.
 */
const express: any = (expressNs as any).default ?? expressNs;
const SEGREDO = 'test-only-secret';
const jwt = new JwtService({ secret: SEGREDO });
const tokenValido = jwt.sign({ sub: 1 });

describe('faixaDoCorpo (P-06)', () => {
  const req = (method: string, url: string, authorization?: string) =>
    ({ method, originalUrl: url, headers: authorization ? { authorization } : {} }) as any;
  const faixa = (method: string, url: string, auth?: string) => faixaDoCorpo(req(method, url, auth), SEGREDO);

  it('rota comum fica no padrão de 2 MB, com ou sem token', () => {
    expect(faixa('POST', '/api/auth/login-portaria')).toBe(LIMITE_PADRAO);
    expect(faixa('POST', '/api/crm/marketing/x', `Bearer ${tokenValido}`)).toBe(LIMITE_PADRAO);
    expect(faixa('PUT', '/api/condominios/1/regras-acesso/3', `Bearer ${tokenValido}`)).toBe(LIMITE_PADRAO);
  });

  it.each([
    ['POST', '/api/condominios/1/moradores'],
    ['PUT', '/api/condominios/1/visitantes/pessoa/9'],
    ['POST', '/api/condominios/12/prestadores'],
    ['POST', '/api/condominios/12/pessoas'],
    ['POST', '/api/condominios/12/encomendas'],
    ['POST', '/api/condominios/12/ocorrencias'],
    ['POST', '/api/moradores/insert'],
    ['POST', '/api/funcionarios/update'],
    ['POST', '/api/sindico/update'],
    ['POST', '/api/condominio/update'],
    ['POST', '/api/encomendas/retirar'],
    ['POST', '/api/ocorrencias/insert'],
    ['POST', '/api/documentos/insert'],
    ['POST', '/api/assembleias/insert'],
    ['POST', '/api/financeiro/comprovante'],
    ['POST', '/api/areasSociais/insert'],
    ['POST', '/api/areas-sociais/insert'],
    ['POST', '/api/chat-ia/mensagem'],
    ['POST', '/api/delivery/x'],
    ['POST', '/api/visitantes/check-in'],
    ['POST', '/api/prestadores/insert'],
    ['PATCH', '/api/convites/3'],
  ])('upload %s %s: 35 MB só com JWT válido', (method, url) => {
    expect(faixa(method, `${url}?x=1`, `Bearer ${tokenValido}`)).toBe(LIMITE_UPLOAD);
    expect(faixa(method, url)).toBe(LIMITE_PADRAO);
    expect(faixa(method, url, 'Bearer lixo')).toBe(LIMITE_PADRAO);
    expect(faixa(method, url, `Bearer ${new JwtService({ secret: 'outro' }).sign({ sub: 1 })}`)).toBe(LIMITE_PADRAO);
  });

  it('token expirado não libera a faixa grande', () => {
    const expirado = jwt.sign({ sub: 1, exp: Math.floor(Date.now() / 1000) - 60 });
    expect(faixa('POST', '/api/condominios/1/moradores', `Bearer ${expirado}`)).toBe(LIMITE_PADRAO);
  });

  it('GET/DELETE ficam no padrão mesmo em rota de upload', () => {
    expect(faixa('GET', '/api/condominios/1/moradores', `Bearer ${tokenValido}`)).toBe(LIMITE_PADRAO);
    expect(faixa('DELETE', '/api/condominios/1/moradores/2', `Bearer ${tokenValido}`)).toBe(LIMITE_PADRAO);
  });

  it('rotas públicas com foto (signup e convite por link) têm teto próprio, sem JWT', () => {
    expect(faixa('POST', '/api/sindico/signup')).toBe(LIMITE_PUBLICO_FOTO);
    expect(faixa('POST', '/api/convites/publico/abc123')).toBe(LIMITE_PUBLICO_FOTO);
  });

  it('agente local e webhook do aparelho têm teto de hardware, sem JWT', () => {
    expect(faixa('POST', '/api/facial/webhook/tok')).toBe(LIMITE_HARDWARE);
    expect(faixa('POST', '/api/facial/agent/tok/result')).toBe(LIMITE_HARDWARE);
    expect(faixa('POST', '/api/facial/agent/condo/tok/result')).toBe(LIMITE_HARDWARE);
    expect(faixa('POST', '/api/facial/agent/condo/tok/event')).toBe(LIMITE_HARDWARE);
    expect(faixa('POST', '/api/facial/agent/condo/tok/telemetria')).toBe(LIMITE_PADRAO);
  });

  it('o teto de upload cobre o maior arquivo que o StorageService aceita (25 MB decodificados)', () => {
    expect(LIMITE_UPLOAD).toBeGreaterThanOrEqual(Math.ceil((25 * 1024 * 1024 * 4) / 3) + 512 * 1024);
    expect(LIMITE_PADRAO).toBe(2 * 1024 * 1024);
  });
});

describe('parserDeCorpo — corpo real no Express (P-06)', () => {
  let server: http.Server;
  let porta: number;
  const recebido: any[] = [];

  beforeAll(async () => {
    const app = express();
    app.use(parserDeCorpo(SEGREDO));
    app.use((req: any, res: any) => {
      recebido.push({ body: req.body, raw: req.rawBody });
      res.json({ ok: true });
    });
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ status: err.status }));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    porta = (server.address() as any).port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  function enviar(path: string, corpo: string, headers: Record<string, string> = {}): Promise<number> {
    return new Promise((resolve, reject) => {
      const r = http.request(
        { port: porta, path, method: 'POST', headers: { 'content-type': 'application/json', ...headers } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode as number));
        },
      );
      r.on('error', reject);
      r.end(corpo);
    });
  }
  const corpoDe = (bytes: number) => JSON.stringify({ foto: 'a'.repeat(bytes) });

  it('3 MB sem token numa rota de upload: 413', async () => {
    expect(await enviar('/api/condominios/1/moradores', corpoDe(3 * 1024 * 1024))).toBe(413);
  });

  it('3 MB com JWT válido numa rota de upload: aceito', async () => {
    expect(
      await enviar('/api/condominios/1/moradores', corpoDe(3 * 1024 * 1024), { authorization: `Bearer ${tokenValido}` }),
    ).toBe(200);
  });

  it('34 MB (arquivo de 25 MB em base64) com JWT válido numa rota de upload: aceito', async () => {
    expect(
      await enviar('/api/documentos/insert', corpoDe(34 * 1024 * 1024), { authorization: `Bearer ${tokenValido}` }),
    ).toBe(200);
  });

  it('urlencoded também respeita o padrão', async () => {
    expect(
      await enviar('/api/auth/x', `a=${'b'.repeat(3 * 1024 * 1024)}`, { 'content-type': 'application/x-www-form-urlencoded' }),
    ).toBe(413);
  });

  it('XML do aparelho só é lido no webhook do facial', async () => {
    recebido.length = 0;
    expect(await enviar('/api/facial/webhook/tok', '<a>1</a>', { 'content-type': 'application/xml' })).toBe(200);
    expect(recebido[0].body).toBe('<a>1</a>');
    expect(await enviar('/api/condominios/1/moradores', '<a>1</a>', { 'content-type': 'application/xml' })).toBe(200);
    expect(typeof recebido[1].body).not.toBe('string');
  });

  it('webhook do WhatsApp guarda o corpo bruto para conferir o HMAC', async () => {
    recebido.length = 0;
    expect(await enviar('/api/public/whatsapp/webhook', '{"a":1}')).toBe(200);
    expect(Buffer.isBuffer(recebido[0].raw)).toBe(true);
    expect(recebido[0].raw.toString()).toBe('{"a":1}');
    expect(await enviar('/api/condominios/1/moradores', '{"a":1}')).toBe(200);
    expect(recebido[1].raw).toBeUndefined();
  });
});
