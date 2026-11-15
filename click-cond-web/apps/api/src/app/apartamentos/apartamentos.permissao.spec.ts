import { ForbiddenException } from '@nestjs/common';
import { ApartamentosService } from './apartamentos.service';

/**
 * A flag `apartamentos` controla quem da equipe mexe no cadastro de unidades.
 * O app respeitava (new_apto.dart:125, list_moradores.dart:46), o servico nao:
 * so exigia `assertStaff`, entao qualquer funcionario logado criava, editava e
 * REMOVIA apartamento — e remover apartamento arrasta moradores, visitantes,
 * vagas, agendamentos e mudancas junto.
 *
 * O caminho da operadora (`role: crm_admin`, o console administrativo) tem
 * regra propria e nao pode ser afetado: por isso o assert entra dentro do
 * mesmo `if (!viaOperadora)` que ja guarda o assertStaff.
 */
describe('ApartamentosService — exige a flag apartamentos', () => {
  function build() {
    const tenant = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async (_id: number, _flag: string, payload: any) => {
        if ((payload?.typeAccess ?? '').toLowerCase() !== 'funcionario') return;
        if (payload.permissoes?.apartamentos !== 1) {
          throw new ForbiddenException('Acesso negado: seu perfil não tem permissão para esta área.');
        }
      }),
    };
    const prisma: any = {
      isConnected: true,
      apartamentos: {
        create: jest.fn(async () => ({ id: 30, apto: '101', id_condominio: 2 })),
        findUnique: jest.fn(async () => ({ id: 30, apto: '101', bloco: 'A', id_condominio: 2 })),
        update: jest.fn(async () => ({ id: 30 })),
        delete: jest.fn(async () => ({ id: 30 })),
      },
      moradores: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      visitantes: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      vagas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      agendamentos: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      mudancas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    };
    const auditoria = { registrar: jest.fn(async () => undefined) };
    const service = new ApartamentosService(prisma, tenant as any, auditoria as any);
    return { service, prisma, tenant };
  }

  const semFlag: any = {
    sub: 5,
    typeAccess: 'Funcionario',
    user: { id: 5 },
    permissoes: { apartamentos: 0 },
  };
  const comFlag: any = {
    sub: 6,
    typeAccess: 'Funcionario',
    user: { id: 6 },
    permissoes: { apartamentos: 1 },
  };
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };
  const operadora: any = { sub: 1, role: 'crm_admin' };

  const dto: any = { apto: '101', bloco: 'A', id_condominio: 2 };

  it('NEGA criar sem a flag', async () => {
    const { service, prisma } = build();
    await expect(service.create(dto, semFlag)).rejects.toThrow(ForbiddenException);
    expect(prisma.apartamentos.create).not.toHaveBeenCalled();
  });

  it('NEGA editar sem a flag', async () => {
    const { service, prisma } = build();
    await expect(service.update(30, { apto: '102' }, semFlag)).rejects.toThrow(ForbiddenException);
    expect(prisma.apartamentos.update).not.toHaveBeenCalled();
  });

  it('NEGA remover sem a flag', async () => {
    const { service, prisma } = build();
    await expect(service.remove(30, semFlag)).rejects.toThrow(ForbiddenException);
    expect(prisma.apartamentos.delete).not.toHaveBeenCalled();
  });

  it('PERMITE funcionário com a flag', async () => {
    const { service, prisma } = build();
    await service.create(dto, comFlag);
    expect(prisma.apartamentos.create).toHaveBeenCalled();
  });

  it('PERMITE o síndico', async () => {
    const { service, prisma } = build();
    await service.create(dto, sindico);
    expect(prisma.apartamentos.create).toHaveBeenCalled();
  });

  it('NEGA importar unidades em massa sem a flag (rodada 4)', async () => {
    const { service, prisma } = build();
    (prisma.apartamentos as any).findFirst = jest.fn(async () => null);
    await expect(service.importBulk(2, [{ apto: '103', bloco: 'A' }], semFlag)).rejects.toThrow(ForbiddenException);
    expect(prisma.apartamentos.create).not.toHaveBeenCalled();
  });

  it('PERMITE importar com a flag', async () => {
    const { service, prisma } = build();
    (prisma.apartamentos as any).findFirst = jest.fn(async () => null);
    await service.importBulk(2, [{ apto: '103', bloco: 'A' }], comFlag);
    expect(prisma.apartamentos.create).toHaveBeenCalled();
  });

  describe('acesso (GET apartamentos/acesso): a tela esconde os botões de quem a API recusaria', () => {
    it('síndico e funcionário com a flag gerenciam', async () => {
      const { service } = build();
      await expect(service.acesso(2, sindico)).resolves.toEqual({ gerenciar: true });
      await expect(service.acesso(2, comFlag)).resolves.toEqual({ gerenciar: true });
    });

    it('funcionário sem a flag e porteiro de login e senha não gerenciam', async () => {
      const { service } = build();
      await expect(service.acesso(2, semFlag)).resolves.toEqual({ gerenciar: false });
      await expect(service.acesso(2, { sub: 3, nome: 'P', id_condominio: 2 } as any)).resolves.toEqual({ gerenciar: false });
    });
  });

  /// O console administrativo nao tem flag de funcionario e nao pode ser barrado.
  it('não interfere no caminho da operadora', async () => {
    const { service, prisma, tenant } = build();
    await service.create(dto, operadora, { viaCrm: true });
    expect(prisma.apartamentos.create).toHaveBeenCalled();
    expect(tenant.assertPermissaoFuncionario).not.toHaveBeenCalled();
  });
});
