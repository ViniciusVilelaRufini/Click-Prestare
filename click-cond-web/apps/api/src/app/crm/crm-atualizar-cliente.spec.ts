import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { CrmService } from './crm.service';

/** Mock reutilizável: a Task 8 acrescenta casos de plano/mensalidade aqui. */
export function buildAtualizarCliente(opts: { vinculos?: any[]; outraConta?: any } = {}) {
  const vinculos = opts.vinculos ?? [
    { id: 1, id_user: 5 },
    { id: 2, id_user: 6 },
  ];
  const prisma: any = {
    isConnected: true,
    condominios: {
      findUnique: jest.fn(async () => ({ id: 9, nome: 'Cond' })),
      update: jest.fn(async () => ({})),
    },
    assinaturas_Condominios: { findFirst: jest.fn(async () => null), update: jest.fn(), create: jest.fn() },
    sindicos_Condominios: { findFirst: jest.fn(async () => vinculos[0] ?? null) },
    sindicos: { findFirst: jest.fn(async () => ({ id: 30 })), update: jest.fn() },
    users: { findFirst: jest.fn(async () => opts.outraConta ?? null), update: jest.fn() },
    funcionarios_Portaria: { count: jest.fn(async () => 0) },
  };
  const svc = new CrmService(prisma, {} as any, {} as any);
  jest.spyOn(svc, 'cliente').mockResolvedValue({ id: 9 } as any);
  return { svc, prisma };
}

describe('CrmService.atualizarCliente: síndico', () => {
  it('sem vínculo e com dados de síndico: 422 e nada gravado', async () => {
    const { svc, prisma } = buildAtualizarCliente({ vinculos: [] });
    await expect(svc.atualizarCliente(9, { sindicoNome: 'Ana' } as any)).rejects.toThrow(
      new UnprocessableEntityException('Este condomínio ainda não tem síndico. Use "Vincular síndico".'),
    );
    expect(prisma.condominios.update).not.toHaveBeenCalled();
  });

  it('escolhe o vínculo mais antigo (orderBy id asc)', async () => {
    const { svc, prisma } = buildAtualizarCliente();
    await svc.atualizarCliente(9, { sindicoNome: 'Ana' } as any);
    expect(prisma.sindicos_Condominios.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'asc' } }),
    );
    expect(prisma.users.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5 } }));
  });

  it('troca de e-mail grava email e login juntos, em minúsculas', async () => {
    const { svc, prisma } = buildAtualizarCliente();
    await svc.atualizarCliente(9, { sindicoEmail: ' Novo@X.com ' } as any);
    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ email: 'novo@x.com', login: 'novo@x.com' }),
    });
  });

  it('e-mail de outra conta: 409 sem gravar', async () => {
    const { svc, prisma } = buildAtualizarCliente({ outraConta: { id: 99 } });
    await expect(svc.atualizarCliente(9, { sindicoEmail: 'x@x.com' } as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.condominios.update).not.toHaveBeenCalled();
  });

  it('sem dados de síndico, não consulta vínculo (edição só do condomínio)', async () => {
    const { svc, prisma } = buildAtualizarCliente({ vinculos: [] });
    await svc.atualizarCliente(9, { nome: 'Novo' } as any);
    expect(prisma.sindicos_Condominios.findFirst).not.toHaveBeenCalled();
  });
});
