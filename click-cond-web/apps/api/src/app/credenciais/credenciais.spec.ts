/**
 * Emissão da credencial do morador, link do passe do visitante, leitura
 * pública do passe e opção "QR no app" do condomínio. Prisma simulado.
 *
 * O que estes testes protegem:
 *  1. O segredo só sai uma vez (na emissão) e nunca na leitura pública.
 *  2. Token malformado, de outra versão, revogado ou de visita encerrada
 *     respondem IGUAL (404 "Passe indisponível."): sem oráculo.
 *  3. Usuário com morador em dois condomínios recebe a credencial do pedido.
 */
import { BadRequestException, ForbiddenException, NotFoundException, RequestMethod } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { decryptSecret } from '../facial/device-secret.util';
import { CredenciaisService } from './credenciais.service';
import { CredenciaisValidacaoService } from './credenciais-validacao.service';
import { CredenciaisController, PassesPublicosController } from './credenciais.controller';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { SKIP_AUDIT_KEY } from '../common/interceptors/skip-audit.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

const MORADOR: JwtPayload = { sub: 7, nome: 'Ana', typeAccess: 'Morador' };
const SINDICO: JwtPayload = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico' };
const FUNCIONARIO: JwtPayload = { sub: 8, nome: 'Zé', typeAccess: 'Funcionario' };
const AGORA = new Date('2026-11-14T12:00:10.000Z');

describe('Credenciais', () => {
  const envOriginal = { jwt: process.env.JWT_SECRET, base: process.env.CONVITE_BASE_URL, flag: process.env.PESSOAS_MIGRATION_ENABLED };
  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
    process.env.CONVITE_BASE_URL = 'https://exemplo.test/';
    process.env.PESSOAS_MIGRATION_ENABLED = 'true';
  });
  afterAll(() => {
    for (const [k, v] of [
      ['JWT_SECRET', envOriginal.jwt],
      ['CONVITE_BASE_URL', envOriginal.base],
      ['PESSOAS_MIGRATION_ENABLED', envOriginal.flag],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /**
   * GET_LOCK/RELEASE_LOCK do MySQL simulados: cada $transaction é uma sessão;
   * GET_LOCK de um nome ocupado espera o RELEASE_LOCK (como com timeout > 0).
   */
  function comGetLockFalso(prisma: any) {
    const donos = new Map<string, number>();
    const filas = new Map<string, Array<() => void>>();
    let sessoes = 0;
    prisma.$transaction = jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const sessao = ++sessoes;
      const tx = {
        $queryRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
          const sql = partes.join('?');
          const nome = String(valores[0]);
          if (sql.includes('GET_LOCK')) {
            while (donos.has(nome) && donos.get(nome) !== sessao) {
              await new Promise<void>((r) => filas.set(nome, [...(filas.get(nome) ?? []), r]));
            }
            donos.set(nome, sessao);
            return [{ ok: BigInt(1) }];
          }
          if (sql.includes('RELEASE_LOCK')) {
            if (donos.get(nome) === sessao) donos.delete(nome);
            const espera = filas.get(nome) ?? [];
            filas.delete(nome);
            espera.forEach((r) => r());
            return [{ ok: BigInt(1) }];
          }
          throw new Error(`SQL inesperado: ${sql}`);
        },
      };
      return fn(tx);
    });
    return prisma;
  }

  /** Cede o event loop: sem lock, as duas chamadas se intercalam entre os awaits. */
  const ceder = () => new Promise<void>((r) => setImmediate(r));

  function build(
    opts: {
      opcao?: boolean;
      moradores?: any[];
      visita?: any;
      acessoVisita?: Error | null;
      permissaoFuncionario?: boolean;
      vinculosApto?: Array<{ id_user: number; id_apto: number }>;
      lento?: boolean;
    } = {},
  ) {
    const creds: any[] = [];
    let opcao = opts.opcao ?? true;
    const moradores = opts.moradores ?? [
      { id: 11, id_user: 7, id_condominio: 1, nome: 'Ana', tipo: 'morador' },
      { id: 12, id_user: 7, id_condominio: 2, nome: 'Ana', tipo: 'morador' },
    ];
    let visita =
      opts.visita === undefined
        ? {
            id: 300,
            id_condominio: 1,
            id_apartamento: 5,
            codigo_acesso: '482913',
            data_hora_inicio: new Date('2026-11-14T00:00:00.000Z'),
            data_hora_termino: new Date('2026-11-16T00:00:00.000Z'),
            pessoa: { nome: 'Vítor Souza Lima' },
          }
        : opts.visita;
    const casa = (c: any, where: any) =>
      Object.entries(where ?? {}).every(([k, v]) => (v === null ? c[k] == null : c[k] === v));
    const prisma: any = {
      isConnected: true,
      moradores: {
        findFirst: jest.fn(async ({ where }: any) =>
          moradores
            .filter((m) => m.id_user === where.id_user && m.id_condominio === where.id_condominio)
            .sort((a, b) => a.id - b.id)[0] ?? null,
        ),
        findUnique: jest.fn(async ({ where }: any) => moradores.find((m) => m.id === where.id) ?? null),
      },
      condominios: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 1 || where.id === 2 ? { id: where.id, nome: `Condomínio ${where.id}`, qr_app_habilitado: opcao } : null,
        ),
        update: jest.fn(async ({ data }: any) => {
          opcao = data.qr_app_habilitado;
          return { qr_app_habilitado: opcao };
        }),
      },
      credenciais_Acesso: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (opts.lento) await ceder();
          return creds.filter((c) => casa(c, where)).sort((a, b) => b.id - a.id)[0] ?? null;
        }),
        findUnique: jest.fn(async ({ where }: any) => creds.find((c) => c.id === where.id) ?? null),
        create: jest.fn(async ({ data }: any) => {
          if (opts.lento) await ceder();
          const c ={ id: 100 + creds.length, versao_link: 1, valido_de: null, valido_ate: null, revogada_em: null, criado_em: AGORA, ...data };
          creds.push(c);
          return c;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (opts.lento) await ceder();
          const alvos = creds.filter((c) => casa(c, where));
          for (const c of alvos) {
            for (const [k, v] of Object.entries(data)) {
              c[k] = v && typeof v === 'object' && 'increment' in (v as any) ? c[k] + (v as any).increment : v;
            }
          }
          return { count: alvos.length };
        }),
      },
      visitas: { findUnique: jest.fn(async ({ where }: any) => (visita && where.id === visita.id ? visita : null)) },
      visitantes: { findUnique: jest.fn(async () => null) },
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          (opts.vinculosApto ?? []).find((v) => v.id_user === where.id_user && v.id_apto === where.id_apto) ?? null,
        ),
      },
      credenciais_Leituras: {
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const tenant: any = {
      assertCondominio: jest.fn(async (id: number, user: JwtPayload) => {
        if (id === 3) throw new ForbiddenException('Acesso negado: condomínio inválido.');
      }),
      assertPermissaoFuncionario: jest.fn(async (_id: number, permissao: string, user: JwtPayload) => {
        if ((user.typeAccess ?? '').toLowerCase() !== 'funcionario') return;
        if (permissao === 'cadastrar_visitante' && opts.permissaoFuncionario === true) return;
        throw new ForbiddenException('Acesso negado: seu perfil não tem permissão para esta área. Fale com o síndico.');
      }),
    };
    const visitantes: any = {
      referenciaParaCredencial: jest.fn(async (id: number, payload?: JwtPayload) => {
        if (payload && opts.acessoVisita) throw opts.acessoVisita;
        if (!visita || visita.id !== id) throw new NotFoundException('Visita não encontrada.');
        return {
          espaco: 'visita',
          id: visita.id,
          id_condominio: visita.id_condominio,
          nome: visita.pessoa.nome,
          codigo_acesso: visita.codigo_acesso,
          id_apartamento: visita.id_apartamento ?? null,
          data_hora_inicio: visita.data_hora_inicio,
          data_hora_termino: visita.data_hora_termino,
          bloco: 'A',
          apto: '101',
        };
      }),
    };
    const svc = new CredenciaisService(prisma, tenant, visitantes);
    const validacao = new CredenciaisValidacaoService(prisma);
    return {
      svc,
      prisma,
      tenant,
      visitantes,
      validacao,
      creds,
      encerrarVisita: () => {
        if (visita) visita = { ...visita, codigo_acesso: null };
      },
    };
  }

  const tokenDe = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('passe') as string;

  describe('credenciais/minha', () => {
    it('primeira chamada cria a credencial e devolve o segredo em hex de 64 caracteres', async () => {
      const { svc, creds } = build();

      const r: any = await svc.minha(MORADOR, { id_condominio: 1 }, AGORA);

      expect(r).toEqual({ disponivel: true, id: creds[0].id, segredo: expect.stringMatching(/^[0-9a-f]{64}$/), intervalo_s: 30, agora_servidor: AGORA.toISOString() });
      expect(creds).toHaveLength(1);
      expect(creds[0]).toMatchObject({ id_condominio: 1, tipo_pessoa: 'morador', id_pessoa: 11, origem: 'app', revogada_em: null });
    });

    it('segunda chamada sem renovar devolve o mesmo id e nenhum segredo', async () => {
      const { svc } = build();
      const r1: any = await svc.minha(MORADOR, { id_condominio: 1 }, AGORA);

      const r2: any = await svc.minha(MORADOR, { id_condominio: 1 }, new Date(AGORA.getTime() + 5000));

      expect(r2.id).toBe(r1.id);
      expect(r2).not.toHaveProperty('segredo');
      expect(r2.agora_servidor).toBe(new Date(AGORA.getTime() + 5000).toISOString());
    });

    it('renovar revoga a anterior e devolve id e segredo novos', async () => {
      const { svc, creds } = build();
      const r1: any = await svc.minha(MORADOR, { id_condominio: 1 }, AGORA);

      const r2: any = await svc.minha(MORADOR, { id_condominio: 1, renovar: true }, AGORA);

      expect(r2.id).not.toBe(r1.id);
      expect(r2.segredo).toMatch(/^[0-9a-f]{64}$/);
      expect(r2.segredo).not.toBe(r1.segredo);
      expect(creds.find((c) => c.id === r1.id).revogada_em).toEqual(AGORA);
      expect(creds.filter((c) => c.revogada_em == null)).toHaveLength(1);
    });

    it('duas chamadas simultâneas com renovar deixam UMA credencial ativa (lock por pessoa, condomínio e origem)', async () => {
      const b = build({ lento: true });
      comGetLockFalso(b.prisma);
      await b.svc.minha(MORADOR, { id_condominio: 1 }, AGORA);

      const [r1, r2]: any[] = await Promise.all([
        b.svc.minha(MORADOR, { id_condominio: 1, renovar: true }, AGORA),
        b.svc.minha(MORADOR, { id_condominio: 1, renovar: true }, AGORA),
      ]);

      const ativas = b.creds.filter((c) => c.revogada_em == null);
      expect(ativas).toHaveLength(1);
      expect([r1.id, r2.id]).toContain(ativas[0].id);
      expect(b.prisma.$transaction).toHaveBeenCalled();
    });

    it('duas primeiras chamadas simultâneas criam uma credencial só', async () => {
      const b = build({ lento: true });
      comGetLockFalso(b.prisma);

      const [r1, r2]: any[] = await Promise.all([
        b.svc.minha(MORADOR, { id_condominio: 1 }, AGORA),
        b.svc.minha(MORADOR, { id_condominio: 1 }, AGORA),
      ]);

      expect(b.creds).toHaveLength(1);
      expect(r1.id).toBe(r2.id);
    });

    it('o lock é por pessoa e condomínio: condomínios diferentes seguem independentes', async () => {
      const b = build({ lento: true });
      comGetLockFalso(b.prisma);
      await Promise.all([
        b.svc.minha(MORADOR, { id_condominio: 1 }, AGORA),
        b.svc.minha(MORADOR, { id_condominio: 2 }, AGORA),
      ]);
      expect(b.creds.map((c) => c.id_condominio).sort()).toEqual([1, 2]);
    });

    it('usuário com morador em dois condomínios recebe a do condomínio pedido (Review Focus 4)', async () => {
      const { svc, creds, validacao } = build();

      const r1: any = await svc.minha(MORADOR, { id_condominio: 1 }, AGORA);
      const r2: any = await svc.minha(MORADOR, { id_condominio: 2 }, AGORA);

      expect(creds.find((c) => c.id === r1.id)).toMatchObject({ id_condominio: 1, id_pessoa: 11 });
      expect(creds.find((c) => c.id === r2.id)).toMatchObject({ id_condominio: 2, id_pessoa: 12 });
      // O código do condomínio 2 não abre no leitor do condomínio 1.
      const { gerarCodigo, contadorDe } = await import('./codigo-dinamico.util');
      const codigo2 = gerarCodigo('P1', r2.id, contadorDe(AGORA), Buffer.from(r2.segredo, 'hex'));
      expect(await validacao.validarLeitura(codigo2, { id: 42, id_condominio: 1 }, AGORA)).toMatchObject({ ok: false, motivo: 'desconhecida' });
      expect(await validacao.validarLeitura(codigo2, { id: 43, id_condominio: 2 }, AGORA)).toMatchObject({ ok: true });
    });

    it('usa a primeira linha de morador por id quando há duas no mesmo condomínio', async () => {
      const { svc, creds } = build({
        moradores: [
          { id: 21, id_user: 7, id_condominio: 1, nome: 'Ana', tipo: 'morador' },
          { id: 20, id_user: 7, id_condominio: 1, nome: 'Ana', tipo: 'morador' },
        ],
      });
      await svc.minha(MORADOR, { id_condominio: 1 }, AGORA);
      expect(creds[0].id_pessoa).toBe(20);
    });

    it('usuário sem linha de morador naquele condomínio recebe disponivel:false, motivo sem_morador', async () => {
      const { svc, creds } = build({ moradores: [] });
      expect(await svc.minha(MORADOR, { id_condominio: 1 }, AGORA)).toEqual({ disponivel: false, motivo: 'sem_morador' });
      expect(creds).toHaveLength(0);
    });

    it('opção desligada devolve disponivel:false, motivo opcao_desligada', async () => {
      const { svc, creds } = build({ opcao: false });
      expect(await svc.minha(MORADOR, { id_condominio: 1 }, AGORA)).toEqual({ disponivel: false, motivo: 'opcao_desligada' });
      expect(creds).toHaveLength(0);
    });

    it('condomínio de outro tenant é barrado pelo assertCondominio', async () => {
      const { svc, tenant } = build();
      await expect(svc.minha(MORADOR, { id_condominio: 3 }, AGORA)).rejects.toThrow(ForbiddenException);
      expect(tenant.assertCondominio).toHaveBeenCalledWith(3, MORADOR);
    });

    it('id_condominio ausente ou inválido é 400', async () => {
      const { svc } = build();
      await expect(svc.minha(MORADOR, {} as any, AGORA)).rejects.toThrow(BadRequestException);
      await expect(svc.minha(MORADOR, { id_condominio: 'x' as any }, AGORA)).rejects.toThrow(BadRequestException);
    });

    it('o segredo gravado no banco não é o hex devolvido (passou por encryptSecret)', async () => {
      const { svc, creds } = build();
      const r: any = await svc.minha(MORADOR, { id_condominio: 1 }, AGORA);
      expect(creds[0].segredo).not.toBe(r.segredo);
      expect(creds[0].segredo).not.toContain(r.segredo);
      expect(decryptSecret(creds[0].segredo)).toBe(r.segredo);
    });
  });

  describe('link do visitante', () => {
    it('devolve url do passe e reaproveita a credencial numa segunda chamada', async () => {
      const { svc, creds } = build();

      const r1 = await svc.linkVisita(300, MORADOR);
      const r2 = await svc.linkVisita(300, MORADOR);

      expect(r1.url).toMatch(/^https:\/\/exemplo\.test\/#passe=[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
      expect(r2.url).toBe(r1.url);
      expect(r1.valido_ate).toBe('2026-11-16T00:00:00.000Z');
      expect(creds).toHaveLength(1);
      expect(creds[0]).toMatchObject({ tipo_pessoa: 'visita', origem: 'link', id_visita: 300, id_visitante: null, id_pessoa: null, id_condominio: 1 });
    });

    it('com "QR no app" desligado responde 403 e não cria credencial', async () => {
      const { svc, creds } = build({ opcao: false });
      await expect(svc.linkVisita(300, MORADOR)).rejects.toThrow(
        new ForbiddenException('QR no app está desligado neste condomínio'),
      );
      expect(creds).toHaveLength(0);
    });

    it('funcionário do app sem a permissão de cadastrar visitante e sem vínculo com a unidade recebe 403', async () => {
      const { svc, creds, tenant } = build({ permissaoFuncionario: false });
      await expect(svc.linkVisita(300, FUNCIONARIO)).rejects.toThrow(ForbiddenException);
      await expect(svc.invalidarLink(300, FUNCIONARIO)).rejects.toThrow(ForbiddenException);
      expect(creds).toHaveLength(0);
      expect(tenant.assertPermissaoFuncionario).toHaveBeenCalledWith(1, 'cadastrar_visitante', FUNCIONARIO);
    });

    it('funcionário do app com a permissão de cadastrar visitante gera e invalida o link', async () => {
      const { svc, creds } = build({ permissaoFuncionario: true });
      expect((await svc.linkVisita(300, FUNCIONARIO)).url).toContain('#passe=');
      expect(await svc.invalidarLink(300, FUNCIONARIO)).toEqual({ ok: true });
      expect(creds[0].versao_link).toBe(2);
    });

    it('funcionário do app sem a permissão, mas morador dono da visita, gera e invalida o link', async () => {
      const { svc, creds } = build({ permissaoFuncionario: false, vinculosApto: [{ id_user: 8, id_apto: 5 }] });
      expect((await svc.linkVisita(300, FUNCIONARIO)).url).toContain('#passe=');
      expect(await svc.invalidarLink(300, FUNCIONARIO)).toEqual({ ok: true });
      expect(creds).toHaveLength(1);
      expect(creds[0].versao_link).toBe(2);
    });

    it('quem não pode acessar a visita recebe o erro do VisitantesService', async () => {
      const { svc, creds } = build({ acessoVisita: new ForbiddenException('Acesso negado: este visitante não pertence a você.') });
      await expect(svc.linkVisita(300, MORADOR)).rejects.toThrow('Acesso negado: este visitante não pertence a você.');
      await expect(svc.invalidarLink(300, MORADOR)).rejects.toThrow(ForbiddenException);
      expect(creds).toHaveLength(0);
    });

    it('visita com PIN anulado recusa com 400', async () => {
      const { svc } = build();
      const pin = build({ visita: { id: 300, id_condominio: 1, codigo_acesso: null, pessoa: { nome: 'V' } } });
      await expect(pin.svc.linkVisita(300, MORADOR)).rejects.toThrow(new BadRequestException('Esta visita já foi encerrada.'));
      expect(svc).toBeDefined();
    });

    it('invalidar troca o token: o link antigo passa a responder 404', async () => {
      const { svc } = build();
      const antigo = tokenDe((await svc.linkVisita(300, MORADOR)).url);
      expect(await svc.lerPassePublico(antigo, AGORA)).toMatchObject({ nome: 'Vítor' });

      expect(await svc.invalidarLink(300, MORADOR)).toEqual({ ok: true });

      await expect(svc.lerPassePublico(antigo, AGORA)).rejects.toThrow(new NotFoundException('Passe indisponível.'));
      const novo = tokenDe((await svc.linkVisita(300, MORADOR)).url);
      expect(novo).not.toBe(antigo);
      expect(await svc.lerPassePublico(novo, AGORA)).toMatchObject({ nome: 'Vítor' });
    });
  });

  describe('chave do token do link', () => {
    it('é derivada por HMAC com rótulo próprio, separada da chave do encryptSecret', () => {
      const { svc } = build();
      const [, mac] = svc.tokenDoLink({ id: 123, versao_link: 1 }).split('.');

      const chaveCifra = createHash('sha256').update('segredo-de-teste').digest();
      const comChaveDaCifra = createHmac('sha256', chaveCifra).update('passe-link|123|1').digest('base64url');
      expect(mac).not.toBe(comChaveDaCifra);

      const chaveLink = createHmac('sha256', chaveCifra).update('prestare/credenciais/link/v1').digest();
      expect(mac).toBe(createHmac('sha256', chaveLink).update('passe-link|123|1').digest('base64url'));
    });
  });

  describe('passes/publico', () => {
    it('devolve um código que validarLeitura aceita no mesmo instante', async () => {
      const { svc, validacao } = build();
      const token = tokenDe((await svc.linkVisita(300, MORADOR)).url);

      const r = await svc.lerPassePublico(token, AGORA);

      expect(r).toEqual({
        nome: 'Vítor',
        condominio: 'Condomínio 1',
        unidade: 'Apartamento 101 · Bloco A',
        valido_de: '2026-11-14T00:00:00.000Z',
        valido_ate: '2026-11-16T00:00:00.000Z',
        codigo: expect.stringMatching(/^P1[A-Z2-7]{26}$/),
        troca_em_s: 20,
      });
      expect(await validacao.validarLeitura(r.codigo, { id: 42, id_condominio: 1 }, AGORA)).toMatchObject({
        ok: true,
        alvo: { tipo: 'visita', codigoAcesso: '482913' },
      });
    });

    it('troca_em_s fica entre 1 e 30', async () => {
      const { svc } = build();
      const token = tokenDe((await svc.linkVisita(300, MORADOR)).url);
      expect((await svc.lerPassePublico(token, new Date('2026-11-14T12:00:00.000Z'))).troca_em_s).toBe(30);
      expect((await svc.lerPassePublico(token, new Date('2026-11-14T12:00:29.500Z'))).troca_em_s).toBe(1);
    });

    it('token malformado, de outra versão e de credencial revogada respondem o mesmo 404', async () => {
      const { svc, creds, encerrarVisita } = build();
      const token = tokenDe((await svc.linkVisita(300, MORADOR)).url);
      const [idB36, mac] = token.split('.');
      const outraVersao = build();
      const tokenOutro = tokenDe((await outraVersao.svc.linkVisita(300, MORADOR)).url);

      const ruins = ['', 'abc', `${idB36}.`, `${idB36}.${mac.slice(1)}x`, `zzzz.${mac}`, `${idB36}.${mac}.x`, '../../etc'];
      for (const t of ruins) {
        await expect(svc.lerPassePublico(t, AGORA)).rejects.toThrow(new NotFoundException('Passe indisponível.'));
      }

      creds[0].versao_link = 2;
      await expect(svc.lerPassePublico(token, AGORA)).rejects.toThrow(new NotFoundException('Passe indisponível.'));
      creds[0].versao_link = 1;

      creds[0].revogada_em = AGORA;
      await expect(svc.lerPassePublico(token, AGORA)).rejects.toThrow(new NotFoundException('Passe indisponível.'));
      creds[0].revogada_em = null;

      encerrarVisita();
      await expect(svc.lerPassePublico(token, AGORA)).rejects.toThrow(new NotFoundException('Passe indisponível.'));
      expect(tokenOutro).toBe(token); // mesmo id e versão → mesmo token (derivado, não guardado)
    });

    it('opção do condomínio desligada responde o mesmo 404', async () => {
      const { svc, prisma } = build();
      const token = tokenDe((await svc.linkVisita(300, MORADOR)).url);
      await prisma.condominios.update({ where: { id: 1 }, data: { qr_app_habilitado: false } });
      await expect(svc.lerPassePublico(token, AGORA)).rejects.toThrow(new NotFoundException('Passe indisponível.'));
    });

    it('credencial de morador não vira passe público', async () => {
      const { svc } = build();
      const r: any = await svc.minha(MORADOR, { id_condominio: 1 }, AGORA);
      const forjado = svc.tokenDoLink({ id: r.id, versao_link: 1 });
      await expect(svc.lerPassePublico(forjado, AGORA)).rejects.toThrow(new NotFoundException('Passe indisponível.'));
    });

    it('a resposta não contém segredo, PIN, sobrenome nem dado de morador', async () => {
      const { svc, creds } = build();
      const token = tokenDe((await svc.linkVisita(300, MORADOR)).url);

      const texto = JSON.stringify(await svc.lerPassePublico(token, AGORA));

      expect(texto).not.toContain(decryptSecret(creds[0].segredo) as string);
      expect(texto).not.toContain(creds[0].segredo);
      expect(texto).not.toContain('482913');
      expect(texto).not.toMatch(/Souza|Lima/);
      expect(texto).not.toMatch(/Ana|id_pessoa|morador/i);
    });
  });

  describe('opção do condomínio', () => {
    it('PATCH exige síndico; morador recebe 403', async () => {
      const { svc, prisma } = build({ opcao: false });
      await expect(svc.definirOpcao(1, true, MORADOR)).rejects.toThrow(ForbiddenException);
      expect(prisma.condominios.update).not.toHaveBeenCalled();

      expect(await svc.definirOpcao(1, true, SINDICO)).toEqual({ qr_app_habilitado: true });
      expect(prisma.condominios.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { qr_app_habilitado: true },
        select: { qr_app_habilitado: true },
      });
    });

    it('PATCH recusa valor que não é booleano', async () => {
      const { svc } = build();
      await expect(svc.definirOpcao(1, 'sim' as any, SINDICO)).rejects.toThrow(BadRequestException);
    });

    it('GET devolve o valor atual', async () => {
      const { svc, tenant } = build({ opcao: true });
      expect(await svc.lerOpcao(1, MORADOR)).toEqual({ qr_app_habilitado: true });
      expect(tenant.assertCondominio).toHaveBeenCalledWith(1, MORADOR);
    });
  });

  describe('VisitantesService.referenciaParaCredencial', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { VisitantesService } = require('../visitantes/visitantes.service');
    function visitantesReal(vinculo: boolean) {
      const prisma: any = {
        isConnected: true,
        visitas: {
          findUnique: jest.fn(async () => ({
            id: 300, id_condominio: 1, id_apartamento: 5, codigo_acesso: '482913',
            data_hora_inicio: null, data_hora_termino: null, pessoa: { id: 1, nome: 'Vítor Souza' },
          })),
        },
        visitantes: {
          findUnique: jest.fn(async () => ({
            id: 30, id_condominio: 1, id_apartamento: 5, nome: 'Vera Dias', codigo_acesso: null,
            data_hora_inicio: null, data_hora_termino: new Date('2026-11-16T00:00:00.000Z'),
          })),
        },
        apartamentos: { findUnique: jest.fn(async () => ({ bloco: 'A', apto: '101' })) },
        apartamentos_Users: { findFirst: jest.fn(async () => (vinculo ? { id_apto: 5 } : null)) },
      };
      const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
      return { svc: new VisitantesService(prisma, {}, {}, {}, {}, tenant, {}, {}), prisma };
    }

    afterEach(() => { process.env.PESSOAS_MIGRATION_ENABLED = 'true'; });

    it('com a migração ligada lê Visitas e confere o vínculo do morador com o apartamento', async () => {
      const { svc, prisma } = visitantesReal(true);
      expect(await svc.referenciaParaCredencial(300, MORADOR)).toEqual({
        espaco: 'visita', id: 300, id_condominio: 1, nome: 'Vítor Souza', codigo_acesso: '482913',
        id_apartamento: 5, data_hora_inicio: null, data_hora_termino: null, bloco: 'A', apto: '101',
      });
      expect(prisma.visitantes.findUnique).not.toHaveBeenCalled();

      const semVinculo = visitantesReal(false);
      await expect(semVinculo.svc.referenciaParaCredencial(300, MORADOR)).rejects.toThrow(ForbiddenException);
    });

    it('com a migração desligada lê Visitantes', async () => {
      process.env.PESSOAS_MIGRATION_ENABLED = 'false';
      const { svc, prisma } = visitantesReal(true);
      expect(await svc.referenciaParaCredencial(30, MORADOR)).toMatchObject({
        espaco: 'visitante', id: 30, nome: 'Vera Dias', codigo_acesso: null,
      });
      expect(prisma.visitas.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('rotas', () => {
    const meta = (key: string, alvo: any) => Reflect.getMetadata(key, alvo);

    it('leitura pública é POST /passes/publico com o token no corpo, @Public, @SkipAudit, 200 e com limite próprio', () => {
      const handler = PassesPublicosController.prototype.ler;
      expect(meta('path', PassesPublicosController)).toBe('passes');
      expect(meta('method', handler)).toBe(RequestMethod.POST);
      expect(meta('path', handler)).toBe('publico');
      expect(meta('__httpCode__', handler)).toBe(200);
      // Não sobra rota com o token no caminho.
      expect(Object.getOwnPropertyNames(PassesPublicosController.prototype).filter((n) => n !== 'constructor')).toEqual(['ler']);
      expect(meta(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(meta(SKIP_AUDIT_KEY, handler)).toBe(true);
      expect(meta('THROTTLER:LIMITmedium', handler)).toBe(30);
      expect(meta('THROTTLER:TTLmedium', handler)).toBe(60_000);
    });

    it('o controller público lê o token do corpo e devolve a resposta do serviço', async () => {
      const { svc } = build();
      const token = tokenDe((await svc.linkVisita(300, MORADOR)).url);
      const ctrl = new PassesPublicosController(svc);
      expect(await ctrl.ler({ token })).toMatchObject({ nome: 'Vítor', codigo: expect.stringMatching(/^P1/) });
      await expect(ctrl.ler({} as any)).rejects.toThrow(new NotFoundException('Passe indisponível.'));
      await expect(ctrl.ler(undefined as any)).rejects.toThrow(new NotFoundException('Passe indisponível.'));
    });

    it('todo POST do app responde 200', () => {
      for (const nome of ['minha', 'linkVisita', 'invalidarLink'] as const) {
        expect(meta('__httpCode__', (CredenciaisController.prototype as any)[nome])).toBe(200);
      }
    });
  });
});
