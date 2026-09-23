import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { validarBiometria } from '../common/idade.util';

/**
 * Decisão do produto (23/09): menor de 18 anos pode ter foto e reconhecimento
 * facial quando o RESPONSÁVEL aceita o termo de consentimento no app (LGPD
 * Art. 14). O app gravava o aceite em `extra2`
 * ("CONSENTIMENTO_BIOMETRIA_ACEITO_EM:<data>"), mas a API recusava foto de
 * menor em qualquer caso — a foto nunca salvava. Conta/login de menor segue
 * proibida.
 *
 * E a edição devolvia um token de 365 dias DO MORADOR EDITADO: o síndico que
 * editava o cadastro de alguém recebia a sessão dessa pessoa.
 */
describe('Morador menor — biometria com termo do responsável', () => {
  const tzOriginal = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'UTC'; });
  afterAll(() => { process.env.TZ = tzOriginal; });

  const TERMO = 'CONSENTIMENTO_BIOMETRIA_ACEITO_EM:2026-09-23T15:00:00.000';
  const dnMenor = '23/09/2024';
  const dnAdulto = '01/01/1990';

  describe('validarBiometria', () => {
    it('menor com termo do responsável: permitido', () => {
      expect(() => validarBiometria(dnMenor, true)).not.toThrow();
    });
    it('menor sem termo: recusado', () => {
      expect(() => validarBiometria(dnMenor, false)).toThrow(BadRequestException);
    });
    it('sem data de nascimento: recusado', () => {
      expect(() => validarBiometria(null, true)).toThrow(BadRequestException);
    });
    it('adulto: permitido', () => {
      expect(() => validarBiometria(dnAdulto, false)).not.toThrow();
    });
  });

  const sindico = { sub: 1, nome: 'QA síndico', typeAccess: 'Sindico' } as any;

  function montar(extra: any = {}) {
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async () => ({ id: 11, id_condominio: 1, bloco: 'Bloco B', apto: '101' })) },
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
        findUnique: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
      },
      users: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 900, ...data })),
        update: jest.fn(async () => ({})),
        findUnique: jest.fn(async () => null),
      },
      apartamentos_Users: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})) },
      consentimentos: { create: jest.fn(async () => ({})) },
      ...extra,
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const storage: any = { isDataUrl: () => true, uploadDataUrl: jest.fn(async () => 'https://s3/qa.jpg') };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    const superlogica: any = { enviarMorador: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, { sign: jest.fn(() => 'TOKEN') } as any, {} as any, storage, {} as any, tenant, {} as any, {} as any, {} as any, superlogica);
    return { svc, prisma };
  }

  const menor = (over: any = {}) => ({
    morador: {
      nome: 'QA_SECURITY_20260923 menor', documento: '35572974455', data_nascimento: dnMenor,
      tipo: 'Inquilino', id_apto: 11, email: '', sendCredentials: false,
      extra1: 'MENOR_DE_IDADE', extra2: TERMO, photo: 'data:image/jpeg;base64,AAA', ...over,
    },
  });

  it('cadastro de menor com termo salva a foto, o termo e registra o consentimento do menor', async () => {
    const { svc, prisma } = montar();
    await svc.saveMorador(menor(), false, sindico);
    const data = prisma.moradores.create.mock.calls[0][0].data;
    expect(data.foto_pessoa).toBe('https://s3/qa.jpg');
    expect(data.extra2).toBe(TERMO);
    expect(prisma.users.create.mock.calls[0][0].data.login).toBeUndefined();
    expect(prisma.consentimentos.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id_user: 900, tipo: 'biometria', aceito: 1 }),
    });
  });

  it('cadastro de menor com foto e SEM termo é recusado', async () => {
    const { svc, prisma } = montar();
    await expect(svc.saveMorador(menor({ extra2: '' }), false, sindico)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.moradores.create).not.toHaveBeenCalled();
  });

  it('menor continua sem conta: e-mail (do responsável, no app antigo) é ignorado, sem login', async () => {
    const { svc, prisma } = montar();
    await svc.saveMorador(menor({ email: 'resp@qa.com' }), false, sindico);
    expect(prisma.users.create.mock.calls[0][0].data.login).toBeUndefined();
    expect(prisma.users.create.mock.calls[0][0].data.email).toBeUndefined();
    expect(prisma.moradores.create.mock.calls[0][0].data.email).toBeNull();
  });

  it('edição de menor ignora e-mail em vez de recusar o cadastro', async () => {
    const atual = { id: 500, id_user: 900, id_condominio: 1, email: null, data_nascimento: new Date('2024-09-23'), extra2: null, user: {} };
    const { svc, prisma } = montar({
      moradores: { findUnique: jest.fn(async () => atual), update: jest.fn(async () => ({})) },
    });
    await svc.saveMorador(menor({ id: 500, email: 'resp@qa.com' }), true, sindico);
    expect(prisma.moradores.update.mock.calls[0][0].data.email).toBeUndefined();
  });

  it('edição de menor com termo salva a foto', async () => {
    const atual = { id: 500, id_user: 900, id_condominio: 1, email: null, data_nascimento: new Date('2024-09-23'), extra2: null, user: {} };
    const { svc, prisma } = montar({
      moradores: {
        findUnique: jest.fn(async () => atual),
        update: jest.fn(async () => ({})),
      },
    });
    await svc.saveMorador(menor({ id: 500 }), true, sindico);
    const data = prisma.moradores.update.mock.calls[0][0].data;
    expect(data.foto_pessoa).toBe('https://s3/qa.jpg');
    expect(data.extra2).toBe(TERMO);
  });

  it('síndico editando outro morador NÃO recebe token da pessoa editada', async () => {
    const atual = { id: 500, id_user: 900, id_condominio: 1, email: null, data_nascimento: new Date('1990-01-01'), extra2: null, user: {} };
    const { svc } = montar({
      moradores: { findUnique: jest.fn(async () => atual), update: jest.fn(async () => ({})) },
      users: {
        update: jest.fn(async () => ({})),
        findUnique: jest.fn(async () => ({ id: 900, photo: null, moradores: [{ nome: 'Outro' }] })),
      },
    });
    const r: any = await svc.saveMorador({ morador: { id: 500, nome: 'Outro' } }, true, sindico);
    expect(r?.token).toBeUndefined();
  });
});

describe('Facial — menor com termo do responsável', () => {
  // O setup de testes desliga a integração (FACIAL_INTEGRATION_ENABLED=false,
  // lido ao carregar o módulo): carrega uma cópia isolada com ela ligada.
  let FacialService: any;
  beforeAll(() => {
    const antes = process.env['FACIAL_INTEGRATION_ENABLED'];
    process.env['FACIAL_INTEGRATION_ENABLED'] = 'true';
    jest.isolateModules(() => {
      FacialService = jest.requireActual('../facial/facial.service').FacialService;
    });
    if (antes === undefined) delete process.env['FACIAL_INTEGRATION_ENABLED'];
    else process.env['FACIAL_INTEGRATION_ENABLED'] = antes;
  });

  function montar(morador: any) {
    const svc = Object.create(FacialService.prototype);
    Object.assign(svc, {
      prisma: { isConnected: true, moradores: { findUnique: jest.fn(async () => morador), update: jest.fn() } },
      consentimentos: { autorizouBiometria: jest.fn(async () => false) },
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    return svc;
  }

  const menor = { id: 500, id_user: 900, id_condominio: 1, data_nascimento: new Date('2024-09-23'), face_id: null, foto_pessoa: 'x' };

  it('sem termo: não passa da checagem de idade', async () => {
    const r = await montar({ ...menor, extra2: null }).syncMorador(500);
    expect(r.reason).toBe('menor_de_idade_ou_sem_comprovacao');
  });

  it('com termo: passa a idade e segue para a checagem de consentimento', async () => {
    const r = await montar({ ...menor, extra2: 'CONSENTIMENTO_BIOMETRIA_ACEITO_EM:2026-09-23' }).syncMorador(500);
    expect(r.reason).toBe('sem_consentimento_biometria');
  });
});
