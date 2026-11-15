/**
 * Troca diária do código do passe: na hora 0 de Brasília, marca os passes de
 * carteira ativos (condomínios com as duas opções ligadas) e avisa os
 * aparelhos; cada um busca o passe com o código do dia.
 */
import { Logger } from '@nestjs/common';
import { CredenciaisValidacaoService } from '../credenciais/credenciais-validacao.service';
import { decodificarCodigo, diaBrasiliaDe } from '../credenciais/codigo-dinamico.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { cicloDoTickWallet, WalletService } from './wallet.service';
import { gerarChavesFalsas } from './testes/certificados-falsos';
import { criarPrismaFalso } from './testes/prisma-falso';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip');

const falsas = gerarChavesFalsas();
const CHAVES = { chavePem: falsas.passe.chavePem, certPem: falsas.passe.certPem, wwdrPem: falsas.wwdr.certPem };
const MORADOR: JwtPayload = { sub: 7, nome: 'Ana', typeAccess: 'Morador' };
const ONTEM = new Date('2026-11-14T12:00:00.000Z');
const VIRADA = new Date('2026-11-15T03:10:00.000Z');

describe('WalletService.tickDiario', () => {
  const envOriginal = { jwt: process.env.JWT_SECRET, node: process.env.NODE_ENV };
  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
  });
  afterAll(() => {
    if (envOriginal.jwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = envOriginal.jwt;
  });
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => {
    process.env.NODE_ENV = envOriginal.node;
    jest.restoreAllMocks();
  });

  function cred(id: number, extra: any) {
    return { id, tipo_pessoa: 'morador', id_pessoa: 11, segredo: 'x', revogada_em: null, wallet_atualizado_em: ONTEM, ...extra };
  }

  function build(opts: { semChaves?: boolean; respostas?: Record<string, any> } = {}) {
    const { prisma, estado } = criarPrismaFalso({
      condominios: [
        { id: 1, nome: 'Um', qr_app_habilitado: true, wallet_habilitado: true },
        { id: 2, nome: 'Dois', qr_app_habilitado: true, wallet_habilitado: false },
        { id: 3, nome: 'Três', qr_app_habilitado: false, wallet_habilitado: true },
      ],
      moradores: [{ id: 11, id_user: 7, id_condominio: 1, nome: 'Ana', bloco: null, apartamento: '1' }],
      creds: [
        cred(1, { id_condominio: 1, origem: 'wallet_apple' }),
        cred(2, { id_condominio: 1, origem: 'wallet_apple', revogada_em: ONTEM }),
        cred(3, { id_condominio: 1, origem: 'app' }),
        cred(4, { id_condominio: 2, origem: 'wallet_apple' }),
        cred(5, { id_condominio: 3, origem: 'wallet_apple' }),
        cred(6, { id_condominio: 1, origem: 'wallet_apple', id_pessoa: 12 }),
      ],
      registros: [
        { id: 1, id_credencial: 1, device_id: 'd1', push_token: 'a1'.repeat(32) },
        { id: 2, id_credencial: 1, device_id: 'd2', push_token: 'a2'.repeat(32) },
        { id: 3, id_credencial: 2, device_id: 'd3', push_token: 'a3'.repeat(32) },
        { id: 4, id_credencial: 4, device_id: 'd4', push_token: 'a4'.repeat(32) },
        { id: 5, id_credencial: 5, device_id: 'd5', push_token: 'a5'.repeat(32) },
        { id: 6, id_credencial: 6, device_id: 'd6', push_token: 'a6'.repeat(32) },
      ],
    });
    const push = {
      avisar: jest.fn(async (t: string) => {
        const r = opts.respostas?.[t];
        if (r instanceof Error) throw r;
        return r ?? { status: 200 };
      }),
    };
    const chaves = { apple: jest.fn(async () => (opts.semChaves ? null : CHAVES)) };
    const svc = new WalletService(
      prisma,
      new CredenciaisValidacaoService(prisma),
      chaves as any,
      { assertCondominio: async () => undefined } as any,
      { registrar: jest.fn() } as any,
      push,
    );
    // A troca roda na virada: é a hora que ela grava.
    svc.relogio = () => VIRADA;
    return { svc, prisma, estado, push, chaves };
  }

  it('avisa só as credenciais de carteira ativas de condomínios com as duas opções ligadas', async () => {
    const { svc, push } = build();
    expect(await svc.tickDiario()).toEqual({ apple: 2, google: 0 });
    expect(push.avisar.mock.calls.map((c) => c[0]).sort()).toEqual(['a1'.repeat(32), 'a2'.repeat(32), 'a6'.repeat(32)]);
  });

  it('grava wallet_atualizado_em nas credenciais avisadas, e só nelas', async () => {
    const { svc, estado } = build();
    await svc.tickDiario();
    const em = (id: number) => estado.creds.find((c) => c.id === id).wallet_atualizado_em;
    expect(em(1)).toEqual(VIRADA);
    expect(em(6)).toEqual(VIRADA);
    for (const id of [2, 3, 4, 5]) expect(em(id)).toEqual(ONTEM);
  });

  it('a troca diária não faz wallet_atualizado_em andar para trás', async () => {
    const { svc, estado } = build();
    const futuro = new Date(VIRADA.getTime() + 60_000);
    estado.creds.find((c) => c.id === 1).wallet_atualizado_em = futuro;
    await svc.tickDiario();
    expect(estado.creds.find((c) => c.id === 1).wallet_atualizado_em).toEqual(futuro);
    expect(estado.creds.find((c) => c.id === 6).wallet_atualizado_em).toEqual(VIRADA);
  });

  it('sem chaves da Apple no S3: não lança, marca e devolve apple 0 sem tentar avisar (Review Focus 4)', async () => {
    const { svc, push, estado } = build({ semChaves: true });
    await expect(svc.tickDiario()).resolves.toEqual({ apple: 0, google: 0 });
    expect(push.avisar).not.toHaveBeenCalled();
    expect(estado.creds.find((c) => c.id === 1).wallet_atualizado_em).toEqual(VIRADA);
  });

  it('um aparelho falhando não impede os demais (Review Focus 5)', async () => {
    const { svc, push, estado } = build({
      respostas: { ['a1'.repeat(32)]: new Error('quebrou'), ['a2'.repeat(32)]: { status: 410, motivo: 'Unregistered' } },
    });
    await expect(svc.tickDiario()).resolves.toEqual({ apple: 2, google: 0 });
    expect(push.avisar).toHaveBeenCalledWith('a6'.repeat(32));
    expect(estado.registros.map((r) => r.id).sort()).toEqual([1, 3, 4, 5, 6]);
  });

  it('falha na consulta inicial faz tickDiario lançar (o ciclo não é marcado e repete)', async () => {
    const { svc, prisma } = build();
    prisma.credenciais_Acesso.findMany.mockRejectedValueOnce(new Error('banco fora'));
    await expect(svc.tickDiario()).rejects.toThrow('banco fora');
  });

  it('cicloDeNegocio devolve null fora da hora 0 de Brasília e a data dentro dela', () => {
    expect(cicloDoTickWallet(new Date('2026-11-15T02:59:59Z'))).toBeNull();
    expect(cicloDoTickWallet(new Date('2026-11-15T03:00:00Z'))).toBe('2026-11-15');
    expect(cicloDoTickWallet(new Date('2026-11-15T03:59:59Z'))).toBe('2026-11-15');
    expect(cicloDoTickWallet(new Date('2026-11-15T04:00:00Z'))).toBeNull();
    expect(cicloDoTickWallet(new Date('2026-11-15T15:00:00Z'))).toBeNull();
  });

  it('depois do tick, o passe entregue pelo serviço da Apple traz o código do dia novo', async () => {
    const { svc, estado } = build();
    estado.creds = [];
    await svc.emitirApple(MORADOR, { id_condominio: 1 }, ONTEM);
    const id = estado.creds[0].id;
    await svc.tickDiario();
    const passe = await svc.passeAppleDaCredencial(id, VIRADA);
    const pass = JSON.parse(new AdmZip(passe!.pkpass).getEntry('pass.json').getData().toString('utf8'));
    expect(decodificarCodigo(pass.barcodes[0].message)!.contador).toBe(diaBrasiliaDe(VIRADA));
    expect(diaBrasiliaDe(VIRADA)).toBe(diaBrasiliaDe(ONTEM) + 1);
    expect(passe!.atualizadoEm).toEqual(VIRADA);
  });

  it('agenda o tick (5 min e de hora em hora, unref) fora dos testes; com NODE_ENV=test não agenda', () => {
    const { svc } = build();
    jest.useFakeTimers();
    try {
      const timeout = jest.spyOn(global, 'setTimeout');
      const intervalo = jest.spyOn(global, 'setInterval');

      process.env.NODE_ENV = 'test';
      svc.onModuleInit();
      expect(timeout).not.toHaveBeenCalled();
      expect(intervalo).not.toHaveBeenCalled();

      process.env.NODE_ENV = 'production';
      svc.onModuleInit();
      expect(timeout).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);
      expect(intervalo).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});
