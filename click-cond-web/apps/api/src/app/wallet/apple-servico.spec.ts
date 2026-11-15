/**
 * Serviço de atualização de passes que a Apple chama (webServiceURL do
 * pass.json). Protocolo conferido em developer.apple.com/documentation/
 * walletpasses: registrar (201/200/401), listar alterados (200/204), entregar
 * o passe (200/401), remover registro (200/401) e log (200).
 */
import { Logger } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { SKIP_AUDIT_KEY } from '../common/interceptors/skip-audit.decorator';
import { CredenciaisValidacaoService } from '../credenciais/credenciais-validacao.service';
import { decodificarCodigo, diaBrasiliaDe } from '../credenciais/codigo-dinamico.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { AppleServicoController } from './apple-servico.controller';
import { WalletService } from './wallet.service';
import { PASS_TYPE_ID } from './wallet.constantes';
import { gerarChavesFalsas } from './testes/certificados-falsos';
import { criarPrismaFalso } from './testes/prisma-falso';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip');

const MORADOR: JwtPayload = { sub: 7, nome: 'Ana', typeAccess: 'Morador' };
const falsas = gerarChavesFalsas();
const CHAVES = { chavePem: falsas.passe.chavePem, certPem: falsas.passe.certPem, wwdrPem: falsas.wwdr.certPem };
const DEVICE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const PUSH = 'ab'.repeat(32);

class RespostaFalsa {
  codigo = 200;
  cabecalhos: Record<string, string> = {};
  corpo: unknown = undefined;
  status(c: number) {
    this.codigo = c;
    return this;
  }
  set(nome: string, valor: string) {
    this.cabecalhos[nome.toLowerCase()] = valor;
    return this;
  }
  send(b?: unknown) {
    this.corpo = b;
    return this;
  }
  json(b: unknown) {
    this.corpo = b;
    return this;
  }
  end() {
    return this;
  }
}

function passJson(pkpass: Buffer): any {
  return JSON.parse(new AdmZip(pkpass).getEntry('pass.json').getData().toString('utf8'));
}

describe('AppleServicoController', () => {
  const envOriginal = process.env.JWT_SECRET;
  let agora: Date;
  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
  });
  afterAll(() => {
    if (envOriginal === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = envOriginal;
  });
  beforeEach(() => {
    agora = new Date('2026-11-14T12:00:10.000Z');
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'], now: agora });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function build() {
    const { prisma, estado } = criarPrismaFalso({
      condominios: [{ id: 1, nome: 'Residencial Um', qr_app_habilitado: true, wallet_habilitado: true }],
      moradores: [{ id: 11, id_user: 7, id_condominio: 1, nome: 'Ana Souza', bloco: 'A', apartamento: '12' }],
    });
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const chaves: any = { apple: jest.fn(async () => CHAVES) };
    // Push falso: nenhum teste fala com o APNs de verdade.
    const push = { avisar: jest.fn(async () => ({ status: 200 })) };
    const svc = new WalletService(prisma, new CredenciaisValidacaoService(prisma), chaves, tenant, { registrar: jest.fn() } as any, push);
    const ctrl = new AppleServicoController(svc, prisma);
    const pass = passJson(await svc.emitirApple(MORADOR, { id_condominio: 1 }, agora));
    const id = estado.creds[0].id;
    return { ctrl, svc, prisma, estado, chaves, pass, id, serial: `c${id}`, auth: `ApplePass ${pass.authenticationToken}` };
  }

  /** Conta as consultas ao banco (qualquer método de qualquer tabela). */
  function consultas(prisma: any): number {
    let n = 0;
    for (const tabela of ['credenciais_Acesso', 'wallet_Registros', 'moradores', 'condominios']) {
      for (const f of Object.values(prisma[tabela]) as jest.Mock[]) n += f.mock.calls.length;
    }
    return n;
  }

  async function registrar(ctx: any, opts: { device?: string; auth?: string; serial?: string; corpo?: any; tipo?: string } = {}) {
    const res = new RespostaFalsa();
    await ctx.ctrl.registrar(
      opts.device ?? DEVICE,
      opts.tipo ?? PASS_TYPE_ID,
      opts.serial ?? ctx.serial,
      'auth' in opts ? opts.auth : ctx.auth,
      opts.corpo === undefined ? { pushToken: PUSH } : opts.corpo,
      res,
    );
    return res;
  }

  async function listar(ctx: any, desde?: string, device = DEVICE, tipo = PASS_TYPE_ID) {
    const res = new RespostaFalsa();
    await ctx.ctrl.listar(device, tipo, desde, res);
    return res;
  }

  async function entregar(ctx: any, opts: { auth?: string; serial?: string; tipo?: string } = {}) {
    const res = new RespostaFalsa();
    await ctx.ctrl.entregar(opts.tipo ?? PASS_TYPE_ID, opts.serial ?? ctx.serial, 'auth' in opts ? opts.auth : ctx.auth, res);
    return res;
  }

  it('as rotas são públicas e sem auditoria automática', () => {
    for (const m of ['registrar', 'listar', 'entregar', 'remover', 'log'] as const) {
      const h = (AppleServicoController.prototype as any)[m];
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, h)).toBe(true);
      expect(Reflect.getMetadata(SKIP_AUDIT_KEY, h)).toBe(true);
    }
  });

  it('registrar com token certo cria Wallet_Registros e responde 201; repetir responde 200 e atualiza o push_token', async () => {
    const ctx = await build();
    expect((await registrar(ctx)).codigo).toBe(201);
    expect(ctx.estado.registros).toEqual([
      expect.objectContaining({ device_id: DEVICE, id_credencial: ctx.id, push_token: PUSH }),
    ]);
    const novo = 'cd'.repeat(32);
    expect((await registrar(ctx, { corpo: { pushToken: novo } })).codigo).toBe(200);
    expect(ctx.estado.registros).toHaveLength(1);
    expect(ctx.estado.registros[0].push_token).toBe(novo);
  });

  it('registrar, entregar e remover com token errado, ausente ou de outro passe respondem 401 sem consultar o banco', async () => {
    const ctx = await build();
    const tokenDeOutro = `ApplePass ${ctx.svc.tokenDoPasse(ctx.id + 1)}`;
    const errados = [undefined, '', 'ApplePass', `Bearer ${ctx.pass.authenticationToken}`, tokenDeOutro, `${ctx.auth}x`, 'ApplePass ' + 'A'.repeat(32)];
    const antes = consultas(ctx.prisma);
    for (const auth of errados) {
      expect((await registrar(ctx, { auth: auth as any })).codigo).toBe(401);
      expect((await entregar(ctx, { auth: auth as any })).codigo).toBe(401);
      const res = new RespostaFalsa();
      await ctx.ctrl.remover(DEVICE, PASS_TYPE_ID, ctx.serial, auth as any, res);
      expect(res.codigo).toBe(401);
    }
    expect(consultas(ctx.prisma)).toBe(antes);
    expect(ctx.estado.registros).toHaveLength(0);
  });

  it('entregar devolve pkpass com o código P2 do dia e Last-Modified', async () => {
    const ctx = await build();
    const res = await entregar(ctx);
    expect(res.codigo).toBe(200);
    expect(res.cabecalhos['content-type']).toBe('application/vnd.apple.pkpass');
    expect(res.cabecalhos['last-modified']).toBe(agora.toUTCString());
    const pass = passJson(res.corpo as Buffer);
    const dec = decodificarCodigo(pass.barcodes[0].message)!;
    expect(dec).toMatchObject({ prefixo: 'P2', id: ctx.id, contador: diaBrasiliaDe(agora) });
  });

  it('entregar passe de credencial revogada devolve pkpass com voided true', async () => {
    const ctx = await build();
    await ctx.svc.cancelarDoUsuario(MORADOR, { id_condominio: 1 }, agora);
    const res = await entregar(ctx);
    expect(res.codigo).toBe(200);
    expect(passJson(res.corpo as Buffer).voided).toBe(true);
  });

  it('aparelho que passou dois dias offline recebe o código de hoje, não o de anteontem (Review Focus 1)', async () => {
    const ctx = await build();
    const deAnteontem = decodificarCodigo(ctx.pass.barcodes[0].message)!.contador;
    agora = new Date(agora.getTime() + 2 * 86_400_000);
    jest.setSystemTime(agora);
    const pass = passJson((await entregar(ctx)).corpo as Buffer);
    const dec = decodificarCodigo(pass.barcodes[0].message)!;
    expect(dec.contador).toBe(deAnteontem + 2);
    expect(dec.contador).toBe(diaBrasiliaDe(agora));
  });

  it('listar sem passesUpdatedSince devolve todos os números de série do aparelho', async () => {
    const ctx = await build();
    await registrar(ctx);
    const res = await listar(ctx);
    expect(res.codigo).toBe(200);
    expect(res.corpo).toEqual({ serialNumbers: [ctx.serial], lastUpdated: String(agora.getTime()) });
  });

  it('listar com passesUpdatedSince igual ao lastUpdated responde 204; depois de uma mudança, lista de novo', async () => {
    const ctx = await build();
    await registrar(ctx);
    const tag = ((await listar(ctx)).corpo as any).lastUpdated;
    const res = await listar(ctx, tag);
    expect(res.codigo).toBe(204);
    expect(res.corpo).toBeUndefined();

    ctx.svc.relogio = () => new Date(agora.getTime() + 1);
    await ctx.svc.marcarAtualizado([ctx.id]);
    expect((await listar(ctx, tag)).corpo).toEqual({ serialNumbers: [ctx.serial], lastUpdated: String(agora.getTime() + 1) });
  });

  it('listar com passesUpdatedSince que não é número se comporta como ausente (Review Focus 3)', async () => {
    const ctx = await build();
    await registrar(ctx);
    for (const tag of ['abc', '12abc', '-5', '1e9', '', '   ', '9'.repeat(40)]) {
      const res = await listar(ctx, tag);
      expect(res.codigo).toBe(200);
      expect((res.corpo as any).serialNumbers).toEqual([ctx.serial]);
    }
  });

  it('listar aparelho desconhecido responde 204; aparelho com nome inválido ou Pass Type ID de outro emissor também', async () => {
    const ctx = await build();
    await registrar(ctx);
    expect((await listar(ctx, undefined, 'outro-aparelho')).codigo).toBe(204);
    expect((await listar(ctx, undefined, 'x'.repeat(101))).codigo).toBe(204);
    expect((await listar(ctx, undefined, DEVICE, 'pass.com.outro')).codigo).toBe(204);
  });

  it('a listagem só contém serialNumbers e lastUpdated', async () => {
    const ctx = await build();
    await registrar(ctx);
    const corpo = (await listar(ctx)).corpo as any;
    expect(Object.keys(corpo).sort()).toEqual(['lastUpdated', 'serialNumbers']);
    expect(JSON.stringify(corpo)).not.toContain(PUSH);
    expect(JSON.stringify(corpo)).not.toContain(ctx.pass.authenticationToken);
  });

  it('a listagem não inclui passe que deixou de ser wallet_apple nem credencial apagada', async () => {
    const ctx = await build();
    await registrar(ctx);
    ctx.estado.registros.push({ id: 99, device_id: DEVICE, id_credencial: 9999, push_token: PUSH, atualizado_em: agora });
    expect(((await listar(ctx)).corpo as any).serialNumbers).toEqual([ctx.serial]);
  });

  it('série fora do formato c<id> e passTypeId de outro emissor respondem 404 (Review Focus 3)', async () => {
    const ctx = await build();
    for (const serial of ['7', 'c', 'c0', 'c01', 'C7', 'c7x', 'c99999999999', '../c7', `c${ctx.id} `]) {
      expect((await registrar(ctx, { serial })).codigo).toBe(404);
      expect((await entregar(ctx, { serial })).codigo).toBe(404);
    }
    expect((await registrar(ctx, { tipo: 'pass.com.outro' })).codigo).toBe(404);
    expect((await entregar(ctx, { tipo: 'pass.com.outro' })).codigo).toBe(404);
    const res = new RespostaFalsa();
    await ctx.ctrl.remover(DEVICE, 'pass.com.outro', ctx.serial, ctx.auth, res);
    expect(res.codigo).toBe(404);
  });

  it('série com token certo mas credencial inexistente ou de outra origem responde 404', async () => {
    const ctx = await build();
    ctx.estado.creds.push({ id: 500, id_condominio: 1, tipo_pessoa: 'morador', id_pessoa: 11, origem: 'app', segredo: 'x', revogada_em: null });
    for (const id of [500, 501]) {
      const auth = `ApplePass ${ctx.svc.tokenDoPasse(id)}`;
      expect((await entregar(ctx, { serial: `c${id}`, auth })).codigo).toBe(404);
      expect((await registrar(ctx, { serial: `c${id}`, auth })).codigo).toBe(404);
    }
    expect(ctx.estado.registros).toHaveLength(0);
  });

  it('registrar sem pushToken, com pushToken que não é hexadecimal ou com aparelho inválido responde 400', async () => {
    const ctx = await build();
    for (const corpo of [{}, null, { pushToken: 123 }, { pushToken: '' }, { pushToken: 'ab/../x' }, { pushToken: 'a'.repeat(201) }, 'texto']) {
      expect((await registrar(ctx, { corpo })).codigo).toBe(400);
    }
    expect((await registrar(ctx, { device: 'x'.repeat(101) })).codigo).toBe(400);
    expect((await registrar(ctx, { device: 'a/b' })).codigo).toBe(400);
    expect(ctx.estado.registros).toHaveLength(0);
  });

  it('um passe guarda no máximo 10 aparelhos: o 11º substitui o mais antigo', async () => {
    const ctx = await build();
    for (let i = 0; i < 11; i++) {
      jest.setSystemTime(new Date(agora.getTime() + i * 1000));
      expect((await registrar(ctx, { device: `aparelho${i}` })).codigo).toBe(201);
    }
    const aparelhos = ctx.estado.registros.map((r) => r.device_id);
    expect(aparelhos).toHaveLength(10);
    expect(aparelhos).not.toContain('aparelho0');
    expect(aparelhos).toContain('aparelho10');
  });

  it('remover registro responde 200 e apaga só aquele aparelho; inexistente também responde 200', async () => {
    const ctx = await build();
    await registrar(ctx);
    await registrar(ctx, { device: 'outro' });
    const res = new RespostaFalsa();
    await ctx.ctrl.remover(DEVICE, PASS_TYPE_ID, ctx.serial, ctx.auth, res);
    expect(res.codigo).toBe(200);
    expect(ctx.estado.registros.map((r) => r.device_id)).toEqual(['outro']);
    const res2 = new RespostaFalsa();
    await ctx.ctrl.remover('nunca-registrado', PASS_TYPE_ID, ctx.serial, ctx.auth, res2);
    expect(res2.codigo).toBe(200);
  });

  it('sem chaves no S3, entregar responde 503 (não 500)', async () => {
    const ctx = await build();
    ctx.chaves.apple.mockResolvedValue(null);
    expect((await entregar(ctx)).codigo).toBe(503);
  });

  it('erro do banco vira 503, nunca 500, e o log não repete a mensagem do erro', async () => {
    const ctx = await build();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    ctx.prisma.wallet_Registros.findMany.mockRejectedValueOnce(new Error('banco fora'));
    expect((await listar(ctx)).codigo).toBe(503);
    ctx.prisma.wallet_Registros.findUnique.mockRejectedValueOnce(
      Object.assign(new Error(`Invalid invocation: push_token: "${PUSH}"`), { code: 'P2000' }),
    );
    expect((await registrar(ctx)).codigo).toBe(503);
    const tudo = warn.mock.calls.flat().map(String).join(' | ');
    expect(tudo).toContain('P2000');
    expect(tudo).not.toContain(PUSH);
  });

  it('log: responde 200, loga a quantidade, e não loga token', async () => {
    const ctx = await build();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const token = ctx.pass.authenticationToken;
    const res = new RespostaFalsa();
    await ctx.ctrl.log(
      {
        logs: [
          `[2026-11-14] Get pass task (pass type ${PASS_TYPE_ID}, serial number ${ctx.serial}, authentication token ${token}) encountered error: push ${PUSH}\nlinha2 ${ctx.pass.barcodes[0].message}`,
          'segunda',
        ],
      },
      res,
    );
    expect(res.codigo).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    const linha = String(warn.mock.calls[0][0]);
    expect(linha).toContain('2 mensagem');
    expect(linha).not.toContain(token);
    expect(linha).not.toContain(PUSH);
    expect(linha).not.toContain(ctx.pass.barcodes[0].message);
    expect(linha).not.toContain('\n');
    expect(linha.length).toBeLessThan(400);

    for (const corpo of [undefined, null, 'x', { logs: 'x' }, { logs: [1, 2] }, { logs: [] }]) {
      const r = new RespostaFalsa();
      await ctx.ctrl.log(corpo as any, r);
      expect(r.codigo).toBe(200);
    }
  });
});
