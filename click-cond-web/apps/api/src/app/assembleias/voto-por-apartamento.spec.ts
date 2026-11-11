import { ForbiddenException } from '@nestjs/common';
import { AssembleiasService } from './assembleias.service';
import { AssembleiasController } from './assembleias.controller';

/**
 * O voto era por CONTA: proprietário, inquilino e cada familiar cadastrado
 * votavam separado — o apartamento com cinco contas pesava cinco vezes —, e
 * síndico/funcionário sem unidade no condomínio também votavam.
 *
 * Regra: só vota quem tem vínculo em `Apartamentos_Users` num apartamento do
 * condomínio da votação (qualquer tipo de vínculo), e o voto é UM por
 * apartamento: o voto novo de outra conta do mesmo apartamento substitui o
 * anterior, como já acontecia com o voto da própria conta.
 */
describe('Votação — um voto por apartamento', () => {
  const ID_COND = 1;
  const OPCOES = [{ id: 9 }, { id: 10 }];

  // Vínculos: 50 e 51 moram no apto 100; 60 tem os aptos 200 e 300; 70 é do
  // apto 400 de OUTRO condomínio (2).
  const VINCULOS = [
    { id_user: 50, id_apto: 100, cond: 1 },
    { id_user: 51, id_apto: 100, cond: 1 },
    { id_user: 60, id_apto: 200, cond: 1 },
    { id_user: 60, id_apto: 300, cond: 1 },
    { id_user: 61, id_apto: 300, cond: 1 },
    { id_user: 70, id_apto: 400, cond: 2 },
  ];

  function build() {
    const prisma: any = {
      isConnected: true,
      votacoes: {
        findUnique: jest.fn(async () => ({
          id: 5,
          id_condominio: ID_COND,
          data_inicio: new Date('2020-01-01T00:00:00Z'),
          data_termino: new Date('2099-01-01T00:00:00Z'),
          opcoes: OPCOES,
        })),
      },
      apartamentos_Users: {
        findMany: jest.fn(async ({ where }: any) =>
          VINCULOS.filter(
            (v) =>
              (where.id_user === undefined || v.id_user === where.id_user) &&
              (where.id_apto === undefined || v.id_apto === where.id_apto) &&
              (where.apartamento?.id_condominio === undefined || v.cond === where.apartamento.id_condominio),
          ).map((v) => ({ id_user: v.id_user, id_apto: v.id_apto })),
        ),
      },
      votacoes_Usuarios: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const svc = new AssembleiasService(prisma, {} as any, tenant);
    return { svc, prisma };
  }

  const token = (id: number, typeAccess = 'Morador') => ({ sub: id, nome: `U${id}`, typeAccess, user: { id } }) as any;
  const apagouDe = (prisma: any) => prisma.votacoes_Usuarios.deleteMany.mock.calls[0][0].where;

  it('síndico/funcionário sem unidade no condomínio NÃO vota', async () => {
    const { svc, prisma } = build();
    await expect(svc.registerVoto(5, 9, 80, token(80, 'Sindico'))).rejects.toThrow(
      new ForbiddenException('Somente moradores com unidade no condomínio podem votar.'),
    );
    await expect(svc.registerVoto(5, 9, 70, token(70, 'Funcionario'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.votacoes_Usuarios.create).not.toHaveBeenCalled();
  });

  it('o voto de outra conta do mesmo apartamento substitui o anterior', async () => {
    const { svc, prisma } = build();
    await svc.registerVoto(5, 10, 51, token(51));
    const where = apagouDe(prisma);
    expect(new Set(where.id_user.in)).toEqual(new Set([50, 51]));
    expect(where.id_opcao).toEqual({ in: [9, 10] });
    expect(prisma.votacoes_Usuarios.create).toHaveBeenCalledWith({ data: { id_opcao: 10, id_user: 51 } });
  });

  it('com mais de um apartamento, vota pelo informado no corpo se for dele', async () => {
    const { svc, prisma } = build();
    await svc.registerVoto(5, 9, 60, token(60), 300);
    expect(new Set(apagouDe(prisma).id_user.in)).toEqual(new Set([60, 61]));
  });

  it('apartamento informado que não é dele cai no primeiro apartamento dele', async () => {
    const { svc, prisma } = build();
    await svc.registerVoto(5, 9, 60, token(60), 100);
    expect(new Set(apagouDe(prisma).id_user.in)).toEqual(new Set([60]));
  });

  it('o controller repassa o apartamento do corpo, quando vem', () => {
    const service: any = { registerVoto: jest.fn(async () => ({ success: true })) };
    const ctrl = new AssembleiasController(service);
    const m = token(60);
    ctrl.registerVoto({ voto: { votacao_id: 5, opcao_id: 9, id_apto: '300' } } as any, m);
    expect(service.registerVoto).toHaveBeenCalledWith(5, 9, 60, m, 300);
  });
});
