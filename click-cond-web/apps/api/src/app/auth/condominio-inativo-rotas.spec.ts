import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

/**
 * Rotas do app que resolvem o condomínio pelo vínculo do usuário (sem assertCondominio): token de
 * 365 dias não pode seguir lendo/gravando depois que o CRM desativa o condomínio. O "banco" simulado
 * só devolve a linha quando o where NÃO exige condomínio ativo (condomínio inativo).
 */
const exigeAtivo = (where: any): boolean => {
  const txt = JSON.stringify(where ?? {});
  return /"condominio":\{"ativo":1\}/.test(txt);
};
const delegate = (linha: any) => ({
  findFirst: jest.fn(async ({ where }: any = {}) => (exigeAtivo(where) ? null : linha)),
  findMany: jest.fn(async ({ where }: any = {}) => (exigeAtivo(where) ? [] : [linha])),
  count: jest.fn(async ({ where }: any = {}) => (exigeAtivo(where) ? 0 : 1)),
});

function build() {
  const morador = { id: 7, id_user: 1, id_condominio: 5, apartamento: '101', bloco: 'A', nome: 'M', foto_pessoa: null, user: {} };
  const base: any = {
    isConnected: true,
    moradores: delegate(morador),
    apartamentos_Users: delegate({ id_apto: 3, apartamento: { id: 3, id_condominio: 5 } }),
    sindicos_Condominios: delegate({ id_condominio: 5 }),
    funcionarios: delegate({ id_condominio: 5 }),
    funcionarios_Portaria: delegate({ id_condominio: 5 }),
    users: { findUnique: jest.fn(async () => ({})) },
    ocorrencias: {
      findMany: jest.fn(async ({ where }: any) => (exigeAtivo(where.OR?.[0]) ? [] : [{ id: 1 }])),
      count: jest.fn(async () => 0),
    },
    encomendas: {
      findUnique: jest.fn(async () => ({ id: 9, id_condominio: 5, destinatario_apto: '101', destinatario_bloco: 'A', status: 'Aguardando' })),
      findMany: jest.fn(async () => [{ id: 9 }]),
      count: jest.fn(async () => 4),
      update: jest.fn(),
    },
    visitas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    visitantes: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    acessos_Facial: { findMany: jest.fn(async () => []) },
  };
  // Tabelas que a rota consulta mas que não importam ao teste respondem vazio.
  const vazio = { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), count: jest.fn(async () => 0) };
  const prisma: any = new Proxy(base, { get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vazio) });
  const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, { assertCondominio: jest.fn() } as any);
  return { svc: svc as any, prisma };
}

describe('rotas do app por vínculo — condomínio inativo', () => {
  it('veículos e vagas: vínculo em condomínio inativo não é encontrado', async () => {
    const { svc } = build();
    expect(await svc.resolveMoradorId(1)).toBeNull();
    expect(await svc.resolveMoradorApto(1)).toBeNull();
  });

  it('resumo, eventos e notificações: ignoram vínculos inativos', async () => {
    const { svc, prisma } = build();
    expect(await svc.getSummary(1, 'Sindico')).toEqual({ debts: { count: 0, total: 0 }, occurrences: 0 });
    expect(await svc.getSummary(1, 'Funcionario')).toMatchObject({ packages: 0, occurrences: 0 });
    expect(await svc.getSummary(1, 'Morador')).toMatchObject({ packages: 0 });
    expect(await svc.getMeusEventos(1, 15, 'Morador')).toEqual([]);
    expect(prisma.encomendas.count).not.toHaveBeenCalled();
    expect(await svc.getNotificacoes(1)).toEqual(expect.anything());
    for (const m of ['moradores', 'apartamentos_Users']) {
      for (const c of prisma[m].findMany.mock.calls) expect(exigeAtivo(c[0].where)).toBe(true);
    }
  });

  it('ocorrências: não devolve as do condomínio inativo', async () => {
    const { svc } = build();
    expect(await svc.listOcorrencias(1)).toEqual([]);
  });

  it('encomendas: leitura vazia e retirada recusada', async () => {
    const { svc } = build();
    expect(await svc.listEncomendasByUser(1, undefined, 'Morador')).toEqual([]);
    expect(await svc.listEncomendasByUser(1, undefined, 'Sindico')).toEqual([]);
    await expect(svc.retirarEncomendaMorador(1, 9)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
