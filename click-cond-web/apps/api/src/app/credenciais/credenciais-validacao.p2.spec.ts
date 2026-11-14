/**
 * Validação do código diário P2 (passe da carteira). Prisma simulado, no
 * mesmo molde de credenciais-validacao.service.spec.ts.
 */
import { encryptSecret } from '../facial/device-secret.util';
import { contadorDe, diaBrasiliaDe, gerarCodigo } from './codigo-dinamico.util';
import { CredenciaisValidacaoService, TEXTO_NEGACAO } from './credenciais-validacao.service';

const SEGREDO = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const AGORA = new Date('2026-11-14T12:00:10.000Z');
const HOJE = diaBrasiliaDe(AGORA);
const LEITOR = { id: 42, id_condominio: 1 };

describe('CredenciaisValidacaoService — P2', () => {
  const envOriginal = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
  });
  afterAll(() => {
    if (envOriginal === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = envOriginal;
  });

  function credencial(extra: any = {}) {
    return {
      id: 7,
      id_condominio: 1,
      tipo_pessoa: 'morador',
      id_pessoa: 11,
      id_visita: null,
      id_visitante: null,
      segredo: encryptSecret(SEGREDO.toString('hex')),
      origem: 'wallet_apple',
      versao_link: 1,
      valido_de: null,
      valido_ate: null,
      revogada_em: null,
      criado_em: new Date('2026-11-01T00:00:00.000Z'),
      wallet_atualizado_em: null,
      ...extra,
    };
  }

  function build(opts: { cred?: any; qr?: boolean; wallet?: boolean; morador?: any } = {}) {
    const cred = opts.cred === undefined ? credencial() : opts.cred;
    const prisma: any = {
      credenciais_Acesso: { findUnique: jest.fn(async () => cred) },
      condominios: {
        findUnique: jest.fn(async () => ({
          qr_app_habilitado: opts.qr ?? true,
          wallet_habilitado: opts.wallet ?? true,
        })),
      },
      moradores: {
        findUnique: jest.fn(async () =>
          opts.morador === undefined ? { id: 11, nome: 'Ana', tipo: 'morador', id_condominio: 1 } : opts.morador,
        ),
      },
      visitas: { findUnique: jest.fn(async () => null) },
      visitantes: { findUnique: jest.fn(async () => null) },
      credenciais_Leituras: {
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    return { svc: new CredenciaisValidacaoService(prisma), prisma };
  }

  const p2 = (dia = HOJE, id = 7, segredo = SEGREDO) => gerarCodigo('P2', id, dia, segredo);

  it('P2 do dia atual de credencial wallet_apple abre e não grava em Credenciais_Leituras', async () => {
    const { svc, prisma } = build();
    const r = await svc.validarLeitura(p2(), LEITOR, AGORA);
    expect(r).toEqual({
      ok: true,
      rotulo: 'cred:7',
      idCredencial: 7,
      contador: HOJE,
      alvo: { tipo: 'morador', morador: { id: 11, nome: 'Ana', tipo: 'morador' } },
    });
    expect(prisma.credenciais_Leituras.create).not.toHaveBeenCalled();
  });

  it('P2 do dia anterior abre (celular sem internet na virada)', async () => {
    const { svc } = build();
    expect(await svc.validarLeitura(p2(HOJE - 1), LEITOR, AGORA)).toMatchObject({ ok: true, contador: HOJE - 1 });
  });

  it('a virada vale às 03:00 UTC: o código de "ontem" ainda vale e o de anteontem não', async () => {
    const { svc } = build();
    const virada = new Date('2026-11-14T03:00:00.000Z');
    const dia = diaBrasiliaDe(virada);
    expect(await svc.validarLeitura(p2(dia - 1), LEITOR, virada)).toMatchObject({ ok: true });
    expect(await svc.validarLeitura(p2(dia - 2), LEITOR, virada)).toMatchObject({ ok: false, motivo: 'expirado' });
  });

  it('P2 de dois dias atrás é negado como expirado, não como assinatura (Review Focus 1)', async () => {
    const { svc } = build();
    expect(await svc.validarLeitura(p2(HOJE - 2), LEITOR, AGORA)).toEqual({
      ok: false,
      rotulo: 'cred:7',
      motivo: 'expirado',
    });
  });

  it('P2 do dia seguinte é negado como expirado', async () => {
    const { svc } = build();
    expect(await svc.validarLeitura(p2(HOJE + 1), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'expirado' });
  });

  it('P2 com contador no formato do P1 (30 s) é expirado', async () => {
    const { svc } = build();
    expect(await svc.validarLeitura(p2(contadorDe(AGORA)), LEITOR, AGORA)).toMatchObject({
      ok: false,
      motivo: 'expirado',
    });
  });

  it('o mesmo P2 lido duas vezes no mesmo leitor abre nas duas', async () => {
    const { svc } = build();
    const codigo = p2();
    expect(await svc.validarLeitura(codigo, LEITOR, AGORA)).toMatchObject({ ok: true });
    expect(await svc.validarLeitura(codigo, LEITOR, new Date(AGORA.getTime() + 60_000))).toMatchObject({ ok: true });
  });

  it('P2 com credencial de origem app é desconhecida; P1 com credencial wallet_google é desconhecida', async () => {
    // P2 calculado com o segredo do app (que o app conhece): sem esta
    // conferência, o segredo de 30 s viraria código de um dia sem anti-reuso.
    const app = build({ cred: credencial({ origem: 'app' }) });
    expect(await app.svc.validarLeitura(p2(), LEITOR, AGORA)).toEqual({
      ok: false,
      rotulo: 'cred:?',
      motivo: 'desconhecida',
    });
    const link = build({ cred: credencial({ origem: 'link', tipo_pessoa: 'visita', id_pessoa: null, id_visita: 3 }) });
    expect(await link.svc.validarLeitura(p2(), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'desconhecida' });

    const google = build({ cred: credencial({ origem: 'wallet_google' }) });
    const p1 = gerarCodigo('P1', 7, contadorDe(AGORA), SEGREDO);
    expect(await google.svc.validarLeitura(p1, LEITOR, AGORA)).toEqual({
      ok: false,
      rotulo: 'cred:?',
      motivo: 'desconhecida',
    });
    expect(google.prisma.credenciais_Leituras.create).not.toHaveBeenCalled();
  });

  it('P2 de wallet_google também abre', async () => {
    const { svc } = build({ cred: credencial({ origem: 'wallet_google' }) });
    expect(await svc.validarLeitura(p2(), LEITOR, AGORA)).toMatchObject({ ok: true });
  });

  it('wallet_habilitado desligado → carteira_desligada; qr_app_habilitado desligado → opcao_desligada', async () => {
    const semWallet = build({ wallet: false });
    expect(await semWallet.svc.validarLeitura(p2(), LEITOR, AGORA)).toEqual({
      ok: false,
      rotulo: 'cred:7',
      motivo: 'carteira_desligada',
    });
    const semQr = build({ qr: false, wallet: true });
    expect(await semQr.svc.validarLeitura(p2(), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'opcao_desligada' });
    expect(TEXTO_NEGACAO.carteira_desligada).toBe('Passe na carteira desligado neste condomínio');
  });

  it('o P1 do app não depende de wallet_habilitado', async () => {
    const { svc } = build({ cred: credencial({ origem: 'app' }), wallet: false });
    const p1 = gerarCodigo('P1', 7, contadorDe(AGORA), SEGREDO);
    expect(await svc.validarLeitura(p1, LEITOR, AGORA)).toMatchObject({ ok: true });
  });

  it('credencial revogada → revogada, na leitura seguinte ao cancelamento', async () => {
    const cred = credencial();
    const { svc } = build({ cred });
    expect(await svc.validarLeitura(p2(), LEITOR, AGORA)).toMatchObject({ ok: true });
    cred.revogada_em = new Date(AGORA.getTime() + 1000);
    expect(await svc.validarLeitura(p2(), LEITOR, new Date(AGORA.getTime() + 2000))).toMatchObject({
      ok: false,
      motivo: 'revogada',
    });
  });

  it('P2 de credencial de visita é desconhecida', async () => {
    const { svc } = build({ cred: credencial({ tipo_pessoa: 'visita', id_pessoa: null, id_visita: 300 }) });
    expect(await svc.validarLeitura(p2(), LEITOR, AGORA)).toEqual({ ok: false, rotulo: 'cred:?', motivo: 'desconhecida' });
  });

  it('assinatura errada é assinatura sem revelar estado; morador removido é morador_removido', async () => {
    const revogada = build({ cred: credencial({ revogada_em: new Date('2026-11-10T00:00:00Z') }), wallet: false });
    const forjado = gerarCodigo('P2', 7, HOJE, Buffer.alloc(32, 9));
    expect(await revogada.svc.validarLeitura(forjado, LEITOR, AGORA)).toEqual({
      ok: false,
      rotulo: 'cred:?',
      motivo: 'assinatura',
    });
    const semMorador = build({ morador: null });
    expect(await semMorador.svc.validarLeitura(p2(), LEITOR, AGORA)).toMatchObject({
      ok: false,
      motivo: 'morador_removido',
    });
  });

  it('nenhum resultado contém o código lido ou o segredo', async () => {
    const casos = [
      build(),
      build({ wallet: false }),
      build({ cred: credencial({ origem: 'app' }) }),
      build({ cred: credencial({ revogada_em: new Date() }) }),
    ];
    for (const [i, { svc }] of casos.entries()) {
      const codigo = i === 0 ? p2(HOJE - 2) : p2();
      const texto = JSON.stringify(await svc.validarLeitura(codigo, LEITOR, AGORA));
      expect(texto).not.toContain(codigo);
      expect(texto).not.toContain(codigo.slice(2));
      expect(texto).not.toContain(SEGREDO.toString('hex'));
    }
  });

  it('walletHabilitado só é verdadeiro com as duas opções ligadas', async () => {
    expect(await build({ qr: true, wallet: true }).svc.walletHabilitado(1)).toBe(true);
    expect(await build({ qr: false, wallet: true }).svc.walletHabilitado(1)).toBe(false);
    expect(await build({ qr: true, wallet: false }).svc.walletHabilitado(1)).toBe(false);
  });
});
