import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';

/**
 * Rodada 4 (raia e), item 2 — o fallback do loginFuncionario recria o vínculo de equipe (Funcionarios) no primeiro
 * login do app quando só existe o login de portaria (troca de e-mail sem a chave no cadastro do prestador, conta
 * nova depois de revogar). Antes nascia sempre com as 8 permissões ligadas; agora, se o login é de um prestador
 * deste condomínio (mesmo critério do cadastro: e-mail + turno 'Geral' ou mesmo nome) e ele tem permissões
 * guardadas na revogação, valem elas.
 */
describe('loginFuncionario — fallback usa as permissões guardadas no prestador', () => {
  const flags = { areas_sociais: 1, comunicados: 0, ocorrencias: 1, manutencoes_programadas: 0, prestadores_servico: 1, agendar_mudanca: 0, cadastrar_visitante: 1, apartamentos: 0 };
  const todas = { areas_sociais: 1, comunicados: 1, ocorrencias: 1, manutencoes_programadas: 1, prestadores_servico: 1, agendar_mudanca: 1, cadastrar_visitante: 1, apartamentos: 1 };
  const hash = bcrypt.hashSync('Senha#123', 4);
  const portaria = { id: 12, login: 'b@x.com', email: 'b@x.com', telefone: null, turno: 'Geral', password: hash, id_condominio: 1, nome: 'Eletricista', condominio: { ativo: 1 } };

  function build(prestadores: any) {
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 40, photo: null, ...data, funcionarios: [] })),
        update: jest.fn(async () => ({})),
      },
      funcionarios_Portaria: { findFirst: jest.fn(async () => ({ ...portaria })), update: jest.fn(async () => ({})) },
      funcionarios: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        count: jest.fn(async () => 0),
      },
      prestadores_servico: {
        findMany: typeof prestadores === 'function' ? jest.fn(prestadores) : jest.fn(async () => prestadores),
      },
    };
    const svc = new MobileAuthService(prisma, { sign: jest.fn(() => 't') } as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it('login do prestador com permissões guardadas: o vínculo e o token nascem com elas', async () => {
    const { svc, prisma } = build([{ id: 1, nome: 'Eletricista', email: 'b@x.com', permissoes_app_salvas: JSON.stringify(flags) }]);
    const r = await svc.loginFuncionario('b@x.com', 'Senha#123');
    expect(prisma.prestadores_servico.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id_condominio: 1, email: 'b@x.com' }) }),
    );
    expect(prisma.funcionarios.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_condominio: 1, ...flags }) });
    expect(r.user).toEqual(expect.objectContaining(flags));
  });

  it.each([
    ['sem prestador com esse e-mail', []],
    ['prestador com o e-mail mas o login é de outra pessoa (turno e nome diferentes)', [{ id: 1, nome: 'Outro', email: 'b@x.com', permissoes_app_salvas: JSON.stringify(flags) }]],
    ['prestador sem nada guardado', [{ id: 1, nome: 'Eletricista', email: 'b@x.com', permissoes_app_salvas: null }]],
    ['JSON guardado inválido', [{ id: 1, nome: 'Eletricista', email: 'b@x.com', permissoes_app_salvas: '{"ocorrencias":2}' }]],
  ])('%s: todas ligadas, como antes', async (_n, prestadores) => {
    const { svc, prisma } = build(prestadores);
    if (_n.startsWith('prestador com o e-mail')) prisma.funcionarios_Portaria.findFirst.mockResolvedValue({ ...portaria, turno: 'Diurno' });
    const r = await svc.loginFuncionario('b@x.com', 'Senha#123');
    expect(prisma.funcionarios.create).toHaveBeenCalledWith({ data: expect.objectContaining(todas) });
    expect(r.user).toEqual(expect.objectContaining(todas));
  });

  it('falha ao ler as permissões guardadas não impede o login (todas ligadas)', async () => {
    const { svc, prisma } = build(async () => {
      throw new Error('Unknown column permissoes_app_salvas');
    });
    const r = await svc.loginFuncionario('b@x.com', 'Senha#123');
    expect(prisma.funcionarios.create).toHaveBeenCalledWith({ data: expect.objectContaining(todas) });
    expect(r.token).toBe('t');
  });
});
