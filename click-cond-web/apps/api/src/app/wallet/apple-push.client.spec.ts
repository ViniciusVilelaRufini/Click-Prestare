/**
 * Aviso de atualização de passe por APNs com o certificado do Pass Type ID,
 * contra um servidor HTTP/2 local (certificado de servidor autoassinado,
 * certificado de cliente exigido).
 */
import { Logger } from '@nestjs/common';
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { ApplePassPushClient } from './apple-push.client';
import { CredenciaisValidacaoService } from '../credenciais/credenciais-validacao.service';
import { WalletService } from './wallet.service';
import { PASS_TYPE_ID } from './wallet.constantes';
import { gerarChavesFalsas } from './testes/certificados-falsos';
import { criarPrismaFalso } from './testes/prisma-falso';

const cliente = gerarChavesFalsas();
const servidor = gerarChavesFalsas('servidor.apns.teste');
const CHAVES = { chavePem: cliente.passe.chavePem, certPem: cliente.passe.certPem, wwdrPem: cliente.wwdr.certPem };
const TOKEN = 'ab'.repeat(32);

type Pedido = { cabecalhos: http2.IncomingHttpHeaders; corpo: string; certCliente: string | undefined };

function subirServidor(responder: (p: Pedido, stream: http2.ServerHttp2Stream, n: number) => void) {
  const pedidos: Pedido[] = [];
  const srv = http2.createSecureServer({
    key: servidor.passe.chavePem,
    cert: servidor.passe.certPem,
    requestCert: true,
    rejectUnauthorized: false,
  });
  srv.on('stream', (stream, cabecalhos) => {
    let corpo = '';
    stream.setEncoding('utf8');
    stream.on('data', (c) => (corpo += c));
    stream.on('end', () => {
      const tls = stream.session?.socket as any;
      const peer = tls?.getPeerCertificate?.();
      const p = { cabecalhos, corpo, certCliente: peer?.subject?.CN as string | undefined };
      pedidos.push(p);
      responder(p, stream, pedidos.length);
    });
  });
  return new Promise<{ host: string; pedidos: Pedido[]; fechar: () => Promise<void> }>((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const porta = (srv.address() as AddressInfo).port;
      resolve({
        host: `https://127.0.0.1:${porta}`,
        pedidos,
        fechar: () =>
          new Promise<void>((r) => {
            (srv as any).closeAllConnections?.();
            srv.close(() => r());
            setTimeout(r, 200).unref();
          }),
      });
    });
  });
}

const ok = (_p: Pedido, stream: http2.ServerHttp2Stream) => {
  stream.respond({ ':status': 200 });
  stream.end();
};

function novoCliente(host: string, chaves: any = CHAVES, timeoutMs = 8_000) {
  // O certificado do servidor de teste não tem 127.0.0.1 no nome: confia na
  // CA de teste e dispensa só a conferência do nome.
  return new ApplePassPushClient(async () => chaves, host, {
    tls: { ca: servidor.wwdr.certPem, checkServerIdentity: () => undefined },
    timeoutMs,
  });
}

describe('ApplePassPushClient', () => {
  let logs: jest.SpyInstance[];
  beforeEach(() => {
    logs = (['log', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('envia POST /3/device/<token> com corpo {} e os cabeçalhos, autenticando com o certificado de cliente', async () => {
    const s = await subirServidor(ok);
    try {
      const antes = Math.floor(Date.now() / 1000);
      const r = await novoCliente(s.host).avisar(TOKEN);
      expect(r).toEqual({ status: 200 });
      const [p] = s.pedidos;
      expect(p.cabecalhos[':method']).toBe('POST');
      expect(p.cabecalhos[':path']).toBe(`/3/device/${TOKEN}`);
      expect(p.corpo).toBe('{}');
      expect(p.cabecalhos['apns-push-type']).toBe('background');
      expect(p.cabecalhos['apns-priority']).toBe('5');
      const exp = Number(p.cabecalhos['apns-expiration']);
      expect(exp).toBeGreaterThanOrEqual(antes + 86_400);
      expect(exp).toBeLessThanOrEqual(antes + 86_400 + 5);
      // Certificado só do PassKit: o tópico vai implícito no certificado.
      expect(p.cabecalhos['apns-topic']).toBeUndefined();
      expect(p.cabecalhos['authorization']).toBeUndefined();
      expect(p.certCliente).toBe(`Pass Type ID: ${PASS_TYPE_ID}`);
    } finally {
      await s.fechar();
    }
  });

  it('reaproveita a sessão entre avisos', async () => {
    const s = await subirServidor(ok);
    const sessoes = new Set<unknown>();
    try {
      const c = novoCliente(s.host);
      await c.avisar(TOKEN);
      sessoes.add((c as any).sessao);
      await c.avisar(TOKEN);
      sessoes.add((c as any).sessao);
      expect(sessoes.size).toBe(1);
      expect(s.pedidos).toHaveLength(2);
    } finally {
      await s.fechar();
    }
  });

  it('devolve o status e o motivo do APNs', async () => {
    const s = await subirServidor((_p, stream) => {
      stream.respond({ ':status': 410, 'content-type': 'application/json' });
      stream.end(JSON.stringify({ reason: 'Unregistered' }));
    });
    try {
      expect(await novoCliente(s.host).avisar(TOKEN)).toEqual({ status: 410, motivo: 'Unregistered' });
    } finally {
      await s.fechar();
    }
  });

  it('sem chaves resolve sem-chave e não abre conexão', async () => {
    const espiao = jest.spyOn(http2, 'connect');
    const c = new ApplePassPushClient(async () => null, 'https://127.0.0.1:1');
    expect(await c.avisar(TOKEN)).toEqual({ status: 0, motivo: 'sem-chave' });
    const falha = new ApplePassPushClient(async () => {
      throw new Error('S3 fora');
    }, 'https://127.0.0.1:1');
    expect(await falha.avisar(TOKEN)).toEqual({ status: 0, motivo: 'sem-chave' });
    expect(espiao).not.toHaveBeenCalled();
  });

  it('token que não é hexadecimal não sai (iria no caminho do pedido)', async () => {
    const espiao = jest.spyOn(http2, 'connect');
    const c = novoCliente('https://127.0.0.1:1');
    for (const t of ['', 'ab/../x', 'zz'.repeat(32), 'ab'.repeat(101)]) {
      expect(await c.avisar(t)).toEqual({ status: 0, motivo: 'token-invalido' });
    }
    expect(espiao).not.toHaveBeenCalled();
  });

  it('servidor que não responde resolve timeout e não deixa promessa pendurada', async () => {
    const s = await subirServidor(() => undefined);
    try {
      const inicio = Date.now();
      const r = await novoCliente(s.host, CHAVES, 300).avisar(TOKEN);
      expect(r).toEqual({ status: 0, motivo: 'timeout' });
      expect(Date.now() - inicio).toBeLessThan(3_000);
      expect(s.pedidos).toHaveLength(1);
    } finally {
      await s.fechar();
    }
  });

  it('o padrão de timeout é 8 s', () => {
    expect((new ApplePassPushClient(async () => null) as any).timeoutMs).toBe(8_000);
  });

  it('sessão derrubada: tenta uma vez numa sessão nova', async () => {
    const s = await subirServidor((_p, stream, n) => {
      if (n === 1) {
        stream.session?.destroy();
        return;
      }
      ok(_p, stream);
    });
    try {
      expect(await novoCliente(s.host).avisar(TOKEN)).toEqual({ status: 200 });
      expect(s.pedidos).toHaveLength(2);
    } finally {
      await s.fechar();
    }
  });

  it('duas falhas de rede resolvem rede, sem lançar', async () => {
    const c = novoCliente('https://127.0.0.1:1');
    expect(await c.avisar(TOKEN)).toEqual({ status: 0, motivo: 'rede' });
  });

  it('nenhuma chamada de logger recebe o push token inteiro nem a chave', async () => {
    const s = await subirServidor((_p, stream) => {
      stream.respond({ ':status': 400 });
      stream.end(JSON.stringify({ reason: 'BadDeviceToken' }));
    });
    try {
      const c = novoCliente(s.host);
      await c.avisar(TOKEN);
      await novoCliente('https://127.0.0.1:1').avisar(TOKEN);
    } finally {
      await s.fechar();
    }
    const tudo = logs.flatMap((l) => l.mock.calls.flat()).map(String).join('\n');
    expect(tudo).not.toContain(TOKEN);
    expect(tudo).not.toContain('PRIVATE KEY');
  });
});

describe('WalletService.avisarApple', () => {
  const envOriginal = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
  });
  afterAll(() => {
    if (envOriginal === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = envOriginal;
  });
  afterEach(() => jest.restoreAllMocks());

  function build(respostas: Record<string, any>) {
    const { prisma, estado } = criarPrismaFalso({
      condominios: [{ id: 1, nome: 'R', qr_app_habilitado: true, wallet_habilitado: true }],
      moradores: [{ id: 11, id_user: 7, id_condominio: 1, nome: 'Ana', bloco: null, apartamento: '1' }],
      creds: [
        { id: 5, id_condominio: 1, tipo_pessoa: 'morador', id_pessoa: 11, origem: 'wallet_apple', segredo: 'x', revogada_em: null },
        { id: 6, id_condominio: 1, tipo_pessoa: 'morador', id_pessoa: 11, origem: 'wallet_apple', segredo: 'x', revogada_em: null },
      ],
      registros: [
        { id: 1, id_credencial: 5, device_id: 'd1', push_token: 'aa'.repeat(32) },
        { id: 2, id_credencial: 5, device_id: 'd2', push_token: 'bb'.repeat(32) },
        { id: 3, id_credencial: 5, device_id: 'd3', push_token: 'cc'.repeat(32) },
        { id: 4, id_credencial: 6, device_id: 'd4', push_token: 'dd'.repeat(32) },
      ],
    });
    const push = {
      avisar: jest.fn(async (t: string) => {
        const r = respostas[t];
        if (r instanceof Error) throw r;
        return r ?? { status: 200 };
      }),
    };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = new WalletService(
      prisma,
      new CredenciaisValidacaoService(prisma),
      { apple: async () => CHAVES } as any,
      { assertCondominio: async () => undefined } as any,
      { registrar: jest.fn() } as any,
      push,
    );
    return { svc, estado, push, prisma };
  }

  it('um token morto no meio é apagado e os outros são avisados (Review Focus 5)', async () => {
    const { svc, estado, push } = build({ ['bb'.repeat(32)]: { status: 410, motivo: 'Unregistered' } });
    expect(await svc.avisarApple([5])).toEqual({ avisados: 2, mortos: 1, falhas: 0 });
    expect(push.avisar).toHaveBeenCalledTimes(3);
    expect(estado.registros.map((r) => r.id).sort()).toEqual([1, 3, 4]);
  });

  it('só avisa os aparelhos das credenciais dadas', async () => {
    const { svc, push } = build({});
    expect(await svc.avisarApple([6])).toEqual({ avisados: 1, mortos: 0, falhas: 0 });
    expect(push.avisar).toHaveBeenCalledWith('dd'.repeat(32));
  });

  it('avisarApple nunca lança, mesmo com todos falhando', async () => {
    const { svc, estado } = build({
      ['aa'.repeat(32)]: new Error('quebrou'),
      ['bb'.repeat(32)]: { status: 0, motivo: 'timeout' },
      ['cc'.repeat(32)]: { status: 500, motivo: 'InternalServerError' },
    });
    expect(await svc.avisarApple([5])).toEqual({ avisados: 0, mortos: 0, falhas: 3 });
    expect(estado.registros).toHaveLength(4);

    const { svc: svc2, prisma } = build({});
    prisma.wallet_Registros.findMany.mockRejectedValueOnce(new Error('banco fora'));
    await expect(svc2.avisarApple([5])).resolves.toEqual({ avisados: 0, mortos: 0, falhas: 0 });
  });

  it('marcarAtualizado grava e avisa; cancelar avisa os aparelhos do passe', async () => {
    const { svc, estado, push } = build({});
    await svc.marcarAtualizado([5], new Date('2026-11-14T12:00:00Z'));
    await svc.aguardarAvisos();
    expect(estado.creds.find((c) => c.id === 5).wallet_atualizado_em).toEqual(new Date('2026-11-14T12:00:00Z'));
    expect(push.avisar).toHaveBeenCalledTimes(3);

    push.avisar.mockClear();
    await svc.cancelarDoUsuario({ sub: 7, nome: 'Ana', typeAccess: 'Morador' }, { id_condominio: 1 });
    await svc.aguardarAvisos();
    expect(push.avisar).toHaveBeenCalledTimes(4);
  });
});
