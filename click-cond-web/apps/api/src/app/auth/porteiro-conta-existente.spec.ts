import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';
import { TenantAccessService } from './tenant-access.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Users é global e o login do porteiro é livre. Um síndico (inclusive de
 * signup anônimo + /condominio/register) cadastrava um porteiro com o e-mail
 * de outra pessoa, e o loginFuncionario adotava a senha do porteiro como senha
 * da conta dela. O "vínculo neste condomínio" que liberava o cadastro podia ser
 * fabricado antes pelo /moradores/insert (liga conta existente por e-mail/CPF).
 */
type Vinculo = { id_user: number; id_condominio: number };

export function prismaFalso(opts: {
  usuarioPorLogin?: Record<string, any>;
  sindicos?: Vinculo[];
  funcionarios?: Vinculo[];
  moradores?: Vinculo[];
  unidades?: Vinculo[];
  perfisSindico?: number[];
  funcionariosRows?: any[];
  portaria?: any;
  prestadores?: Array<{ id: number; email: string; id_condominio: number }>;
}) {
  // Respeita `id_condominio: n`, `{ not: n }` e ausência de filtro, como o Prisma.
  const casa = (v: Vinculo, where: any) =>
    v.id_user === where.id_user &&
    (where.id_condominio === undefined ||
      (typeof where.id_condominio === 'object'
        ? v.id_condominio !== where.id_condominio.not
        : v.id_condominio === where.id_condominio));
  const contar = (lista: Vinculo[] = []) =>
    jest.fn(async ({ where }: any) => lista.filter((v) => casa(v, where)).length);

  return {
    isConnected: true,
    users: {
      findFirst: jest.fn(async ({ where }: any) => {
        const login = where?.login ?? where?.OR?.[0]?.login;
        return opts.usuarioPorLogin?.[login] ?? null;
      }),
      create: jest.fn(async ({ data }: any) => ({ id: 999, photo: null, ...data, funcionarios: [] })),
      update: jest.fn(async () => ({})),
    },
    sindicos: {
      count: jest.fn(async ({ where }: any) => (opts.perfisSindico ?? []).filter((id) => id === where.id_user).length),
    },
    sindicos_Condominios: {
      count: contar(opts.sindicos),
      findFirst: jest.fn(async ({ where }: any) => ((opts.sindicos ?? []).some((v) => casa(v, where)) ? { id: 1 } : null)),
    },
    funcionarios: {
      count: contar(opts.funcionarios),
      findFirst: jest.fn(async ({ where }: any) => (opts.funcionariosRows ?? []).find((f) => casa(f, where)) ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
      update: jest.fn(async () => ({})),
    },
    moradores: { count: contar(opts.moradores) },
    apartamentos_Users: {
      count: jest.fn(async ({ where }: any) =>
        (opts.unidades ?? []).filter((v) =>
          casa(v, { id_user: where.id_user, id_condominio: where.apartamento?.id_condominio }),
        ).length,
      ),
    },
    funcionarios_Portaria: {
      findUnique: jest.fn(async ({ where }: any) =>
        opts.portaria && (where.id === opts.portaria.id || where.login === opts.portaria.login) ? opts.portaria : null,
      ),
      findFirst: jest.fn(async () => opts.portaria ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 70, ...data })),
      update: jest.fn(async ({ data }: any) => ({ ...opts.portaria, ...data })),
    },
    prestadores_servico: {
      findFirst: jest.fn(async ({ where }: any) =>
        (opts.prestadores ?? []).find((p) => p.email === where.email && p.id_condominio === where.id_condominio) ?? null,
      ),
    },
  } as any;
}

export function servico(prisma: any) {
  const jwt: any = { sign: jest.fn(() => 'token-assinado') };
  const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
  const svc = new MobileAuthService(prisma, jwt, {} as any, storage, {} as any, new TenantAccessService(prisma));
  return { svc, jwt };
}

const atacante: JwtPayload = { sub: 20, nome: 'Síndico B', typeAccess: 'Sindico' };

describe('saveFuncionario — conta existente com o mesmo e-mail', () => {
  it('NEGA porteiro com o e-mail de quem tem vínculo em outro condomínio, mesmo com vínculo fabricado aqui', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'x@t': { id: 10, login: 'x@t', email: 'x@t', password: '$2b$04$hash' } },
      // X é síndico do condomínio 1; o atacante (20) é síndico do 2 e ligou X como morador do 2.
      sindicos: [{ id_user: 10, id_condominio: 1 }, { id_user: 20, id_condominio: 2 }],
      moradores: [{ id_user: 10, id_condominio: 2 }],
    });
    const { svc } = servico(prisma);

    await expect(
      svc.saveFuncionario({ id_condominio: 2, funcionario: { nome: 'P', email: 'x@t', senha: 'escolhida' } }, false, atacante),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
  });

  it('PERMITE o próprio síndico (de mais de um condomínio) cadastrar o login de portaria dele', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 's@t': { id: 20, login: 's@t', email: 's@t', password: '$2b$04$hash' } },
      sindicos: [{ id_user: 20, id_condominio: 2 }, { id_user: 20, id_condominio: 3 }],
    });
    const { svc } = servico(prisma);

    await svc.saveFuncionario({ id_condominio: 2, funcionario: { nome: 'Eu', email: 's@t', senha: 'x' } }, false, atacante);
    expect(prisma.funcionarios_Portaria.create).toHaveBeenCalled();
  });

  // Lote 3: a conta (equipe de OUTRO condomínio, sem vínculo de equipe aqui) também não é mais ligada a este
  // em silêncio — a edição passa pela mesma prova de posse do cadastro e é recusada.
  it('sincronização não move para este condomínio o vínculo de equipe que a pessoa tem em outro (nem cria um aqui)', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'p@t': { id: 30, login: 'p@t', email: 'p@t', password: '$2b$04$hash' } },
      sindicos: [{ id_user: 20, id_condominio: 2 }],
      funcionarios: [{ id_user: 30, id_condominio: 1 }],
      funcionariosRows: [{ id: 77, id_user: 30, id_condominio: 1 }],
      portaria: { id: 50, login: 'p@t', email: 'p@t', password: '$2b$04$hash', nome: 'P', telefone: null, turno: null, id_condominio: 2 },
    });
    const { svc } = servico(prisma);

    await expect(
      svc.saveFuncionario({ id_condominio: 2, funcionario: { id: 50, nome: 'Novo Nome' } }, true, atacante),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.funcionarios.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 77 } }));
    expect(prisma.funcionarios.create).not.toHaveBeenCalled();
  });
});

// PrestadoresService trata a linha de portaria com login = e-mail do prestador, mesmo condomínio e turno 'Geral'
// como o login DO prestador: um funcionário com esse login seria re-credenciado/apagado pelo cadastro dele.
describe('saveFuncionario — login igual ao e-mail de um prestador do condomínio', () => {
  const prestadores = [{ id: 3, email: 'eletricista@x.com', id_condominio: 2 }];

  it('cadastro com o e-mail de um prestador deste condomínio → 400 neutro e nada é criado', async () => {
    const prisma = prismaFalso({ sindicos: [{ id_user: 20, id_condominio: 2 }], prestadores });
    const { svc } = servico(prisma);

    await expect(
      svc.saveFuncionario({ id_condominio: 2, funcionario: { nome: 'P', email: ' eletricista@x.com ', senha: 'Escolhida#1' } }, false, atacante),
    ).rejects.toThrow('Já existe um funcionário com este e-mail.');
    expect(prisma.prestadores_servico.findFirst).toHaveBeenCalledWith({
      where: { email: 'eletricista@x.com', id_condominio: 2 },
      select: { id: true },
    });
    expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
    expect(prisma.users.create).not.toHaveBeenCalled();
  });

  it('cadastro com o e-mail de prestador de OUTRO condomínio continua permitido', async () => {
    const prisma = prismaFalso({ sindicos: [{ id_user: 20, id_condominio: 2 }], prestadores: [{ id: 4, email: 'p@x.com', id_condominio: 1 }] });
    const { svc } = servico(prisma);

    await svc.saveFuncionario({ id_condominio: 2, funcionario: { nome: 'P', email: 'p@x.com', senha: 'Escolhida#1' } }, false, atacante);
    expect(prisma.funcionarios_Portaria.create).toHaveBeenCalled();
  });

  it('edição que troca o login para o e-mail de um prestador deste condomínio → 400 neutro e nada é gravado', async () => {
    const prisma = prismaFalso({
      sindicos: [{ id_user: 20, id_condominio: 2 }],
      prestadores,
      portaria: { id: 50, login: 'p@t', email: 'p@t', password: '$2b$04$hash', nome: 'P', telefone: null, turno: 'Diurno', id_condominio: 2 },
    });
    // Nenhum outro login de portaria com o e-mail pedido.
    prisma.funcionarios_Portaria.findFirst = jest.fn(async () => null);
    const { svc } = servico(prisma);

    await expect(
      svc.saveFuncionario({ id_condominio: 2, funcionario: { id: 50, email: 'eletricista@x.com' } }, true, atacante),
    ).rejects.toThrow('Já existe outro funcionário com este e-mail.');
    expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
  });

  it('edição sem troca de login não consulta prestadores', async () => {
    const prisma = prismaFalso({
      sindicos: [{ id_user: 20, id_condominio: 2 }],
      prestadores: [{ id: 5, email: 'p@t', id_condominio: 2 }],
      portaria: { id: 50, login: 'p@t', email: 'p@t', password: '$2b$04$hash', nome: 'P', telefone: null, turno: 'Diurno', id_condominio: 2 },
    });
    const { svc } = servico(prisma);

    await svc.saveFuncionario({ id_condominio: 2, funcionario: { id: 50, nome: 'Novo Nome', email: 'p@t' } }, true, atacante);
    expect(prisma.prestadores_servico.findFirst).not.toHaveBeenCalled();
    expect(prisma.funcionarios_Portaria.update).toHaveBeenCalled();
  });
});

describe('loginFuncionario — senha da portaria x conta existente', () => {
  let hV: string;
  let hA: string;
  beforeAll(async () => {
    hV = await bcrypt.hash('v', 4); // senha do dono da conta
    hA = await bcrypt.hash('a', 4); // senha escolhida por quem cadastrou o porteiro
  });
  const portaria = () => ({ id: 7, login: 'v@t', email: 'v@t', password: hA, id_condominio: 2, nome: 'P', telefone: null, turno: null });

  it('fallback: conta com perfil de síndico NÃO entra com a senha do porteiro e a senha dela não é trocada', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: hV, photo: null, funcionarios: [{ id_condominio: 2, nome: 'P' }] } },
      perfisSindico: [50],
      funcionarios: [{ id_user: 50, id_condominio: 2 }],
      portaria: portaria(),
    });
    const { svc, jwt } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('1º ramo: conta existente com senha própria e sem vínculo NÃO entra com a senha do porteiro', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: hV, photo: null, funcionarios: [] } },
      portaria: portaria(),
    });
    const { svc, jwt } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('1º ramo: o síndico deste condomínio entra com a PRÓPRIA senha', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: hV, photo: null, funcionarios: [] } },
      sindicos: [{ id_user: 50, id_condominio: 2 }],
      portaria: portaria(),
    });
    const { svc } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'v')).resolves.toMatchObject({ token: 'token-assinado' });
  });

  // R12: vínculo só de morador não prova ser o porteiro — antes, a conta de morador cujo login coincidia com
  // um login de portaria virava funcionário (todas as flags) com a própria senha.
  it('1º ramo: vínculo só de morador NÃO dispensa a senha da portaria nem cria linha de equipe', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: hV, photo: null, funcionarios: [] } },
      moradores: [{ id_user: 50, id_condominio: 2 }],
      unidades: [{ id_user: 50, id_condominio: 2 }],
      portaria: portaria(),
    });
    const { svc, jwt } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'v')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.funcionarios.create).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('1º ramo: morador deste condomínio entra quando a senha confere TAMBÉM com a da portaria', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: hA, photo: null, funcionarios: [] } },
      moradores: [{ id_user: 50, id_condominio: 2 }],
      portaria: portaria(),
    });
    const { svc } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'a')).resolves.toMatchObject({ token: 'token-assinado' });
  });

  // Pentest 04/11: o /sindico/signup é público e não verifica o e-mail. Quem cria uma conta com o
  // e-mail de um porteiro já cadastrado não pode, com a senha que ele mesmo escolheu, virar funcionário
  // do condomínio desse porteiro.
  it('1º ramo: conta sem vínculo com o condomínio (signup com e-mail alheio) NÃO adota o porteiro com a própria senha', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: hV, photo: null, funcionarios: [] } },
      perfisSindico: [50],
      portaria: portaria(),
    });
    const { svc, jwt } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'v')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.funcionarios.create).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('1º ramo: conta sem vínculo entra quando a senha confere TAMBÉM com a da portaria', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: hA, photo: null, funcionarios: [] } },
      portaria: portaria(),
    });
    const { svc } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'a')).resolves.toMatchObject({ token: 'token-assinado' });
  });

  it('conta que é só da equipe deste condomínio: a senha redefinida no cadastro do porteiro continua valendo', async () => {
    const hNova = await bcrypt.hash('nova', 4);
    const prisma = prismaFalso({
      usuarioPorLogin: { 'p@t': { id: 60, login: 'p@t', email: 'p@t', password: hV, photo: null, funcionarios: [{ id_condominio: 2, nome: 'P' }] } },
      funcionarios: [{ id_user: 60, id_condominio: 2 }],
      portaria: { id: 8, login: 'p@t', email: 'p@t', password: hNova, id_condominio: 2, nome: 'P', telefone: null, turno: null },
    });
    const { svc } = servico(prisma);

    await expect(svc.loginFuncionario('p@t', 'nova')).resolves.toMatchObject({ token: 'token-assinado' });
    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 60 },
      data: { password: hNova, senha_alterada_em: expect.any(Date) },
    });
  });
});

describe('saveFuncionario — conta existente sem vínculo nenhum', () => {
  it('NEGA porteiro com o e-mail de uma conta que não tem vínculo com condomínio algum', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: '$2b$04$hash' } },
      perfisSindico: [50],
      sindicos: [{ id_user: 20, id_condominio: 2 }],
    });
    const { svc } = servico(prisma);

    await expect(
      svc.saveFuncionario({ id_condominio: 2, funcionario: { nome: 'P', email: 'v@t', senha: 'a' } }, false, atacante),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
  });
});

describe('loginFuncionario — conta existente SEM senha (1º ramo)', () => {
  let hA: string;
  beforeAll(async () => {
    hA = await bcrypt.hash('a', 4); // senha escolhida por quem cadastrou o porteiro
  });
  const portaria = () => ({ id: 7, login: 'v@t', email: 'v@t', password: hA, id_condominio: 2, nome: 'P', telefone: null, turno: null });

  it('NEGA a senha do porteiro para conta sem senha que é moradora deste condomínio (e de outro)', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: null, photo: null, funcionarios: [] } },
      moradores: [{ id_user: 50, id_condominio: 2 }, { id_user: 50, id_condominio: 1 }],
      portaria: portaria(),
    });
    const { svc, jwt } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('NEGA a senha do porteiro para conta sem senha com perfil de síndico', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: null, photo: null, funcionarios: [] } },
      perfisSindico: [50],
      portaria: portaria(),
    });
    const { svc, jwt } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('PERMITE conta sem senha e sem vínculo nenhum (adota a senha do porteiro)', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: null, photo: null, funcionarios: [] } },
      portaria: portaria(),
    });
    const { svc } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'a')).resolves.toMatchObject({ token: 'token-assinado' });
    expect(prisma.users.update).toHaveBeenCalledWith({ where: { id: 50 }, data: { is_funcionario: 1, password: hA } });
  });
});
