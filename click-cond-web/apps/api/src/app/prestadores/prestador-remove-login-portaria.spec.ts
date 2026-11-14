import { ForbiddenException } from '@nestjs/common';
import { PrestadoresController } from './prestadores.controller';
import { PrestadoresService } from './prestadores.service';

/**
 * Um morador gravava, pela rota POST do console, o login de um porteiro como e-mail do próprio prestador e
 * depois removia o prestador pelo app: o remove fazia deleteMany por e-mail e apagava a conta do porteiro.
 */
describe('Prestador × login de portaria — cadastro e remoção', () => {
  const morador = { sub: 10, nome: 'Morador', typeAccess: 'Morador' } as any;
  const porteiroConsole = { sub: 3, nome: 'Porteiro A', id_condominio: 1 } as any;
  // Conceder, mudar ou revogar o login de portaria (e remover quem o tem) é do síndico (A5).
  const sindicoConsole = { sub: 51, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' } as any;
  // Login de outro porteiro (tela de funcionários: turno livre, não 'Geral').
  const vitima = { id: 9, login: 'b@x.com', email: 'b@x.com', id_condominio: 1, turno: 'Diurno', password: '$2b$04$vitima' };
  // Login que o próprio prestador recebeu pelo cadastro de prestador.
  const proprio = { id: 12, login: 'p@x.com', email: 'p@x.com', id_condominio: 1, turno: 'Geral', password: '$2b$04$proprio' };
  // Login do prestador depois que ele trocou o próprio e-mail pelo app (updateInfosFuncionario leva os dois).
  const trocado = { id: 13, login: 'trocado@x.com', email: 'trocado@x.com', id_condominio: 1, turno: 'Geral', password: '$2b$04$trocado' };

  const casa = (valor: any, cond: any) => cond === undefined || valor === cond;

  function build(emailDoPrestador: string | null) {
    const prestador = { id: 1, id_condominio: 1, id_apartamento: null, face_id: null, email: emailDoPrestador, nome: 'Eletricista', telefone: null, foto_pessoa: null, foto_documento: null };
    const logins = [vitima, proprio, trocado];
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
          logins.find((l) => casa(l.login, where.login) && casa(l.email, where.email) && casa(l.id_condominio, where.id_condominio) && casa(l.turno, where.turno) && !(where.NOT && l.id === where.NOT.id)) ?? null,
        ),
        deleteMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
      users: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => ({ id: 9, ...data })), update: jest.fn(async () => ({})) },
      funcionarios: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})), update: jest.fn(async () => ({})), deleteMany: jest.fn(async () => ({ count: 0 })) },
    };
    // A revogação roda numa transação (aqui, de passagem: o callback recebe o próprio mock).
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn(), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const facial: any = { syncPrestadorServico: jest.fn(async () => ({})), unsyncPrestadorServico: jest.fn(async () => ({})) };
    return { svc: new PrestadoresService(prisma, storage, facial, tenant), prisma };
  }

  describe('PrestadoresController.create (console)', () => {
    const service: any = { create: jest.fn(async () => ({})) };
    const ctrl = new PrestadoresController(service);
    beforeEach(() => service.create.mockClear());

    it('NEGA morador cadastrar prestador pelo console', () => {
      expect(() => ctrl.create(1, { nome: 'X', email: 'b@x.com' } as any, morador)).toThrow(ForbiddenException);
      expect(service.create).not.toHaveBeenCalled();
    });

    it('PERMITE operador da portaria-web', async () => {
      await ctrl.create(1, { nome: 'X' } as any, porteiroConsole);
      expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ id_condominio: 1 }), porteiroConsole);
    });
  });

  it('create sem acesso pedido com e-mail = login de outro porteiro → 400 e nada é gravado', async () => {
    const { svc, prisma } = build(null);
    await expect(svc.create({ id_condominio: 1, nome: 'Novo', email: ' b@x.com ' } as any, porteiroConsole)).rejects.toThrow(
      'Já existe um funcionário com este e-mail.',
    );
    expect(prisma.prestadores_servico.create).not.toHaveBeenCalled();
  });

  it('remove de prestador cujo e-mail é o login de outro porteiro NÃO apaga esse login', async () => {
    const { svc, prisma } = build('b@x.com');
    await svc.remove(1, 1, porteiroConsole);
    expect(prisma.funcionarios_Portaria.deleteMany).not.toHaveBeenCalled();
    expect(prisma.prestadores_servico.delete).toHaveBeenCalled();
  });

  it('remove apaga só o login que o próprio prestador recebeu, pelo id', async () => {
    const { svc, prisma } = build('p@x.com');
    await svc.remove(1, 1, sindicoConsole);
    expect(prisma.funcionarios_Portaria.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.funcionarios_Portaria.deleteMany).toHaveBeenCalledWith({ where: { id: 12 } });
  });

  it('remove acha e apaga o login quando prestador e login estão no e-mail novo (troca feita pelo app)', async () => {
    const { svc, prisma } = build('trocado@x.com');
    await svc.remove(1, 1, sindicoConsole);
    expect(prisma.funcionarios_Portaria.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.funcionarios_Portaria.deleteMany).toHaveBeenCalledWith({ where: { id: 13 } });
  });

  it('revogar o acesso (hasPortariaAccess: false) não apaga o login de outro porteiro', async () => {
    const { svc, prisma } = build('b@x.com');
    await svc.update(1, { hasPortariaAccess: false }, 1, porteiroConsole);
    expect(prisma.funcionarios_Portaria.deleteMany).not.toHaveBeenCalled();
  });

  // Sem isto, o prestador ficava com o e-mail novo e o login dele com o antigo: inalcançável para
  // re-credenciar, revogar e remover (todos acham o login pelo e-mail gravado no prestador).
  // Rodada 2: login E e-mail vão juntos (o app acha o login por qualquer dos dois) e a troca exige senha nova.
  it('trocar o e-mail sem a flag leva junto o login de portaria do próprio prestador (login, e-mail e senha nova)', async () => {
    const { svc, prisma } = build('p@x.com');
    await svc.update(1, { email: ' novo@x.com ', senha: 'Nova#123' }, 1, sindicoConsole);
    expect(prisma.prestadores_servico.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'novo@x.com' }) }),
    );
    expect(prisma.funcionarios_Portaria.update).toHaveBeenCalledTimes(1);
    expect(prisma.funcionarios_Portaria.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { login: 'novo@x.com', email: 'novo@x.com', password: expect.stringMatching(/^\$2/) },
    });
    expect(prisma.funcionarios_Portaria.deleteMany).not.toHaveBeenCalled();
    expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
  });

  // E-mail só com espaços é "sem e-mail": nunca vira login '' nem fica gravado como ''.
  it.each([[''], ['   ']])('create com e-mail %p e acesso pedido não cria login e grava e-mail null', async (email) => {
    const { svc, prisma } = build(null);
    await svc.create({ id_condominio: 1, nome: 'Novo', email, hasPortariaAccess: true, senha: 'Escolhida#1' } as any, sindicoConsole);
    expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
    expect(prisma.prestadores_servico.create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: null }) });
  });

  it.each([[''], ['   ']])('limpar o e-mail com %p revoga o login do próprio prestador, como email: null', async (email) => {
    const { svc, prisma } = build('p@x.com');
    await svc.update(1, { email }, 1, sindicoConsole);
    expect(prisma.prestadores_servico.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: null }) }),
    );
    expect(prisma.funcionarios_Portaria.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.funcionarios_Portaria.deleteMany).toHaveBeenCalledWith({ where: { id: 12 } });
    expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
  });
});
