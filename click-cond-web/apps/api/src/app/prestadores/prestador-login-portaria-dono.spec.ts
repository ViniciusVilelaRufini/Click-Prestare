import * as bcrypt from 'bcrypt';
import { PrestadoresService } from './prestadores.service';

/**
 * O login de portaria do prestador era escolhido só pelo e-mail (login IN [antigo, novo] + condomínio):
 * gravar como e-mail o login de um colega e depois pedir o acesso com senha sobrescrevia a senha do colega.
 */
describe('PrestadoresService.update — só o login de portaria do próprio prestador', () => {
  const porteiroConsole = { sub: 3, nome: 'Porteiro A', id_condominio: 1 } as any;
  // Pedir/re-credenciar o login de portaria é do síndico (A5).
  const sindicoConsole = { sub: 51, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' } as any;
  // Login de outro porteiro, criado pela tela de funcionários (turno livre, não 'Geral').
  const vitima = { id: 9, login: 'b@x.com', email: 'b@x.com', id_condominio: 1, turno: 'Diurno', nome: 'Porteiro B', telefone: null, ativo: 1, password: '$2b$04$vitima' };
  // Login que o próprio prestador recebeu pelo cadastro de prestador (turno 'Geral').
  const proprio = { id: 12, login: 'p@x.com', email: 'p@x.com', id_condominio: 1, turno: 'Geral', nome: 'Eletricista', telefone: null, ativo: 1, password: '$2b$04$proprio' };

  // O mock respeita login (string ou { in }), id_condominio e turno — o código antigo busca com { in }.
  const casa = (valor: any, cond: any) =>
    cond === undefined || (cond && typeof cond === 'object' && Array.isArray(cond.in) ? cond.in.includes(valor) : valor === cond);

  function build(emailDoPrestador: string | null) {
    const prestador = { id: 1, id_condominio: 1, id_apartamento: null, email: emailDoPrestador, nome: 'Eletricista', telefone: null, foto_pessoa: null, foto_documento: null };
    const logins = [vitima, proprio];
    const prisma: any = {
      isConnected: true,
      prestadores_servico: {
        findUnique: jest.fn(async () => ({ ...prestador })),
        update: jest.fn(async ({ data }: any) => ({ ...prestador, ...data })),
      },
      funcionarios_Portaria: {
        findFirst: jest.fn(async ({ where }: any) =>
          logins.find((l) => casa(l.login, where.login) && casa(l.id_condominio, where.id_condominio) && casa(l.turno, where.turno)) ?? null,
        ),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      // As contas dos porteiros são da equipe deste condomínio: assertContaLivreParaPortaria passa (é o caso do achado).
      users: { findFirst: jest.fn(async () => ({ id: 5 })), create: jest.fn(), update: jest.fn(async () => ({})) },
      funcionarios: { findFirst: jest.fn(async () => ({ id: 1 })), create: jest.fn(), update: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      // Re-credenciar com senha pergunta se a conta é só de equipe (aí a senha do app acompanha a nova).
      sindicos: { count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      moradores: { count: jest.fn(async () => 0) },
      apartamentos_Users: { count: jest.fn(async () => 0) },
    };
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn(), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const facial: any = { syncPrestadorServico: jest.fn(async () => ({})) };
    return { svc: new PrestadoresService(prisma, storage, facial, tenant), prisma };
  }

  it.each([['b@x.com'], ['  b@x.com  ']])(
    'trocar o e-mail (sem pedir acesso) para o login de outro porteiro (%p) → 400 e nada é gravado',
    async (email) => {
      const { svc, prisma } = build(null);
      await expect(svc.update(1, { email }, 1, porteiroConsole)).rejects.toThrow('Já existe um funcionário com este e-mail.');
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    },
  );

  it('pedir acesso quando o e-mail atual já é o login de outro porteiro → 400; a senha dele não muda', async () => {
    const { svc, prisma } = build('b@x.com');
    await expect(svc.update(1, { hasPortariaAccess: true, senha: 'Nova#123' }, 1, sindicoConsole)).rejects.toThrow(
      'Já existe um funcionário com este e-mail.',
    );
    expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
    expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
    expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
  });

  it('re-credenciar o login do próprio prestador continua funcionando', async () => {
    const { svc, prisma } = build('p@x.com');
    await svc.update(1, { hasPortariaAccess: true, senha: 'Nova#123' }, 1, sindicoConsole);
    const chamada = prisma.funcionarios_Portaria.update.mock.calls[0][0];
    expect(chamada.where).toEqual({ id: 12 });
    expect(await bcrypt.compare('Nova#123', chamada.data.password)).toBe(true);
  });

  it('trocar para um e-mail livre continua funcionando', async () => {
    const { svc, prisma } = build(null);
    await svc.update(1, { email: 'livre@x.com' }, 1, porteiroConsole);
    expect(prisma.prestadores_servico.update.mock.calls[0][0].data.email).toBe('livre@x.com');
  });
});
