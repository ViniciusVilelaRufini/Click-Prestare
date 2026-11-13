import { ConflictException } from '@nestjs/common';
import { CrmCondominiosService } from './crm-condominios.service';

/**
 * Funcionarios_Portaria.login é único só na própria tabela. O "criar condomínio" do CRM cria a
 * conta Users do síndico com login = e-mail sem conferir se esse login já é o de portaria de outra
 * pessoa; a correção de e-mail de acesso do morador grava o login novo do mesmo jeito.
 */
const LOGIN_PORTEIRO = 'porteiro@x.com';
const admin: any = { sub: 1, role: 'crm_admin', email: 'suporte@prestare.com' };

function build() {
  const tx: any = {
    condominios: { create: jest.fn(async () => ({ id: 9, nome: 'Cond' })) },
    apartamentos: { createMany: jest.fn() },
    users: { create: jest.fn(async () => ({ id: 50 })) },
    sindicos: { create: jest.fn() },
    sindicos_Condominios: { create: jest.fn() },
  };
  const prisma: any = {
    users: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => ({ id: 40, email: 'antigo@x.com', login: 'antigo@x.com' })), update: jest.fn() },
    funcionarios_Portaria: {
      count: jest.fn(async ({ where }: any) => {
        const alvo = where.login?.in ?? [where.login];
        return alvo.includes(LOGIN_PORTEIRO) ? 1 : 0;
      }),
    },
    moradores: {
      findFirst: jest.fn(async () => ({ id: 5, nome: 'M', email: 'antigo@x.com', id_user: 40 })),
      update: jest.fn(),
      count: jest.fn(async () => 0),
    },
    sindicos: { count: jest.fn(async () => 0) },
    sindicos_Condominios: { count: jest.fn(async () => 0) },
    funcionarios: { count: jest.fn(async () => 0) },
    apartamentos_Users: { count: jest.fn(async () => 0) },
    redefinicoes_Senha: { updateMany: jest.fn() },
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
  };
  const auditoria: any = { registrar: jest.fn(async () => undefined) };
  const svc = new CrmCondominiosService(prisma, auditoria, {} as any);
  return { svc, prisma, tx };
}

describe('CrmCondominiosService — login de portaria de outra pessoa', () => {
  const dto = (email: string) => ({ nome: 'Cond', sindico: { nome: 'S', email } });

  it('criar: síndico com o login de um porteiro → recusa antes de criar qualquer coisa', async () => {
    const { svc, prisma, tx } = build();
    await expect(svc.criar(dto(LOGIN_PORTEIRO), 'op')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.users.create).not.toHaveBeenCalled();
  });

  it('criar: mesma mensagem neutra do e-mail já usado por outra conta', async () => {
    const { svc, prisma } = build();
    const porPortaria = await svc.criar(dto(LOGIN_PORTEIRO), 'op').catch((e) => e.message);
    prisma.users.findFirst.mockResolvedValueOnce({ id: 3 });
    const porUsers = await svc.criar(dto('outro@x.com'), 'op').catch((e) => e.message);
    expect(porPortaria).toBe(porUsers);
  });

  it('criar: e-mail livre segue criando a conta do síndico', async () => {
    const { svc, tx } = build();
    await svc.criar(dto('livre@x.com'), 'op');
    expect(tx.users.create).toHaveBeenCalled();
  });

  it('corrigir e-mail do morador para o login de um porteiro → recusa sem gravar', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.corrigirEmailAcessoMorador(1, 5, { email: LOGIN_PORTEIRO, motivo: 'digitado errado' }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.moradores.update).not.toHaveBeenCalled();
  });
});
