import { ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { REVOGADO_PELO_OPERADOR } from '../consentimentos/consentimentos.service';

/**
 * S22 (decisão do dono, 13/11/2026, opção b): o menor cuja biometria o operador revogou
 * (`face_sync_error = 'revogado_pelo_operador'`) não tem login para dar o novo aceite
 * (ConsentimentosService.registrar). Quem desbloqueia é o RESPONSÁVEL, pelo app dele: token de
 * morador, maior de idade, vinculado à mesma unidade do menor e sem ser equipe do condomínio —
 * ao reenviar a foto com o termo, a marca sai das linhas do menor naquele condomínio e o rosto
 * volta no próximo syncMorador. O mesmo termo vindo da equipe (console, síndico, funcionário)
 * não tira a marca: senão a equipe desfaria a própria revogação.
 *
 * Dados fictícios; Prisma em memória.
 */

const TERMO = 'CONSENTIMENTO_BIOMETRIA_ACEITO_EM:2026-11-13T10:00:00.000';
// termo do cadastro original (antes da revogação): a revogação tira a foto, não o extra2
const TERMO_ANTIGO = 'CONSENTIMENTO_BIOMETRIA_ACEITO_EM:2026-09-23T15:00:00.000';
const FOTO = 'data:image/jpeg;base64,AAA';

type Row = Record<string, any>;

/** Casa o `where` (subconjunto usado pelo saveMorador) com uma linha. */
function casa(row: Row, where: Row = {}, aptos: Row[] = []): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'apartamento') {
      const apto = aptos.find((a) => a.id === row.id_apto);
      return !!apto && casa(apto, cond, aptos);
    }
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as any[]).includes(v);
      if ('not' in cond) return v !== cond.not;
    }
    return v === cond;
  });
}

function montar() {
  const aptos: Row[] = [
    { id: 11, id_condominio: 1, bloco: 'A', apto: '101' },
    { id: 12, id_condominio: 1, bloco: 'A', apto: '102' },
    { id: 21, id_condominio: 2, bloco: 'B', apto: '201' },
  ];
  const moradores: Row[] = [
    // menor (Users 900) revogado pelo operador no condomínio 1 — duas linhas aqui, uma no condomínio 2
    { id: 500, id_user: 900, id_condominio: 1, nome: 'Menor QA', tipo: 'membro', data_nascimento: new Date('2015-05-10'), extra2: TERMO_ANTIGO, foto_pessoa: null, face_id: null, face_sync_status: 'revoked', face_sync_error: REVOGADO_PELO_OPERADOR },
    { id: 501, id_user: 900, id_condominio: 1, nome: 'Menor QA', tipo: 'membro', data_nascimento: new Date('2015-05-10'), extra2: TERMO_ANTIGO, foto_pessoa: null, face_id: null, face_sync_status: 'revoked', face_sync_error: REVOGADO_PELO_OPERADOR },
    { id: 502, id_user: 900, id_condominio: 2, nome: 'Menor QA', tipo: 'membro', data_nascimento: new Date('2015-05-10'), extra2: TERMO_ANTIGO, foto_pessoa: null, face_id: null, face_sync_status: 'revoked', face_sync_error: REVOGADO_PELO_OPERADOR },
    // menor (Users 910) sem marca, mesma unidade
    { id: 510, id_user: 910, id_condominio: 1, nome: 'Menor sem marca QA', tipo: 'membro', data_nascimento: new Date('2016-01-01'), extra2: null, foto_pessoa: null, face_id: null, face_sync_status: null, face_sync_error: null },
    // adulto (Users 950) com a marca, mesma unidade
    { id: 550, id_user: 950, id_condominio: 1, nome: 'Adulto QA', tipo: 'membro', data_nascimento: new Date('1990-01-01'), extra2: null, foto_pessoa: null, face_id: null, face_sync_status: 'revoked', face_sync_error: REVOGADO_PELO_OPERADOR },
    // responsável (Users 200), apto 11
    { id: 600, id_user: 200, id_condominio: 1, nome: 'Responsável QA', tipo: 'proprietario', data_nascimento: new Date('1985-03-03'), face_sync_error: null },
    // morador de OUTRA unidade (Users 300), apto 12
    { id: 700, id_user: 300, id_condominio: 1, nome: 'Vizinho QA', tipo: 'proprietario', data_nascimento: new Date('1980-02-02'), face_sync_error: null },
    // síndico do condomínio 1 que também mora no apto 11 (Users 250)
    { id: 650, id_user: 250, id_condominio: 1, nome: 'Síndico morador QA', tipo: 'proprietario', data_nascimento: new Date('1975-07-07'), face_sync_error: null },
    // funcionário do condomínio 1 que também mora no apto 11 (Users 400)
    { id: 660, id_user: 400, id_condominio: 1, nome: 'Funcionário morador QA', tipo: 'inquilino', data_nascimento: new Date('1982-08-08'), face_sync_error: null },
  ];
  const vinculos: Row[] = [
    { id_apto: 11, id_user: 900, tipo: 'membro' },
    { id_apto: 21, id_user: 900, tipo: 'membro' },
    { id_apto: 11, id_user: 910, tipo: 'membro' },
    { id_apto: 11, id_user: 950, tipo: 'membro' },
    { id_apto: 11, id_user: 200, tipo: 'proprietario' },
    { id_apto: 12, id_user: 300, tipo: 'proprietario' },
    { id_apto: 11, id_user: 250, tipo: 'proprietario' },
    { id_apto: 11, id_user: 400, tipo: 'inquilino' },
  ];
  const sindicos: Row[] = [{ id_user: 250, id_condominio: 1 }, { id_user: 100, id_condominio: 1 }];
  const funcionarios: Row[] = [{ id_user: 400, id_condominio: 1 }];
  const consentimentos: Row[] = [];

  const prisma: any = {
    isConnected: true,
    moradores: {
      findUnique: jest.fn(async ({ where }: any) => {
        const m = moradores.find((r) => r.id === where.id);
        return m ? { ...m, user: { id: m.id_user, photo: null, profile_image: null } } : null;
      }),
      findFirst: jest.fn(async ({ where }: any = {}) => moradores.find((r) => casa(r, where)) ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => moradores.filter((r) => casa(r, where)).map((r) => ({ ...r }))),
      count: jest.fn(async ({ where }: any = {}) => moradores.filter((r) => casa(r, where)).length),
      update: jest.fn(async ({ where, data }: any) => {
        const m = moradores.find((r) => r.id === where.id);
        Object.assign(m!, data);
        return { ...m };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const alvo = moradores.filter((r) => casa(r, where));
        alvo.forEach((r) => Object.assign(r, data));
        return { count: alvo.length };
      }),
    },
    apartamentos_Users: {
      findFirst: jest.fn(async ({ where }: any = {}) => vinculos.find((r) => casa(r, where, aptos)) ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => vinculos.filter((r) => casa(r, where, aptos))),
      count: jest.fn(async ({ where }: any = {}) => vinculos.filter((r) => casa(r, where, aptos)).length),
    },
    sindicos_Condominios: { count: jest.fn(async ({ where }: any = {}) => sindicos.filter((r) => casa(r, where)).length) },
    funcionarios: { count: jest.fn(async ({ where }: any = {}) => funcionarios.filter((r) => casa(r, where)).length) },
    users: {
      update: jest.fn(async () => ({})),
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
    },
    consentimentos: {
      create: jest.fn(async ({ data }: any) => {
        consentimentos.push(data);
        return data;
      }),
    },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const storage: any = { isDataUrl: () => true, uploadDataUrl: jest.fn(async () => 'https://s3/moradores/qa.jpg') };
  const tenant: any = {
    assertCondominio: jest.fn(async () => undefined),
    assertEntidade: jest.fn(async () => undefined),
    assertPermissaoFuncionario: jest.fn(async () => undefined),
  };
  const superlogica: any = { enviarMorador: jest.fn(async () => undefined) };
  const svc = new MobileAuthService(
    prisma, { sign: jest.fn(() => 'TOKEN') } as any, {} as any, storage, {} as any,
    tenant, {} as any, {} as any, {} as any, superlogica,
  );
  const linha = (id: number) => moradores.find((r) => r.id === id)!;
  return { svc, prisma, linha, consentimentos };
}

const edicaoMenor = (id: number, over: any = {}) => ({
  morador: { id, nome: 'Menor QA', data_nascimento: '10/05/2015', tipo: 'Membro', email: '', extra1: 'MENOR_DE_IDADE', extra2: TERMO, photo: FOTO, ...over },
});

const tokenMorador = (id: number) => ({ sub: id, typeAccess: 'Morador', user: { id } }) as any;
const responsavel = tokenMorador(200);
const vizinho = tokenMorador(300);
const sindicoMoradorComTokenDeMorador = tokenMorador(250);
const sindicoConsole = { sub: 100, nome: 'Síndico QA', typeAccess: 'Sindico', id_condominio: 1 } as any;
const funcionarioApp = { sub: 400, typeAccess: 'Funcionario', user: { id: 400 } } as any;

describe('S22 — termo do responsável desbloqueia o menor revogado pelo operador', () => {
  describe('(a) responsável (token de morador da mesma unidade) reenvia foto + termo', () => {
    it('limpa a marca das linhas do menor neste condomínio, grava foto/termo e registra o consentimento', async () => {
      const { svc, prisma, linha, consentimentos } = montar();
      await svc.saveMorador(edicaoMenor(500), true, responsavel);

      expect(linha(500).face_sync_error).toBeNull();
      expect(linha(501).face_sync_error).toBeNull();
      // a revogação de outro condomínio não é deste vínculo: segue
      expect(linha(502).face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
      expect(linha(500).foto_pessoa).toBe('https://s3/moradores/qa.jpg');
      expect(linha(500).extra2).toBe(TERMO);
      expect(consentimentos).toEqual([expect.objectContaining({ id_user: 900, tipo: 'biometria', aceito: 1 })]);
      // o responsável não mexe no resto do cadastro nem na conta do menor
      expect(linha(500).tipo).toBe('membro');
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('não devolve token: a sessão é do responsável, não do menor', async () => {
      const { svc } = montar();
      const r: any = await svc.saveMorador(edicaoMenor(500), true, responsavel);
      expect(r?.token).toBeUndefined();
    });

    it('sem o termo no envio, segue a regra atual (edição de outro morador exige equipe)', async () => {
      const { svc, linha } = montar();
      await expect(svc.saveMorador(edicaoMenor(500, { extra2: '' }), true, responsavel)).rejects.toBeInstanceOf(ForbiddenException);
      expect(linha(500).face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
    });

    it('sem foto no envio, segue a regra atual', async () => {
      const { svc, linha } = montar();
      await expect(svc.saveMorador(edicaoMenor(500, { photo: undefined }), true, responsavel)).rejects.toBeInstanceOf(ForbiddenException);
      expect(linha(500).face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
    });
  });

  describe('(b)/(c) o mesmo termo vindo da equipe não tira a marca', () => {
    it('(b) síndico no console: grava foto/termo, a marca permanece', async () => {
      const { svc, linha, consentimentos } = montar();
      await svc.saveMorador(edicaoMenor(500), true, sindicoConsole);
      expect(linha(500).foto_pessoa).toBe('https://s3/moradores/qa.jpg');
      expect(consentimentos).toHaveLength(1);
      expect(linha(500).face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
      expect(linha(501).face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
    });

    it('(c) funcionário do app (mesmo morando na unidade do menor): a marca permanece', async () => {
      const { svc, linha } = montar();
      await svc.saveMorador(edicaoMenor(500), true, funcionarioApp);
      expect(linha(500).foto_pessoa).toBe('https://s3/moradores/qa.jpg');
      expect(linha(500).face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
      expect(linha(501).face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
    });

    it('síndico do condomínio que mora na unidade, agindo com token de morador: lado fechado (recusado, a marca permanece)', async () => {
      const { svc, linha, consentimentos } = montar();
      await expect(svc.saveMorador(edicaoMenor(500), true, sindicoMoradorComTokenDeMorador)).rejects.toBeInstanceOf(ForbiddenException);
      expect(consentimentos).toHaveLength(0);
      expect(linha(500).face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
    });
  });

  describe('(d) morador de OUTRA unidade', () => {
    it('continua recusado como hoje e a marca permanece', async () => {
      const { svc, prisma, linha, consentimentos } = montar();
      await expect(svc.saveMorador(edicaoMenor(500), true, vizinho)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.moradores.update).not.toHaveBeenCalled();
      expect(consentimentos).toHaveLength(0);
      expect(linha(500).face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
    });
  });

  describe('(e) comportamento atual inalterado', () => {
    it('menor SEM a marca: responsável continua sem editar (regra atual)', async () => {
      const { svc, prisma } = montar();
      await expect(svc.saveMorador(edicaoMenor(510), true, responsavel)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.moradores.update).not.toHaveBeenCalled();
    });

    it('menor SEM a marca: síndico grava foto e termo como hoje, sem mexer em face_sync_error', async () => {
      const { svc, prisma, linha, consentimentos } = montar();
      await svc.saveMorador(edicaoMenor(510), true, sindicoConsole);
      expect(linha(510).foto_pessoa).toBe('https://s3/moradores/qa.jpg');
      expect(consentimentos).toEqual([expect.objectContaining({ id_user: 910, aceito: 1 })]);
      expect(prisma.moradores.updateMany).not.toHaveBeenCalled();
    });

    it('adulto com a marca: o responsável não edita (regra atual) e a marca permanece', async () => {
      const { svc, linha } = montar();
      const adulto = { morador: { id: 550, nome: 'Adulto QA', data_nascimento: '01/01/1990', extra2: TERMO, photo: FOTO } };
      await expect(svc.saveMorador(adulto, true, responsavel)).rejects.toBeInstanceOf(ForbiddenException);
      expect(linha(550).face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
    });

    it('adulto com a marca: a equipe edita a foto, sem termo de menor, e a marca permanece', async () => {
      const { svc, linha, consentimentos } = montar();
      const adulto = { morador: { id: 550, nome: 'Adulto QA', data_nascimento: '01/01/1990', photo: FOTO } };
      await svc.saveMorador(adulto, true, sindicoConsole);
      expect(consentimentos).toHaveLength(0);
      expect(linha(550).face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
    });
  });
});

describe('S22 — o syncMorador volta a matricular o menor desbloqueado pelo responsável', () => {
  // O setup de testes desliga a integração (FACIAL_INTEGRATION_ENABLED=false, lido ao carregar o
  // módulo): carrega uma cópia isolada com ela ligada (mesmo padrão de morador-menor-biometria.spec).
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

  function facialCom(linha: Row, consentimentos: Row[]) {
    const svc = Object.create(FacialService.prototype);
    Object.assign(svc, {
      prisma: {
        isConnected: true,
        moradores: { findUnique: jest.fn(async () => ({ ...linha })), update: jest.fn() },
        // sem terminal: o retorno 'no_facial_devices' prova que a pessoa passou por todos os gates
        facial_Devices: { findMany: jest.fn(async () => []) },
      },
      consentimentos: {
        autorizouBiometria: jest.fn(async (idUser: number) => {
          const ult = [...consentimentos].reverse().find((c) => c.id_user === idUser && c.tipo === 'biometria');
          return ult?.aceito === 1;
        }),
      },
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    return svc;
  }

  it('antes: bloqueado pela marca; depois do termo do responsável: passa os gates', async () => {
    const { svc, linha, consentimentos } = montar();
    const antes = await facialCom(linha(500), consentimentos).syncMorador(500);
    expect(antes.reason).toBe('revogado_pelo_operador');

    await svc.saveMorador(edicaoMenor(500), true, responsavel);

    const depois = await facialCom(linha(500), consentimentos).syncMorador(500);
    expect(depois.reason).toBe('no_facial_devices');
  });

  it('termo pela equipe: o syncMorador segue bloqueado', async () => {
    const { svc, linha, consentimentos } = montar();
    await svc.saveMorador(edicaoMenor(500), true, sindicoConsole);
    const r = await facialCom(linha(500), consentimentos).syncMorador(500);
    expect(r.reason).toBe('revogado_pelo_operador');
  });
});
