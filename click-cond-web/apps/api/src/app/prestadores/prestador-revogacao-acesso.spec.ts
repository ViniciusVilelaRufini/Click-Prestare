import { ForbiddenException } from '@nestjs/common';
import { PrestadoresService } from './prestadores.service';

/**
 * A4 — Desligar o "Acesso Portaria Web" (ou remover o prestador) apagava só a linha Funcionarios_Portaria. A conta
 * Users e o vínculo Funcionarios criados na concessão ficavam: o ex-funcionário seguia entrando no app como
 * Funcionário (token de 365 dias) e voltava ao console pelo QR Code. Revogar tem de tirar o vínculo de equipe deste
 * condomínio e derrubar os tokens (senha_alterada_em) — sem NUNCA apagar a conta Users, que pode ser do mesmo e-mail
 * de um síndico ou morador (a exclusão cascatearia).
 *
 * A5 — Conceder, mudar ou revogar esse login e remover o prestador que o tem é do síndico, como no app
 * (mobile-auth: "um porteiro não deveria conseguir criar/editar outro porteiro"). Editar o prestador sem mexer no
 * login continua com a portaria.
 */
describe('Prestador × login de portaria — revogação e alçada do síndico', () => {
  const sindico = { sub: 51, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' } as any;
  const porteiro = { sub: 3, nome: 'Porteiro A', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' } as any;
  const porteiroTurnoSindico = { sub: 4, nome: 'João', id_condominio: 1, turno: 'Síndico', tipo_sub: 'funcionario_portaria' } as any;
  const funcionarioQr = { sub: 20, nome: 'Func', id_condominio: 1, typeAccess: 'Funcionario', turno: 'Porteiro (App)' } as any;

  // Login que o próprio prestador recebeu pelo cadastro de prestador (turno 'Geral').
  const proprio = { id: 12, login: 'p@x.com', email: 'p@x.com', id_condominio: 1, turno: 'Geral', nome: 'Eletricista', telefone: null, ativo: 1, password: '$2b$04$proprio' };
  const casa = (valor: any, cond: any) => cond === undefined || valor === cond;

  function build(emailDoPrestador: string | null, opts: { conta?: any } = {}) {
    const prestador = { id: 1, id_condominio: 1, id_apartamento: null, face_id: null, email: emailDoPrestador, nome: 'Eletricista', telefone: null, foto_pessoa: null, foto_documento: null };
    const logins = [proprio];
    const conta = opts.conta === undefined ? { id: 5 } : opts.conta;
    const prisma: any = {
      isConnected: true,
      prestadores_servico: {
        findUnique: jest.fn(async () => ({ ...prestador })),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 2, ...data })),
        update: jest.fn(async ({ data }: any) => ({ ...prestador, ...data })),
        delete: jest.fn(async () => ({})),
      },
      funcionarios_Portaria: {
        findFirst: jest.fn(async ({ where }: any) =>
          logins.find((l) => casa(l.login, where.login) && casa(l.id_condominio, where.id_condominio) && casa(l.turno, where.turno)) ?? null,
        ),
        deleteMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
      users: {
        findFirst: jest.fn(async () => conta),
        create: jest.fn(async ({ data }: any) => ({ id: 9, ...data })),
        update: jest.fn(async () => ({})),
        delete: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      funcionarios: {
        // A conta do login é da equipe deste condomínio (foi a concessão que criou o vínculo).
        findFirst: jest.fn(async () => (conta ? { id: 77 } : null)),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn(), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const facial: any = { syncPrestadorServico: jest.fn(async () => ({})), unsyncPrestadorServico: jest.fn(async () => ({})) };
    return { svc: new PrestadoresService(prisma, storage, facial, tenant), prisma };
  }

  function esperaRevogacaoCompleta(prisma: any) {
    expect(prisma.funcionarios_Portaria.deleteMany).toHaveBeenCalledWith({ where: { id: 12 } });
    expect(prisma.funcionarios.deleteMany).toHaveBeenCalledWith({ where: { id_user: 5, id_condominio: 1 } });
    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { senha_alterada_em: expect.any(Date) },
    });
    // A conta nunca é apagada: o mesmo e-mail pode ser de um síndico ou morador.
    expect(prisma.users.delete).not.toHaveBeenCalled();
    expect(prisma.users.deleteMany).not.toHaveBeenCalled();
  }

  describe('A4 — revogar tira de fato o acesso', () => {
    it('desligar a chave (hasPortariaAccess: false) apaga o login, o vínculo Funcionarios do condomínio e derruba os tokens', async () => {
      const { svc, prisma } = build('p@x.com');
      await svc.update(1, { hasPortariaAccess: false }, 1, sindico);
      esperaRevogacaoCompleta(prisma);
    });

    it('remover o prestador faz a mesma revogação', async () => {
      const { svc, prisma } = build('p@x.com');
      await svc.remove(1, 1, sindico);
      esperaRevogacaoCompleta(prisma);
      expect(prisma.prestadores_servico.delete).toHaveBeenCalled();
    });

    it('limpar o e-mail (que também revoga o login) faz a mesma revogação', async () => {
      const { svc, prisma } = build('p@x.com');
      await svc.update(1, { email: null }, 1, sindico);
      esperaRevogacaoCompleta(prisma);
    });

    it('sem conta de app com aquele login: apaga só o login de portaria, sem erro', async () => {
      const { svc, prisma } = build('p@x.com', { conta: null });
      await svc.update(1, { hasPortariaAccess: false }, 1, sindico);
      expect(prisma.funcionarios_Portaria.deleteMany).toHaveBeenCalledWith({ where: { id: 12 } });
      expect(prisma.funcionarios.deleteMany).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('prestador sem login próprio: revogar não mexe em Funcionarios nem em Users', async () => {
      const { svc, prisma } = build('outro@x.com');
      await svc.update(1, { hasPortariaAccess: false }, 1, sindico);
      expect(prisma.funcionarios_Portaria.deleteMany).not.toHaveBeenCalled();
      expect(prisma.funcionarios.deleteMany).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('falha ao revogar no remove: o prestador não é apagado (o login não fica órfão)', async () => {
      const { svc, prisma } = build('p@x.com');
      prisma.funcionarios.deleteMany.mockRejectedValueOnce(new Error('banco caiu'));
      await expect(svc.remove(1, 1, sindico)).rejects.toThrow();
      expect(prisma.prestadores_servico.delete).not.toHaveBeenCalled();
    });
  });

  describe('A5 — login de portaria é do síndico', () => {
    it.each([
      ['porteiro de login/senha', porteiro],
      ['porteiro com turno "Síndico" escrito no cadastro', porteiroTurnoSindico],
      ['funcionário no console por QR', funcionarioQr],
    ])('%s não cadastra prestador com acesso à portaria', async (_n, quem) => {
      const { svc, prisma } = build(null);
      await expect(
        svc.create({ id_condominio: 1, nome: 'Novo', email: 'novo@x.com', hasPortariaAccess: true, senha: 'Senha#123' } as any, quem),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.create).not.toHaveBeenCalled();
      expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
    });

    it('síndico cadastra prestador com acesso à portaria', async () => {
      const { svc, prisma } = build(null);
      prisma.users.findFirst.mockResolvedValue(null);
      await svc.create({ id_condominio: 1, nome: 'Novo', email: 'novo@x.com', hasPortariaAccess: true, senha: 'Senha#123' } as any, sindico);
      expect(prisma.funcionarios_Portaria.create).toHaveBeenCalled();
    });

    it('porteiro não concede o acesso pela edição', async () => {
      const { svc, prisma } = build('novo@x.com');
      await expect(svc.update(1, { hasPortariaAccess: true, senha: 'Senha#123' }, 1, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
      expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
    });

    it('porteiro não troca a senha de um login existente', async () => {
      const { svc, prisma } = build('p@x.com');
      await expect(svc.update(1, { hasPortariaAccess: true, senha: 'Outra#123' }, 1, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
    });

    it('porteiro não revoga o acesso de um colega', async () => {
      const { svc, prisma } = build('p@x.com');
      await expect(svc.update(1, { hasPortariaAccess: false }, 1, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.funcionarios_Portaria.deleteMany).not.toHaveBeenCalled();
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    });

    it('porteiro não troca o e-mail (que é o login) de quem tem acesso', async () => {
      const { svc, prisma } = build('p@x.com');
      await expect(svc.update(1, { email: 'meu@x.com' }, 1, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
      expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
    });

    it('porteiro não remove o prestador que tem login', async () => {
      const { svc, prisma } = build('p@x.com');
      await expect(svc.remove(1, 1, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.delete).not.toHaveBeenCalled();
      expect(prisma.funcionarios_Portaria.deleteMany).not.toHaveBeenCalled();
    });

    it('porteiro edita o prestador que tem login sem mexer no acesso (console antigo manda a chave como está)', async () => {
      const { svc, prisma } = build('p@x.com');
      await svc.update(1, { nome: 'Eletricista 24h', email: 'p@x.com', hasPortariaAccess: true, senha: '' }, 1, porteiro);
      expect(prisma.prestadores_servico.update).toHaveBeenCalled();
    });

    it('porteiro edita e remove prestador sem login como antes', async () => {
      const { svc, prisma } = build(null);
      await svc.update(1, { nome: 'Jardineiro', hasPortariaAccess: false }, 1, porteiro);
      expect(prisma.prestadores_servico.update).toHaveBeenCalled();
      await svc.remove(1, 1, porteiro);
      expect(prisma.prestadores_servico.delete).toHaveBeenCalled();
    });
  });
});
