import { MoradoresService } from './moradores.service';

/**
 * Rodada 2, correção 1 (I1 e M1). O app (mobile-auth vincularApartamento) e o link-user criam UMA
 * linha de Moradores POR UNIDADE, com o bloco/apto da unidade. A unidade que a edição troca, e cujo
 * tipo muda, é a da própria linha — não a primeira do usuário (que a lista mostrava em todas as linhas).
 */

function novoServico(prisma: any) {
  return new MoradoresService(
    prisma,
    {} as any,
    { isDataUrl: jest.fn().mockReturnValue(false), uploadDataUrl: jest.fn() } as any,
    { syncMorador: jest.fn().mockResolvedValue({}) } as any,
    { registrar: jest.fn().mockResolvedValue({}) } as any,
    { enviarMorador: jest.fn().mockResolvedValue({ enviado: false }) } as any,
  );
}

const semVinculoFora = () => ({
  sindicos_Condominios: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  funcionarios: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
});

// Usuário 41 no condomínio 1: linha 43 = A/101 (vínculo 70, apto 7), linha 44 = A/102 (vínculo 80, apto 8).
const v101 = { id: 70, id_apto: 7, apartamento: { bloco: 'A', apto: '101' } };
const v102 = { id: 80, id_apto: 8, apartamento: { bloco: 'Bloco A', apto: '102' } };

function harnessLinha(linha: { id: number; bloco: string | null; apartamento: string | null }, vinculos: any[] = [v101, v102]) {
  const tx: any = {
    apartamentos_Users: {
      findMany: jest.fn().mockResolvedValue(vinculos),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    apartamentos: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, bloco: 'A', apto: String(100 + where.id), id_condominio: 1 })),
    },
    moradores: { update: jest.fn().mockResolvedValue({ id: linha.id, id_user: 41, id_condominio: 1, nome: 'Ana' }) },
    users: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    isConnected: true,
    ...semVinculoFora(),
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    moradores: {
      findUnique: jest.fn().mockResolvedValue({ id_user: 41, id_condominio: 1, tipo: 'proprietario', nome: 'Ana', ...linha }),
      count: jest.fn().mockResolvedValue(0),
    },
    apartamentos_Users: { count: jest.fn().mockResolvedValue(0) },
    users: { update: jest.fn().mockResolvedValue({}) },
  };
  const service = novoServico(prisma);
  jest.spyOn(service as any, 'assertCredencialDisponivel').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'carregarContextoMorador').mockResolvedValue(null);
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: linha.id } as any);
  return { service, tx };
}

describe('I1 — update troca o vínculo da unidade da própria linha', () => {
  it('linha 44 (102) trocada para 103 move o vínculo do 102, mesmo com a tela dizendo que a anterior era 101', async () => {
    const { service, tx } = harnessLinha({ id: 44, bloco: 'A', apartamento: '102' });

    await service.update(44, { id_apartamento: 3, id_apartamento_anterior: 7 } as any);

    expect(tx.apartamentos_Users.deleteMany).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.create).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.update).toHaveBeenCalledTimes(1);
    expect(tx.apartamentos_Users.update).toHaveBeenCalledWith({ where: { id: 80 }, data: { id_apto: 3 } });
  });

  it('linha 44 (102) com a tela mandando uma anterior de outro condomínio: move o 102, sem acrescentar', async () => {
    const { service, tx } = harnessLinha({ id: 44, bloco: 'A', apartamento: '102' });

    await service.update(44, { id_apartamento: 3, id_apartamento_anterior: 555 } as any);

    expect(tx.apartamentos_Users.create).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.update).toHaveBeenCalledWith({ where: { id: 80 }, data: { id_apto: 3 } });
  });

  it('linha sem unidade gravada: a anterior da tela vale como reforço', async () => {
    const { service, tx } = harnessLinha({ id: 44, bloco: null, apartamento: null });

    await service.update(44, { id_apartamento: 3, id_apartamento_anterior: 8 } as any);

    expect(tx.apartamentos_Users.update).toHaveBeenCalledWith({ where: { id: 80 }, data: { id_apto: 3 } });
  });
});

describe('M1 — tipo muda só no vínculo da unidade da linha', () => {
  it('editar só o telefone não mexe no tipo de vínculo nenhum', async () => {
    const { service, tx } = harnessLinha({ id: 44, bloco: 'A', apartamento: '102' });

    await service.update(44, { telefone: '11988887777' } as any);

    expect(tx.apartamentos_Users.updateMany).not.toHaveBeenCalled();
  });

  it('trocar o tipo da linha do 102 muda só o vínculo do 102', async () => {
    const { service, tx } = harnessLinha({ id: 44, bloco: 'A', apartamento: '102' });

    await service.update(44, { tipo: 'Inquilino' } as any);

    expect(tx.apartamentos_Users.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.apartamentos_Users.updateMany).toHaveBeenCalledWith({ where: { id: { in: [80] } }, data: { tipo: 'inquilino' } });
  });

  it('trocar unidade e tipo juntos aplica o tipo só ao vínculo movido', async () => {
    const { service, tx } = harnessLinha({ id: 44, bloco: 'A', apartamento: '102' });

    await service.update(44, { id_apartamento: 3, tipo: 'inquilino' } as any);

    expect(tx.apartamentos_Users.updateMany).toHaveBeenCalledWith({ where: { id: { in: [80] } }, data: { tipo: 'inquilino' } });
  });

  it('tipo trocado sem como saber a unidade da linha (vários vínculos) não achata os vínculos', async () => {
    const { service, tx } = harnessLinha({ id: 44, bloco: null, apartamento: null });

    await service.update(44, { tipo: 'inquilino' } as any);

    expect(tx.apartamentos_Users.updateMany).not.toHaveBeenCalled();
  });
});

describe('I1 — a lista e a ficha mostram, por linha, a unidade da própria linha', () => {
  const vinculosUser = [
    { id_apto: 7, apartamento: { bloco: 'A', apto: '101' } },
    { id_apto: 8, apartamento: { bloco: 'A', apto: '102' } },
  ];
  const base = { id_user: 41, id_condominio: 1, nome: 'Ana', foto_pessoa: null, face_id: null, face_sync_error: null };
  const prismaLista = (moradores: any[]) => ({
    isConnected: true,
    ...semVinculoFora(),
    moradores: { findMany: jest.fn().mockResolvedValue(moradores) },
    apartamentos_Users: { findMany: jest.fn().mockResolvedValue([]) },
    consentimentos: { findMany: jest.fn().mockResolvedValue([]) },
  });

  it('duas linhas do mesmo morador: cada uma com o seu apto, e só vínculos deste condomínio', async () => {
    const prisma: any = prismaLista([
      { ...base, id: 43, bloco: 'A', apartamento: '101', user: { photo: null, login: 'a@x', apartamentosUsers: vinculosUser } },
      { ...base, id: 44, bloco: 'A', apartamento: '102', user: { photo: null, login: 'a@x', apartamentosUsers: vinculosUser } },
    ]);
    const lista = await novoServico(prisma).findAll(1);
    expect(lista.map((m: any) => [m.id, m.id_apartamento])).toEqual([[43, 7], [44, 8]]);
    const include = prisma.moradores.findMany.mock.calls[0][0].include;
    expect(include.user.select.apartamentosUsers.where).toEqual({ apartamento: { id_condominio: 1 } });
  });

  it('linha sem correspondência e vários vínculos: não chuta a unidade de outra linha', async () => {
    const prisma: any = prismaLista([
      { ...base, id: 45, bloco: null, apartamento: null, user: { photo: null, login: 'a@x', apartamentosUsers: vinculosUser } },
    ]);
    const [m] = await novoServico(prisma).findAll(1);
    expect(m.id_apartamento).toBe(0);
  });

  it('linha sem correspondência e vínculo único: mostra esse vínculo', async () => {
    const prisma: any = prismaLista([
      { ...base, id: 45, bloco: null, apartamento: null, user: { photo: null, login: 'a@x', apartamentosUsers: [vinculosUser[0]] } },
    ]);
    const [m] = await novoServico(prisma).findAll(1);
    expect(m.id_apartamento).toBe(7);
  });

  it('filtro por apartamento devolve a linha daquela unidade', async () => {
    const prisma: any = prismaLista([]);
    prisma.apartamentos_Users.findMany = jest.fn().mockResolvedValue([
      {
        id_user: 41,
        id_apto: 8,
        tipo: 'inquilino',
        apartamento: { id: 8, id_condominio: 1, bloco: 'A', apto: '102' },
        user: {
          id: 41, photo: null, login: 'a@x', email: null, phone: null, cpf: null,
          moradores: [{ ...base, id: 43, bloco: 'A', apartamento: '101' }, { ...base, id: 44, bloco: 'A', apartamento: '102' }],
        },
      },
    ]);
    const [m] = await novoServico(prisma).findAll(1, undefined, 8);
    expect(m.id).toBe(44);
  });

  it('findOne usa a unidade da linha, só entre os vínculos do condomínio dela', async () => {
    const prisma: any = {
      isConnected: true,
      ...semVinculoFora(),
      moradores: {
        findUnique: jest.fn().mockResolvedValue({
          ...base,
          id: 44,
          bloco: 'A',
          apartamento: '102',
          user: {
            photo: null,
            apartamentosUsers: [
              { id_apto: 99, apartamento: { bloco: 'A', apto: '102', id_condominio: 2 } },
              { id_apto: 7, apartamento: { bloco: 'A', apto: '101', id_condominio: 1 } },
              { id_apto: 8, apartamento: { bloco: 'A', apto: '102', id_condominio: 1 } },
            ],
          },
        }),
      },
    };
    const m: any = await novoServico(prisma).findOne(44);
    expect(m.id_apartamento).toBe(8);
  });
});
