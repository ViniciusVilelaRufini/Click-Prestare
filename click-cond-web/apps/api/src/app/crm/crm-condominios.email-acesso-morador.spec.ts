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

  type Vinculos = Partial<
    Record<'moradores' | 'sindicos' | 'sindicos_Condominios' | 'funcionarios' | 'funcionarios_Portaria' | 'apartamentos_Users', number>
  >;

  function build(opts?: { morador?: any; conflito?: any; vinculos?: Vinculos }) {
    const vinculos = opts?.vinculos ?? {};
    const contador = (tabela: keyof Vinculos) => jest.fn(async () => vinculos[tabela] ?? 0);
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
        count: contador('moradores'),
      },
      sindicos: { count: contador('sindicos') },
      sindicos_Condominios: { count: contador('sindicos_Condominios') },
      funcionarios: { count: contador('funcionarios') },
      funcionarios_Portaria: { count: contador('funcionarios_Portaria') },
      apartamentos_Users: { count: contador('apartamentos_Users') },
      redefinicoes_Senha: { updateMany: jest.fn(async () => ({ count: 1 })) },
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

  // ── Revisão C1: conta com outro cadastro ──
  // O saveMorador reaproveita a Users pelo e-mail/CPF: morador cadastrado com
  // o e-mail da esposa fica ligado à conta dela. "Corrigir" mudaria o login
  // DELA, e o marido entraria pela "Esqueci a senha" — inclusive como síndica
  // de outro prédio.
  describe.each<[string, Vinculos]>([
    ['outro cadastro de morador com a mesma conta', { moradores: 1 }],
    ['síndico (Sindicos)', { sindicos: 1 }],
    ['síndico de algum condomínio (Sindicos_Condominios)', { sindicos_Condominios: 1 }],
    ['funcionário do app (Funcionarios)', { funcionarios: 1 }],
    ['funcionário da portaria com o mesmo login', { funcionarios_Portaria: 1 }],
    ['unidade em outro condomínio (Apartamentos_Users)', { apartamentos_Users: 1 }],
  ])('recusa quando a conta também é %s', (_nome, vinculos) => {
    it('409 com a mensagem do titular, sem gravar nada', async () => {
      const { svc, prisma, auditoria } = build({ vinculos });

      const p = svc.corrigirEmailAcessoMorador(1, 50, { email: 'carlos@gmail.com', motivo: 'm' }, admin);
      await expect(p).rejects.toBeInstanceOf(ConflictException);
      await expect(
        svc.corrigirEmailAcessoMorador(1, 50, { email: 'carlos@gmail.com', motivo: 'm' }, admin),
      ).rejects.toThrow(/também é usado por outro cadastro/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(prisma.moradores.update).not.toHaveBeenCalled();
      expect(auditoria.registrar).not.toHaveBeenCalled();
    });
  });

  it('confere o outro cadastro de morador excluindo esta linha, e a portaria pelo login e pelo e-mail da conta', async () => {
    const { svc, prisma } = build();

    await svc.corrigirEmailAcessoMorador(1, 50, { email: 'carlos@gmail.com', motivo: 'm' }, admin);

    const wheresMoradores = prisma.moradores.count.mock.calls.map((c: any[]) => c[0].where);
    expect(wheresMoradores).toContainEqual({ id_user: 70, id: { not: 50 } });
    expect(prisma.sindicos.count.mock.calls[0][0].where).toEqual({ id_user: 70 });
    expect(prisma.funcionarios.count.mock.calls.map((c: any[]) => c[0].where)).toContainEqual({ id_user: 70 });
    expect(prisma.funcionarios_Portaria.count.mock.calls[0][0].where).toEqual({
      login: { in: ['carlos@gmial.com'] },
    });
  });

  // ── Revisão M1: links de "Esqueci a senha" pendentes ──
  it('invalida, na mesma transação, os pedidos de redefinição pendentes da conta (morador e síndico)', async () => {
    const { svc, prisma } = build();

    await svc.corrigirEmailAcessoMorador(1, 50, { email: 'carlos@gmail.com', motivo: 'm' }, admin);

    expect(prisma.redefinicoes_Senha.updateMany).toHaveBeenCalledTimes(1);
    const arg = prisma.redefinicoes_Senha.updateMany.mock.calls[0][0];
    // 'funcionario' fica de fora: lá id_conta é Funcionarios_Portaria.id.
    expect(arg.where).toEqual({ id_conta: 70, papel: { in: ['morador', 'sindico'] }, usado_em: null });
    expect(arg.data.usado_em).toBeInstanceOf(Date);
    const ops = prisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(3);
  });

  // ── Revisão M2: morador sem conta também não pega e-mail de outra conta ──
  it('morador sem conta: recusa e-mail que já é de uma conta', async () => {
    const { svc, prisma } = build({
      morador: { id: 51, nome: 'Sem Conta', email: 'velho@x.com', id_user: 0, id_condominio: 1 },
      conflito: { id: 99 },
    });

    await expect(
      svc.corrigirEmailAcessoMorador(1, 51, { email: 'joao@gmail.com', motivo: 'm' }, admin),
    ).rejects.toThrow(/outra conta/i);
    expect(prisma.users.findFirst.mock.calls[0][0].where).toEqual({
      OR: [{ email: 'joao@gmail.com' }, { login: 'joao@gmail.com' }],
    });
    expect(prisma.moradores.update).not.toHaveBeenCalled();
  });
});
