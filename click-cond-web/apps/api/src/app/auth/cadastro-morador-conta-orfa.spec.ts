import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';

/**
 * R2: saveMorador (morador pela equipe e familiar pelo proprietário no app) achava a conta por e-mail OU CPF
 * e, sem vínculo em outro condomínio, a adotava mantendo a senha. Quem tinha o CPF de um futuro familiar
 * criava a conta no /sindico/signup e herdava a unidade, o QR do portão e a portaria remota.
 * Agora: conta achada só pelo CPF → 400; conta órfã achada pelo e-mail → senha nova ao e-mail da conta,
 * sessões derrubadas e credenciais revogadas (common/adocao-conta.util).
 */
describe('saveMorador — conta órfã do signup não é adotada sem prova de posse', () => {
  const CPF = '52998224725';
  const MSG_CPF = 'Já existe uma conta com este CPF. Use o e-mail da conta existente ou fale com o suporte.';
  const SENHA_DO_ATACANTE = 'senhaDoAtacante';
  let hashDoAtacante: string;
  beforeAll(async () => {
    hashDoAtacante = await bcrypt.hash(SENHA_DO_ATACANTE, 4);
  });
  const sindico = { sub: 1, nome: 'Síndico A', typeAccess: 'Sindico' } as any;
  const orfa = () => ({ id: 70, cpf: CPF, email: 'vitima@x.com', login: 'vitima@x.com', password: hashDoAtacante, name: 'Vítima', phone: null });

  // 'pendente' = síndico do condomínio de autocadastro 99 (ativo = 0, aprovado_em nulo); 'outro-ativo' = já aprovado.
  function montar(conta: any, vinculo: 'nenhum' | 'aqui' | 'pendente' | 'outro-ativo' = 'nenhum') {
    const contar = jest.fn(async ({ where }: any) => {
      if (vinculo !== 'aqui') return 0;
      const c = where.id_condominio ?? where.apartamento?.id_condominio;
      return c?.not !== undefined ? 0 : 1;
    });
    const contarSindico = jest.fn(async ({ where }: any) => {
      if (vinculo === 'aqui') return contar({ where });
      if (vinculo === 'nenhum') return 0;
      if (where.id_condominio !== undefined && where.id_condominio?.not === undefined) return 0;
      return vinculo === 'pendente' && where.condominio?.NOT ? 0 : 1;
    });
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async () => ({ id: 11, id_condominio: 1, bloco: 'A', apto: '101' })) },
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
        count: contar,
        findMany: jest.fn(async () => [{ id: 12 }]),
      },
      users: {
        findFirst: jest.fn(async () => ({ ...conta })),
        create: jest.fn(),
        update: jest.fn(async () => ({})),
      },
      apartamentos_Users: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})), count: contar },
      sindicos_Condominios: { count: contarSindico },
      funcionarios: { count: contar },
      funcionarios_Portaria: { findFirst: jest.fn(async () => null) },
      credenciais_Acesso: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const superlogica: any = { enviarMorador: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, { sign: jest.fn() } as any, mail, storage, {} as any, tenant, {} as any, {} as any, {} as any, superlogica);
    return { svc, prisma, mail };
  }

  const corpo = (extra: any = {}) => ({
    morador: { nome: 'Vítima', documento: CPF, email: 'vitima@x.com', data_nascimento: '01/01/1990', id_apto: 11, sendCredentials: false, ...extra },
  });

  it('conta órfã achada pelo e-mail: senha do atacante deixa de valer, sessões caem, credenciais revogadas, senha nova no e-mail da conta', async () => {
    const { svc, prisma, mail } = montar(orfa());
    await svc.saveMorador(corpo(), false, sindico);

    const escrita = prisma.users.update.mock.calls.find(([a]: any) => a.where.id === 70 && a.data.password);
    expect(escrita).toBeDefined();
    const data = escrita[0].data;
    expect(await bcrypt.compare(SENHA_DO_ATACANTE, data.password)).toBe(false);
    expect(data.senha_alterada_em).toBeInstanceOf(Date);
    expect(prisma.credenciais_Acesso.updateMany).toHaveBeenCalledWith({
      where: { tipo_pessoa: 'morador', id_pessoa: { in: [12] }, revogada_em: null },
      data: { revogada_em: expect.any(Date) },
    });
    // Mesmo com sendCredentials: false — é a única forma de o dono entrar.
    expect(mail.sendWelcomeMorador).toHaveBeenCalledTimes(1);
    const [destino, , senha] = mail.sendWelcomeMorador.mock.calls[0];
    expect(destino).toBe('vitima@x.com');
    expect(await bcrypt.compare(senha, data.password)).toBe(true);
    expect(prisma.apartamentos_Users.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_apto: 11, id_user: 70 }) });
  });

  it('conta órfã e invalidação da posse que falha: nada é ligado (nem unidade nem cadastro)', async () => {
    const { svc, prisma, mail } = montar(orfa());
    prisma.credenciais_Acesso.updateMany.mockRejectedValue(new Error('banco caiu'));
    await expect(svc.saveMorador(corpo(), false, sindico)).rejects.toThrow('banco caiu');
    expect(prisma.apartamentos_Users.create).not.toHaveBeenCalled();
    expect(prisma.moradores.create).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it.each([
    ['cadastro sem e-mail (familiar menor/sem e-mail)', { email: undefined }],
    ['cadastro com outro e-mail', { email: 'atacante@x.com' }],
  ])('conta achada só pelo CPF → 400, nada gravado (%s)', async (_nome, extra) => {
    const { svc, prisma, mail } = montar(orfa());
    await expect(svc.saveMorador(corpo(extra), false, sindico)).rejects.toThrow(MSG_CPF);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.apartamentos_Users.create).not.toHaveBeenCalled();
    expect(prisma.moradores.create).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it('conta só com CPF (sem e-mail) achada pelo CPF de cadastro com e-mail → 400 (não grava o e-mail de quem cadastra)', async () => {
    const { svc, prisma } = montar({ ...orfa(), email: null, login: null, password: null });
    await expect(svc.saveMorador(corpo({ email: 'atacante@x.com' }), false, sindico)).rejects.toThrow(MSG_CPF);
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  // Achado da revisão: signup + POST /mobile-auth/register (condomínio pendente) tirava a conta da regra da órfã.
  it('signup + condomínio pendente: adotada como órfã (não mais 400 de "outro condomínio")', async () => {
    const { svc, prisma, mail } = montar(orfa(), 'pendente');
    await svc.saveMorador(corpo(), false, sindico);
    const escrita = prisma.users.update.mock.calls.find(([a]: any) => a.where.id === 70 && a.data.password);
    expect(escrita).toBeDefined();
    expect(await bcrypt.compare(SENHA_DO_ATACANTE, escrita[0].data.password)).toBe(false);
    expect(escrita[0].data.senha_alterada_em).toBeInstanceOf(Date);
    expect(prisma.credenciais_Acesso.updateMany).toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).toHaveBeenCalledWith('vitima@x.com', 'Vítima', expect.any(String));
    expect(prisma.apartamentos_Users.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_user: 70 }) });
  });

  it('controle: síndico de outro condomínio aprovado continua recusado', async () => {
    const { svc, prisma } = montar(orfa(), 'outro-ativo');
    await expect(svc.saveMorador(corpo(), false, sindico)).rejects.toThrow('Fale com o suporte para vincular a unidade.');
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('conta já vinculada neste condomínio: senha e sessões intactas (comportamento de antes)', async () => {
    const { svc, prisma, mail } = montar(orfa(), 'aqui');
    await svc.saveMorador(corpo({ sendCredentials: true }), false, sindico);
    for (const [a] of prisma.users.update.mock.calls) {
      expect(a.data.password).toBeUndefined();
      expect(a.data.senha_alterada_em).toBeUndefined();
    }
    expect(prisma.credenciais_Acesso.updateMany).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMoradorExisting).toHaveBeenCalledWith('vitima@x.com', 'Vítima');
  });

  it('conta do próprio solicitante (achada só pelo CPF): continua sendo ligada, sem tocar a senha', async () => {
    const { svc, prisma } = montar({ ...orfa(), id: 1 });
    await svc.saveMorador(corpo({ email: undefined }), false, sindico);
    expect(prisma.apartamentos_Users.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_user: 1 }) });
    for (const [a] of prisma.users.update.mock.calls) expect(a.data.password).toBeUndefined();
    expect(prisma.credenciais_Acesso.updateMany).not.toHaveBeenCalled();
  });
});
