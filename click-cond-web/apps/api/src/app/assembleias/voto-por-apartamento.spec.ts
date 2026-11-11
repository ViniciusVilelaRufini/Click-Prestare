import { ForbiddenException } from '@nestjs/common';
import { AssembleiasService } from './assembleias.service';

/**
 * O voto era por CONTA: proprietário, inquilino e cada familiar cadastrado
 * votavam separado — o apartamento com cinco contas pesava cinco vezes —, e
 * síndico/funcionário sem unidade no condomínio também votavam.
 *
 * Regra (sem mudar o schema, que não grava o apartamento no voto): cada conta
 * pertence a UMA unidade determinística no condomínio — a de menor `id_apto`
 * entre os vínculos dela em `Apartamentos_Users`.
 *  - Só vota quem tem unidade atribuída.
 *  - Votar apaga só os votos das contas com a MESMA unidade atribuída.
 *  - A apuração conta um voto por unidade atribuída (o mais recente) e
 *    descarta votante sem unidade — o que também resolve a corrida entre duas
 *    contas do mesmo apto e os votos gravados antes desta regra.
 */
describe('Votação — um voto por apartamento', () => {
  const ID_COND = 1;
  const OPCOES = [{ id: 9 }, { id: 10 }];

  // 50 e 51 moram no apto 100; X=60 tem os aptos 200 e 300 (unidade: 200);
  // Y=61 só o 300; 70 é do apto 400 de OUTRO condomínio (2).
  const VINCULOS = [
    { id_user: 50, id_apto: 100, cond: 1 },
    { id_user: 51, id_apto: 100, cond: 1 },
    { id_user: 60, id_apto: 300, cond: 1 },
    { id_user: 60, id_apto: 200, cond: 1 },
    { id_user: 61, id_apto: 300, cond: 1 },
    { id_user: 70, id_apto: 400, cond: 2 },
  ];

  const casaUser = (filtro: any, id: number) =>
    filtro === undefined || (typeof filtro === 'object' ? filtro.in.includes(id) : filtro === id);

  function build(votos: Array<{ id: number; id_user: number; id_opcao: number; created_at: Date }> = []) {
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
        findMany: jest.fn(async () => [{
          id: 5, id_condominio: ID_COND, titulo: 'QA', descricao: null, data_inicio: null, data_termino: null,
          opcoes: [
            { id: 9, nome: 'Sim', votos: votos.filter((v) => v.id_opcao === 9) },
            { id: 10, nome: 'Não', votos: votos.filter((v) => v.id_opcao === 10) },
          ],
        }]),
      },
      apartamentos_Users: {
        findMany: jest.fn(async ({ where }: any) =>
          VINCULOS.filter(
            (v) =>
              casaUser(where.id_user, v.id_user) &&
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
  const apagouDe = (prisma: any) => new Set(prisma.votacoes_Usuarios.deleteMany.mock.calls[0][0].where.id_user.in);

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
    expect(apagouDe(prisma)).toEqual(new Set([50, 51]));
    expect(prisma.votacoes_Usuarios.deleteMany.mock.calls[0][0].where.id_opcao).toEqual({ in: [9, 10] });
    expect(prisma.votacoes_Usuarios.create).toHaveBeenCalledWith({ data: { id_opcao: 10, id_user: 51 } });
  });

  it('X (aptos 200 e 300) e Y (só 300): o voto de Y não apaga o de X', async () => {
    const { svc, prisma } = build();
    await svc.registerVoto(5, 9, 61, token(61));
    expect(apagouDe(prisma)).toEqual(new Set([61]));
  });

  it('X vota pela unidade atribuída (menor id_apto) e não apaga o voto de Y', async () => {
    const { svc, prisma } = build();
    await svc.registerVoto(5, 9, 60, token(60));
    expect(apagouDe(prisma)).toEqual(new Set([60]));
  });

  it('apuração: duas contas do mesmo apto contam 1, o voto mais recente', async () => {
    const { svc } = build([
      { id: 1, id_user: 50, id_opcao: 9, created_at: new Date('2026-11-10T12:00:00Z') },
      { id: 2, id_user: 51, id_opcao: 10, created_at: new Date('2026-11-10T12:05:00Z') },
    ]);
    const [v] = await (svc as any).getVotacoesFormatadas(undefined, true, undefined, 5);
    expect(v.opcoes).toEqual(['9;Sim;0', '10;Não;1']);
  });

  it('apuração: voto antigo de conta sem vínculo de unidade não conta', async () => {
    const { svc } = build([
      { id: 1, id_user: 80, id_opcao: 9, created_at: new Date('2026-11-10T12:00:00Z') },
      { id: 2, id_user: 70, id_opcao: 9, created_at: new Date('2026-11-10T12:00:00Z') }, // unidade em outro condomínio
      { id: 3, id_user: 60, id_opcao: 10, created_at: new Date('2026-11-10T12:00:00Z') },
      { id: 4, id_user: 61, id_opcao: 10, created_at: new Date('2026-11-10T12:00:00Z') },
    ]);
    const [v] = await (svc as any).getVotacoesFormatadas(undefined, true, undefined, 5);
    // X (unidade 200) e Y (unidade 300) são unidades diferentes: 2 votos.
    expect(v.opcoes).toEqual(['9;Sim;0', '10;Não;2']);
  });
});
