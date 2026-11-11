import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CrmCondominiosService } from './crm-condominios.service';
import { CrmController } from './crm.controller';
import { CrmAdminGuard } from './crm-admin.guard';

/**
 * Suporte da Prestare: o síndico cadastrou o morador com o e-mail digitado
 * errado. Desde a varredura de segurança ninguém fora do CRM troca o e-mail
 * de login da conta de outra pessoa (era tomada de conta), então a correção
 * mora aqui, auditada, e não gera nem envia senha.
 */
describe('CrmCondominiosService.corrigirEmailAcessoMorador', () => {
  const admin: any = { sub: 9, role: 'crm_admin', nome: 'Ana Suporte', email: 'ana@prestare.com.br' };

  function build(opts?: { morador?: any; conflito?: any }) {
    const morador =
      opts && 'morador' in opts
        ? opts.morador
        : {
            id: 50,
            nome: 'Carlos Morador',
            email: 'carlos@gmial.com',
            id_user: 70,
            id_condominio: 1,
          };
    const conta = morador?.id_user ? { id: morador.id_user, email: 'carlos@gmial.com', login: 'carlos@gmial.com' } : null;
    const prisma: any = {
      moradores: {
        findFirst: jest.fn(async () => morador),
        update: jest.fn(async (a: any) => ({ ...morador, ...a.data })),
      },
      users: {
        findUnique: jest.fn(async () => conta),
        findFirst: jest.fn(async () => opts?.conflito ?? null),
        update: jest.fn(async (a: any) => ({ id: 70, ...a.data })),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const svc = new CrmCondominiosService(prisma, auditoria, {} as any);
    return { svc, prisma, auditoria };
  }

  it('admin do CRM corrige: grava Users.email/login e Moradores.email, derruba as sessões e audita', async () => {
    const { svc, prisma, auditoria } = build();

    const r = await svc.corrigirEmailAcessoMorador(
      1,
      50,
      { email: '  Carlos@Gmail.com ', motivo: 'Síndico digitou gmial' },
      admin,
    );

    expect(prisma.moradores.findFirst.mock.calls[0][0].where).toEqual({ id: 50, id_condominio: 1 });
    // Outra conta com o e-mail novo, excluindo a própria.
    const busca = prisma.users.findFirst.mock.calls[0][0].where;
    expect(busca).toEqual({
      id: { not: 70 },
      OR: [{ email: 'carlos@gmail.com' }, { login: 'carlos@gmail.com' }],
    });

    const upUser = prisma.users.update.mock.calls[0][0];
    expect(upUser.where).toEqual({ id: 70 });
    expect(upUser.data.email).toBe('carlos@gmail.com');
    expect(upUser.data.login).toBe('carlos@gmail.com');
    // Mesmo mecanismo da redefinição de senha: tokens emitidos antes caem.
    expect(upUser.data.senha_alterada_em).toBeInstanceOf(Date);
    // Não gera nem troca senha.
    expect(upUser.data.password).toBeUndefined();

    expect(prisma.moradores.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: { email: 'carlos@gmail.com' },
    });

    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    const log = auditoria.registrar.mock.calls[0][0];
    expect(log).toMatchObject({
      id_condominio: 1,
      usuario_nome: 'Ana Suporte',
      usuario_email: 'ana@prestare.com.br',
      autor_id: 9,
      autor_tipo: 'crm_admin',
      acao: 'UPDATE',
      entidade_id: 50,
    });
    expect(log.detalhes).toMatchObject({
      email_anterior: 'ca****@gmial.com',
      email_novo: 'ca****@gmail.com',
      motivo: 'Síndico digitou gmial',
      sessoes_encerradas: true,
    });
    // Nenhum e-mail completo vaza para a auditoria.
    expect(JSON.stringify(log)).not.toContain('carlos@');

    expect(r).toMatchObject({ success: true, email: 'carlos@gmail.com', contaAtualizada: true });
    expect(JSON.stringify(r)).not.toMatch(/senha/i);
  });

  it('recusa token que não é de admin do CRM, sem tocar no banco', async () => {
    const { svc, prisma } = build();
    const sindico: any = { sub: 7, typeAccess: 'Sindico', user: { id: 7, typeAccess: 'Sindico' } };

    await expect(
      svc.corrigirEmailAcessoMorador(1, 50, { email: 'x@y.com', motivo: 'm' }, sindico),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.moradores.findFirst).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('a rota fica atrás do CrmAdminGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, CrmController.prototype.corrigirEmailAcessoMorador);
    expect(guards).toContain(CrmAdminGuard);
  });

  it('recusa e-mail que já é de outra conta, com mensagem clara', async () => {
    const { svc, prisma, auditoria } = build({ conflito: { id: 99 } });

    const p = svc.corrigirEmailAcessoMorador(1, 50, { email: 'joao@gmail.com', motivo: 'm' }, admin);
    await expect(p).rejects.toBeInstanceOf(ConflictException);
    await expect(
      svc.corrigirEmailAcessoMorador(1, 50, { email: 'joao@gmail.com', motivo: 'm' }, admin),
    ).rejects.toThrow(/outra conta/i);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.moradores.update).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('morador de outro condomínio responde 404', async () => {
    const { svc, prisma } = build({ morador: null });

    await expect(
      svc.corrigirEmailAcessoMorador(2, 50, { email: 'carlos@gmail.com', motivo: 'm' }, admin),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.moradores.findFirst.mock.calls[0][0].where).toEqual({ id: 50, id_condominio: 2 });
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('exige e-mail válido e motivo', async () => {
    const { svc, prisma } = build();

    await expect(
      svc.corrigirEmailAcessoMorador(1, 50, { email: 'sem-arroba', motivo: 'm' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.corrigirEmailAcessoMorador(1, 50, { email: { $ne: 1 } as any, motivo: 'm' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.corrigirEmailAcessoMorador(1, 50, { email: 'carlos@gmail.com', motivo: '   ' }, admin),
    ).rejects.toThrow(/motivo/i);
    await expect(
      svc.corrigirEmailAcessoMorador(1, 50, { email: 'carlos@gmail.com', motivo: 'x'.repeat(501) }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('morador sem conta: só atualiza Moradores.email', async () => {
    const { svc, prisma, auditoria } = build({
      morador: { id: 51, nome: 'Sem Conta', email: 'velho@x.com', id_user: 0, id_condominio: 1 },
    });

    const r = await svc.corrigirEmailAcessoMorador(1, 51, { email: 'novo@x.com', motivo: 'm' }, admin);

    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.moradores.update).toHaveBeenCalledWith({ where: { id: 51 }, data: { email: 'novo@x.com' } });
    expect(auditoria.registrar.mock.calls[0][0].detalhes).toMatchObject({ sessoes_encerradas: false });
    expect(r).toMatchObject({ contaAtualizada: false });
  });

  it('corrida com outra conta (unique do banco) vira 409, não 500', async () => {
    const { svc, prisma } = build();
    prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error('Unique'), { code: 'P2002' }));

    await expect(
      svc.corrigirEmailAcessoMorador(1, 50, { email: 'carlos@gmail.com', motivo: 'm' }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
