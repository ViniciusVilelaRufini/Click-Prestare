/**
 * Validação de uma leitura de código dinâmico (QR que muda a cada 30 s).
 * Prisma simulado, sem banco.
 */
import { encryptSecret } from '../facial/device-secret.util';
import { contadorDe, gerarCodigo } from './codigo-dinamico.util';
import { CredenciaisValidacaoService, TEXTO_NEGACAO } from './credenciais-validacao.service';

const SEGREDO = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const OUTRO = Buffer.from('ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100', 'hex');
const AGORA = new Date('2026-11-14T12:00:10.000Z');
const LEITOR = { id: 42, id_condominio: 1 };

describe('CredenciaisValidacaoService', () => {
  const envOriginal = { jwt: process.env.JWT_SECRET, flag: process.env.PESSOAS_MIGRATION_ENABLED };
  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
  });
  afterEach(() => {
    if (envOriginal.flag === undefined) delete process.env.PESSOAS_MIGRATION_ENABLED;
    else process.env.PESSOAS_MIGRATION_ENABLED = envOriginal.flag;
  });
  afterAll(() => {
    if (envOriginal.jwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = envOriginal.jwt;
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
      origem: 'app',
      versao_link: 1,
      valido_de: null,
      valido_ate: null,
      revogada_em: null,
      criado_em: new Date('2026-11-01T00:00:00.000Z'),
      ...extra,
    };
  }

  function build(opts: { cred?: any; opcao?: boolean; morador?: any; visita?: any; visitante?: any } = {}) {
    const cred = opts.cred === undefined ? credencial() : opts.cred;
    const prisma: any = {
      credenciais_Acesso: { findUnique: jest.fn(async () => cred) },
      condominios: {
        findUnique: jest.fn(async () => ({ qr_app_habilitado: opts.opcao ?? true })),
      },
      moradores: {
        findUnique: jest.fn(async () =>
          opts.morador === undefined ? { id: 11, nome: 'Ana', tipo: 'morador', id_condominio: 1 } : opts.morador,
        ),
      },
      visitas: { findUnique: jest.fn(async () => opts.visita ?? null) },
      visitantes: { findUnique: jest.fn(async () => opts.visitante ?? null) },
      credenciais_Leituras: {
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    return { svc: new CredenciaisValidacaoService(prisma), prisma };
  }

  const codigo = (deslocamento = 0, segredo = SEGREDO, id = 7) =>
    gerarCodigo('P1', id, contadorDe(AGORA) + deslocamento, segredo);

  it('morador válido devolve o morador e grava a leitura', async () => {
    const { svc, prisma } = build();

    const r = await svc.validarLeitura(codigo(), LEITOR, AGORA);

    expect(r).toEqual({
      ok: true,
      rotulo: 'cred:7',
      idCredencial: 7,
      contador: contadorDe(AGORA),
      alvo: { tipo: 'morador', morador: { id: 11, nome: 'Ana', tipo: 'morador' } },
    });
    expect(prisma.credenciais_Leituras.create).toHaveBeenCalledWith({
      data: { id_credencial: 7, id_device: 42, contador: contadorDe(AGORA) },
    });
  });

  it('visita válida devolve o PIN da visita, pela tabela certa conforme a flag', async () => {
    const credVisita = credencial({ tipo_pessoa: 'visita', id_pessoa: null, id_visita: 300, id_visitante: 30, origem: 'link' });

    process.env.PESSOAS_MIGRATION_ENABLED = 'true';
    const comFlag = build({ cred: credVisita, visita: { id: 300, id_condominio: 1, codigo_acesso: '482913' } });
    const r1 = await comFlag.svc.validarLeitura(codigo(), LEITOR, AGORA);
    expect(r1).toMatchObject({ ok: true, alvo: { tipo: 'visita', codigoAcesso: '482913' } });
    expect(comFlag.prisma.visitas.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 300 } }));
    expect(comFlag.prisma.visitantes.findUnique).not.toHaveBeenCalled();

    process.env.PESSOAS_MIGRATION_ENABLED = 'false';
    const semFlag = build({ cred: credVisita, visitante: { id: 30, id_condominio: 1, codigo_acesso: '111222' } });
    const r2 = await semFlag.svc.validarLeitura(codigo(), LEITOR, AGORA);
    expect(r2).toMatchObject({ ok: true, alvo: { tipo: 'visita', codigoAcesso: '111222' } });
    expect(semFlag.prisma.visitantes.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 30 } }));
    expect(semFlag.prisma.visitas.findUnique).not.toHaveBeenCalled();
  });

  describe('um motivo por conferência', () => {
    it('desconhecida: não decodifica', async () => {
      const { svc, prisma } = build();
      const r = await svc.validarLeitura('P1AAAAAAIDQRCMABTQCSPWDO5F31', LEITOR, AGORA);
      expect(r).toEqual({ ok: false, rotulo: 'cred:?', motivo: 'desconhecida' });
      expect(prisma.credenciais_Acesso.findUnique).not.toHaveBeenCalled();
    });

    it('desconhecida: credencial inexistente, sem atribuir a leitura a um id', async () => {
      const { svc } = build({ cred: null });
      expect(await svc.validarLeitura(codigo(), LEITOR, AGORA)).toEqual({ ok: false, rotulo: 'cred:?', motivo: 'desconhecida' });
    });

    it('credencial de outro condomínio é "desconhecida" (Review Focus 4)', async () => {
      const { svc, prisma } = build({ cred: credencial({ id_condominio: 2 }) });
      const r = await svc.validarLeitura(codigo(), LEITOR, AGORA);
      expect(r).toEqual({ ok: false, rotulo: 'cred:?', motivo: 'desconhecida' });
      expect(prisma.credenciais_Leituras.create).not.toHaveBeenCalled();
    });

    it('opcao_desligada', async () => {
      const { svc, prisma } = build({ opcao: false });
      expect(await svc.validarLeitura(codigo(), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'opcao_desligada' });
      expect(prisma.condominios.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
    });

    it('revogada', async () => {
      const { svc } = build({ cred: credencial({ revogada_em: new Date('2026-11-10T00:00:00.000Z') }) });
      expect(await svc.validarLeitura(codigo(), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'revogada' });
    });

    it('fora_validade: antes de valido_de e depois de valido_ate', async () => {
      const antes = build({ cred: credencial({ valido_de: new Date('2026-11-15T00:00:00.000Z') }) });
      expect(await antes.svc.validarLeitura(codigo(), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'fora_validade' });
      const depois = build({ cred: credencial({ valido_ate: new Date('2026-11-14T11:00:00.000Z') }) });
      expect(await depois.svc.validarLeitura(codigo(), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'fora_validade' });
      const dentro = build({
        cred: credencial({ valido_de: new Date('2026-11-14T00:00:00.000Z'), valido_ate: new Date('2026-11-15T00:00:00.000Z') }),
      });
      expect(await dentro.svc.validarLeitura(codigo(), LEITOR, AGORA)).toMatchObject({ ok: true });
    });

    it('assinatura: código gerado com outro segredo vira "cred:?" (não é atribuído à credencial real)', async () => {
      const { svc, prisma } = build();
      expect(await svc.validarLeitura(codigo(0, OUTRO), LEITOR, AGORA)).toEqual({ ok: false, rotulo: 'cred:?', motivo: 'assinatura' });
      expect(prisma.credenciais_Leituras.create).not.toHaveBeenCalled();
    });

    it('assinatura vem antes de opção, revogação, validade e janela: um MAC forjado nunca revela o estado da credencial', async () => {
      const casos = [
        build({ opcao: false }),
        build({ cred: credencial({ revogada_em: new Date('2026-11-10T00:00:00.000Z') }) }),
        build({ cred: credencial({ valido_ate: new Date('2026-11-14T11:00:00.000Z') }) }),
        build({ cred: credencial({ valido_de: new Date('2026-11-15T00:00:00.000Z') }) }),
      ];
      for (const { svc, prisma } of casos) {
        expect(await svc.validarLeitura(codigo(0, OUTRO), LEITOR, AGORA)).toEqual({ ok: false, rotulo: 'cred:?', motivo: 'assinatura' });
        expect(prisma.condominios.findUnique).not.toHaveBeenCalled();
      }
      const velho = build();
      expect(await velho.svc.validarLeitura(codigo(-9, OUTRO), LEITOR, AGORA)).toEqual({ ok: false, rotulo: 'cred:?', motivo: 'assinatura' });
    });

    it('assinatura: segredo gravado ilegível (chave trocada) não derruba', async () => {
      const { svc } = build({ cred: credencial({ segredo: 'enc:v1:lixo' }) });
      expect(await svc.validarLeitura(codigo(), LEITOR, AGORA)).toEqual({ ok: false, rotulo: 'cred:?', motivo: 'assinatura' });
    });

    it('expirado', async () => {
      const { svc } = build();
      expect(await svc.validarLeitura(codigo(-5), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'expirado' });
    });

    it('morador_removido: ausente ou de outro condomínio', async () => {
      const ausente = build({ morador: null });
      expect(await ausente.svc.validarLeitura(codigo(), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'morador_removido' });
      const mudou = build({ morador: { id: 11, nome: 'Ana', tipo: 'morador', id_condominio: 2 } });
      expect(await mudou.svc.validarLeitura(codigo(), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'morador_removido' });
    });

    it('visita_encerrada: PIN anulado, ausente ou de outro condomínio', async () => {
      process.env.PESSOAS_MIGRATION_ENABLED = 'true';
      const cred = credencial({ tipo_pessoa: 'visita', id_pessoa: null, id_visita: 300, origem: 'link' });
      for (const visita of [
        { id: 300, id_condominio: 1, codigo_acesso: null },
        null,
        { id: 300, id_condominio: 2, codigo_acesso: '482913' },
      ]) {
        const { svc, prisma } = build({ cred, visita });
        expect(await svc.validarLeitura(codigo(), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'visita_encerrada' });
        expect(prisma.credenciais_Leituras.create).not.toHaveBeenCalled();
      }
    });

    it('reuso: segunda leitura do mesmo código no mesmo leitor, sem lançar (Review Focus 2)', async () => {
      const { svc, prisma } = build();
      prisma.credenciais_Leituras.create
        .mockResolvedValueOnce({ id: 1 })
        .mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

      const c = codigo();
      const [r1, r2] = await Promise.all([
        svc.validarLeitura(c, LEITOR, AGORA),
        svc.validarLeitura(c, LEITOR, AGORA),
      ]);

      expect(r1).toMatchObject({ ok: true });
      expect(r2).toEqual({ ok: false, rotulo: 'cred:7', motivo: 'reuso' });
    });

    it('outro erro do banco ao gravar a leitura sobe', async () => {
      const { svc, prisma } = build();
      prisma.credenciais_Leituras.create.mockRejectedValueOnce(new Error('conexão perdida'));
      await expect(svc.validarLeitura(codigo(), LEITOR, AGORA)).rejects.toThrow('conexão perdida');
    });
  });

  it('aceita contador vizinho (−1 e +1) e nega ±2 como expirado (Review Focus 3)', async () => {
    const { svc } = build();
    expect(await svc.validarLeitura(codigo(-1), LEITOR, AGORA)).toMatchObject({ ok: true, contador: contadorDe(AGORA) - 1 });
    expect(await svc.validarLeitura(codigo(1), LEITOR, AGORA)).toMatchObject({ ok: true, contador: contadorDe(AGORA) + 1 });
    expect(await svc.validarLeitura(codigo(2), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'expirado' });
    expect(await svc.validarLeitura(codigo(-2), LEITOR, AGORA)).toMatchObject({ ok: false, motivo: 'expirado' });
  });

  it('o mesmo código em outro leitor é aceito', async () => {
    const { svc, prisma } = build();
    const c = codigo();
    expect(await svc.validarLeitura(c, LEITOR, AGORA)).toMatchObject({ ok: true });
    expect(await svc.validarLeitura(c, { id: 43, id_condominio: 1 }, AGORA)).toMatchObject({ ok: true });
    expect(prisma.credenciais_Leituras.create.mock.calls.map((c: any[]) => c[0].data.id_device)).toEqual([42, 43]);
  });

  it('aceita a leitura suja de leitor (minúsculas, espaço, \\r\\n)', async () => {
    const { svc } = build();
    expect(await svc.validarLeitura(`  ${codigo().toLowerCase()}\r\n`, LEITOR, AGORA)).toMatchObject({ ok: true });
  });

  it('nenhum resultado, nem o rótulo, contém o código lido ou o segredo', async () => {
    const segredoGuardado = credencial().segredo as string;
    const casos: Array<[any, string]> = [
      [build(), codigo()],
      [build(), codigo(0, OUTRO)],
      [build(), codigo(9)],
      [build({ opcao: false }), codigo()],
      [build({ morador: null }), codigo()],
      [build(), 'P1AAAAAAIDQRCMABTQCSPWDO5F31'],
    ];
    for (const [{ svc }, lido] of casos) {
      const texto = JSON.stringify(await svc.validarLeitura(lido, LEITOR, AGORA));
      expect(texto).not.toContain(lido);
      expect(texto.toLowerCase()).not.toContain(SEGREDO.toString('hex'));
      expect(texto).not.toContain(segredoGuardado);
    }
  });

  it('limpa leituras antigas de vez em quando, sem aguardar e sem propagar erro', async () => {
    const { svc, prisma } = build();
    prisma.credenciais_Leituras.deleteMany.mockRejectedValue(new Error('falhou'));
    for (let i = 0; i < 200; i++) {
      prisma.credenciais_Leituras.create.mockResolvedValueOnce({ id: i });
      await svc.validarLeitura(codigo(), { id: 1000 + i, id_condominio: 1 }, AGORA);
    }
    expect(prisma.credenciais_Leituras.deleteMany).toHaveBeenCalledTimes(1);
    const corte: Date = prisma.credenciais_Leituras.deleteMany.mock.calls[0][0].where.lido_em.lt;
    expect(corte.getTime()).toBeLessThanOrEqual(Date.now() - 10 * 60 * 1000 + 1000);
  });

  it('qrAppHabilitado lê só a coluna do condomínio', async () => {
    const { svc, prisma } = build({ opcao: false });
    expect(await svc.qrAppHabilitado(1)).toBe(false);
    expect(prisma.condominios.findUnique).toHaveBeenCalledWith({ where: { id: 1 }, select: { qr_app_habilitado: true } });
    prisma.condominios.findUnique.mockResolvedValueOnce(null);
    expect(await svc.qrAppHabilitado(99)).toBe(false);
  });

  it('textos de negação', () => {
    expect(TEXTO_NEGACAO).toEqual({
      desconhecida: 'QR não reconhecido',
      opcao_desligada: 'QR no app desligado neste condomínio',
      revogada: 'QR cancelado',
      fora_validade: 'QR fora da validade',
      assinatura: 'QR inválido',
      expirado: 'QR vencido (mostre o código atual)',
      reuso: 'QR já usado neste leitor',
      visita_encerrada: 'Visita encerrada',
      morador_removido: 'Morador não encontrado',
    });
  });
});
