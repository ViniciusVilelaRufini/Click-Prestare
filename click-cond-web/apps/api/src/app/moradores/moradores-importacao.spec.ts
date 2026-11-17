import { ForbiddenException } from '@nestjs/common';
import { MoradoresService } from './moradores.service';
import { MoradoresController } from './moradores.controller';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Rodada 4 — importação de moradores (Excel):
 * - item 3: unidade que não existe só é criada por quem gerencia unidades (síndico, ou funcionário
 *   com a permissão "apartamentos"); para o porteiro a linha é recusada com o motivo.
 * - item 1c: coluna de data de nascimento (DD/MM/AAAA ou AAAA-MM-DD); a linha sem data continua
 *   importando, só não recebe o acesso ao app.
 */
function prismaBase(opts: { unidades?: any[]; contaComEmail?: any } = {}) {
  const unidades = opts.unidades ?? [{ id: 55, id_condominio: 1, bloco: 'A', apto: '101' }];
  const prisma: any = {
    isConnected: true,
    moradores: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 300, ...data })),
      count: jest.fn(async () => 0),
    },
    visitantes: { findFirst: jest.fn(async () => null) },
    users: {
      findFirst: jest.fn(async () => opts.contaComEmail ?? null),
      create: jest.fn(async () => ({ id: 50 })),
      update: jest.fn(async () => ({})),
    },
    funcionarios_Portaria: { count: jest.fn(async () => 0) },
    apartamentos: {
      findFirst: jest.fn(async ({ where }: any) => unidades.find((u) => u.bloco === where.bloco && u.apto === where.apto) ?? null),
      findMany: jest.fn(async () => unidades.map((u) => ({ ...u }))),
      findUnique: jest.fn(async ({ where }: any) => unidades.find((u) => u.id === where.id) ?? { id: where.id, id_condominio: 1, bloco: 'B', apto: '202' }),
      create: jest.fn(async ({ data }: any) => ({ id: 99, ...data })),
    },
    apartamentos_Users: { create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
    sindicos_Condominios: { count: jest.fn(async () => 0) },
    funcionarios: { count: jest.fn(async () => 0) },
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));
  return prisma;
}

function servico(prisma: any) {
  const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
  const svc = new MoradoresService(
    prisma, mail, { isDataUrl: () => false, uploadDataUrl: jest.fn() } as any, {} as any,
    { registrar: jest.fn(async () => ({})) } as any, { enviarMorador: jest.fn(async () => ({ enviado: false })) } as any,
  );
  jest.spyOn(svc as any, 'carregarContextoMorador').mockResolvedValue(null);
  jest.spyOn(svc, 'findOne').mockImplementation(async (id: number) => ({ id }) as any);
  return { svc, mail };
}

const linha = (extra: any = {}) => ({ nome: 'Ana', bloco: 'B', apartamento: '202', data_nascimento: '15/05/1985', ...extra });

describe('MoradoresService.importBulk — unidade que não existe', () => {
  it('quem não gerencia unidades (porteiro): a linha é recusada com o motivo e nada é criado', async () => {
    const prisma = prismaBase();
    const { svc } = servico(prisma);

    const r = await svc.importBulk(1, [linha()], { podeCriarUnidade: false });

    expect(r.total).toBe(0);
    expect(r.erros).toEqual([{ nome: 'Ana', erro: 'Unidade não cadastrada — peça ao síndico para cadastrá-la.' }]);
    expect(prisma.apartamentos.create).not.toHaveBeenCalled();
    expect(prisma.moradores.create).not.toHaveBeenCalled();
  });

  it('sem a opção (chamador antigo) também não cria unidade', async () => {
    const prisma = prismaBase();
    const { svc } = servico(prisma);
    const r = await svc.importBulk(1, [linha()]);
    expect(r.total).toBe(0);
    expect(prisma.apartamentos.create).not.toHaveBeenCalled();
  });

  it('quem gerencia unidades (síndico): cria a unidade e importa', async () => {
    const prisma = prismaBase();
    const { svc } = servico(prisma);

    const r = await svc.importBulk(1, [linha()], { podeCriarUnidade: true });

    expect(r.total).toBe(1);
    expect(prisma.apartamentos.create).toHaveBeenCalledWith({ data: { id_condominio: 1, bloco: 'B', apto: '202' } });
  });

  it('unidade existente escrita de outro jeito ("Bloco A" x "A"): o porteiro importa nela', async () => {
    const prisma = prismaBase();
    const { svc } = servico(prisma);

    const r = await svc.importBulk(1, [linha({ bloco: 'Bloco A', apartamento: '101' })], { podeCriarUnidade: false });

    expect(r.erros).toEqual([]);
    expect(r.total).toBe(1);
    expect(prisma.apartamentos_Users.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id_apto: 55 }) }));
  });

  it('"Quadra A"/"Lote 12" da planilha casa com a unidade A/12', async () => {
    const prisma = prismaBase({ unidades: [{ id: 56, id_condominio: 1, bloco: 'A', apto: '12' }] });
    const { svc } = servico(prisma);

    const r = await svc.importBulk(1, [linha({ bloco: 'Quadra A', apartamento: 'Lote 12' })], { podeCriarUnidade: false });

    expect(r.erros).toEqual([]);
    expect(r.total).toBe(1);
    expect(prisma.apartamentos.create).not.toHaveBeenCalled();
    expect(prisma.apartamentos_Users.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id_apto: 56 }) }));
  });
});

describe('MoradoresService.importBulk — bloco da planilha (revisão, item 8)', () => {
  it('bloco escrito só "Bloco" não casa com a unidade sem bloco: a linha é recusada com o motivo', async () => {
    const prisma = prismaBase({ unidades: [{ id: 60, id_condominio: 1, bloco: null, apto: '101' }] });
    const { svc } = servico(prisma);
    const r = await svc.importBulk(1, [linha({ bloco: 'Bloco', apartamento: '101' })], { podeCriarUnidade: true });
    expect(r.total).toBe(0);
    expect(r.erros).toEqual([{ nome: 'Ana', erro: 'Bloco "Bloco" inválido: informe o bloco (ex.: A) ou deixe a coluna vazia.' }]);
    expect(prisma.apartamentos.create).not.toHaveBeenCalled();
    expect(prisma.moradores.create).not.toHaveBeenCalled();
  });

  it('"A" na planilha não casa com a unidade "AA"', async () => {
    const prisma = prismaBase({ unidades: [{ id: 61, id_condominio: 1, bloco: 'AA', apto: '101' }] });
    const { svc } = servico(prisma);
    const r = await svc.importBulk(1, [linha({ bloco: 'A', apartamento: '101' })], { podeCriarUnidade: false });
    expect(r.total).toBe(0);
    expect(r.erros[0].erro).toBe('Unidade não cadastrada — peça ao síndico para cadastrá-la.');
  });
});

describe('MoradoresService.importBulk — data de nascimento', () => {
  it('número solto (ano 1985) é recusado pedindo o formato, não vira 1905', async () => {
    const prisma = prismaBase();
    const { svc } = servico(prisma);
    const r = await svc.importBulk(1, [linha({ bloco: 'A', apartamento: '101', data_nascimento: 1985 })], { podeCriarUnidade: false });
    expect(r.total).toBe(0);
    expect(r.erros[0].erro).toBe('Data de nascimento inválida: use DD/MM/AAAA ou AAAA-MM-DD.');
  });

  const naUnidade = (extra: any = {}) => linha({ bloco: 'A', apartamento: '101', ...extra });

  it('DD/MM/AAAA e AAAA-MM-DD chegam ao cadastro', async () => {
    const prisma = prismaBase();
    const { svc } = servico(prisma);
    await svc.importBulk(1, [naUnidade({ data_nascimento: '15/05/1985' }), naUnidade({ nome: 'Bia', data_nascimento: '1990-02-03' })], { podeCriarUnidade: false });
    const datas = prisma.moradores.create.mock.calls.map((c: any) => (c[0].data.data_nascimento as Date).toISOString().slice(0, 10));
    expect(datas).toEqual(['1985-05-15', '1990-02-03']);
  });

  it('data em outro formato ou impossível: a linha vai para os erros com a explicação', async () => {
    const prisma = prismaBase();
    const { svc } = servico(prisma);
    const r = await svc.importBulk(1, [naUnidade({ data_nascimento: '31/02/1985' }), naUnidade({ nome: 'Bia', data_nascimento: 'maio de 85' })], { podeCriarUnidade: false });
    expect(r.total).toBe(0);
    expect(r.erros.map((e: any) => e.erro)).toEqual([
      'Data de nascimento inválida: use DD/MM/AAAA ou AAAA-MM-DD.',
      'Data de nascimento inválida: use DD/MM/AAAA ou AAAA-MM-DD.',
    ]);
  });

  it('com e-mail e sem data: importa sem conta no app (o e-mail fica no cadastro) e avisa', async () => {
    const prisma = prismaBase();
    const { svc, mail } = servico(prisma);

    const r = await svc.importBulk(1, [naUnidade({ email: 'ana@x.com', data_nascimento: '' })], { podeCriarUnidade: false });

    expect(r.total).toBe(1);
    expect(r.erros).toEqual([]);
    expect(r.sem_acesso).toEqual([{ nome: 'Ana', motivo: 'Sem data de nascimento: importado sem acesso ao app.' }]);
    const conta = prisma.users.create.mock.calls[0][0].data;
    expect(conta).not.toHaveProperty('login');
    expect(conta).not.toHaveProperty('password');
    expect(conta).not.toHaveProperty('email');
    expect(prisma.moradores.create.mock.calls[0][0].data.email).toBe('ana@x.com');
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it('com e-mail, sem data e o e-mail já é de uma conta do app: recusa pedindo a data', async () => {
    const prisma = prismaBase({ contaComEmail: { id: 70 } });
    const { svc } = servico(prisma);

    const r = await svc.importBulk(1, [naUnidade({ email: 'ana@x.com', data_nascimento: '' })], { podeCriarUnidade: false });

    expect(r.total).toBe(0);
    expect(r.erros[0].erro).toContain('data de nascimento');
    expect(prisma.users.create).not.toHaveBeenCalled();
  });

  it('sem e-mail e sem data: importa como antes', async () => {
    const prisma = prismaBase();
    const { svc } = servico(prisma);
    const r = await svc.importBulk(1, [naUnidade({ data_nascimento: '' })], { podeCriarUnidade: false });
    expect(r.total).toBe(1);
    expect(r.sem_acesso).toEqual([]);
  });
});

describe('MoradoresController.importBulk — quem pode criar unidade', () => {
  function build(assertPermissaoFuncionario: jest.Mock = jest.fn(async () => undefined)) {
    const service: any = { importBulk: jest.fn(async () => ({ ok: true })) };
    const tenant: any = { assertEntidade: jest.fn(), assertPermissaoFuncionario };
    return { ctrl: new MoradoresController(service, tenant), service, tenant };
  }
  const opcoes = (service: any) => service.importBulk.mock.calls[0][2];

  it('porteiro de login e senha (token sem typeAccess): não cria unidade', async () => {
    const { ctrl, service } = build();
    await ctrl.importBulk(1, { linhas: [] }, { sub: 12, nome: 'Porteiro', id_condominio: 1 } as JwtPayload);
    expect(opcoes(service)).toMatchObject({ podeCriarUnidade: false });
  });

  it('síndico: cria', async () => {
    const { ctrl, service } = build();
    await ctrl.importBulk(1, { linhas: [] }, { sub: 11, nome: 'S', typeAccess: 'Sindico', id_condominio: 1 } as JwtPayload);
    expect(opcoes(service)).toMatchObject({ podeCriarUnidade: true });
  });

  it('funcionário no console por QR sem a permissão "apartamentos": não cria', async () => {
    const { ctrl, service, tenant } = build(jest.fn(async () => { throw new ForbiddenException('sem permissão'); }));
    const func = { sub: 20, nome: 'F', typeAccess: 'Funcionario', id_condominio: 1 } as JwtPayload;
    await ctrl.importBulk(1, { linhas: [] }, func);
    expect(tenant.assertPermissaoFuncionario).toHaveBeenCalledWith(1, 'apartamentos', func);
    expect(opcoes(service)).toMatchObject({ podeCriarUnidade: false });
  });

  it('funcionário com a permissão: cria', async () => {
    const { ctrl, service } = build();
    await ctrl.importBulk(1, { linhas: [] }, { sub: 20, nome: 'F', typeAccess: 'Funcionario', id_condominio: 1 } as JwtPayload);
    expect(opcoes(service)).toMatchObject({ podeCriarUnidade: true });
  });
});
