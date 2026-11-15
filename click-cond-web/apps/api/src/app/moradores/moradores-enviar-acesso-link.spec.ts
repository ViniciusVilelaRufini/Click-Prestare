import { BadRequestException } from '@nestjs/common';
import { MoradoresService } from './moradores.service';

/**
 * Rodada 4, item 1: "Enviar Acesso".
 * - Conta que já tem senha: não gera senha nova nem derruba sessões; manda o link de redefinição
 *   pelo mecanismo do "Esqueci a senha" (MobileAuthService.solicitarRedefinicaoSenha, papel morador).
 * - Conta sem senha: cria/define a credencial inicial e envia, como antes.
 * - Sem data de nascimento: recusa (regra de menores).
 */
describe('MoradoresService.sendCredentials — link para quem já tem senha', () => {
  const ADULTO = new Date('1980-04-19');

  function harness(opts: {
    morador?: Record<string, unknown>;
    conta?: Record<string, unknown> | null;
    cadastrosComOEmail?: number;
    linksNaUltimaHora?: number;
    contaAchadaPeloEmail?: Record<string, unknown> | null;
  } = {}) {
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn().mockResolvedValue(opts.conta === undefined ? { email: 'bia@x.com', login: 'bia@x.com', password: '$2b$hash' } : opts.conta),
        findFirst: jest.fn().mockResolvedValue(opts.contaAchadaPeloEmail ?? null),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 51 }),
      },
      moradores: {
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn(async ({ where }: any) => (where?.email ? (opts.cadastrosComOEmail ?? 1) : 0)),
      },
      redefinicoes_Senha: { count: jest.fn().mockResolvedValue(opts.linksNaUltimaHora ?? 0) },
      funcionarios_Portaria: { count: jest.fn().mockResolvedValue(0) },
      sindicos_Condominios: { count: jest.fn().mockResolvedValue(0) },
      funcionarios: { count: jest.fn().mockResolvedValue(0) },
      apartamentos_Users: { count: jest.fn().mockResolvedValue(0) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn().mockResolvedValue({}), sendWelcomeMoradorExisting: jest.fn() };
    const auditoria: any = { registrar: jest.fn().mockResolvedValue({}) };
    const mobileAuth: any = { solicitarRedefinicaoSenha: jest.fn().mockResolvedValue({ success: true, message: 'ok' }) };
    const service = new MoradoresService(prisma, mail, {} as any, {} as any, auditoria, {} as any, undefined, mobileAuth);
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 5, nome: 'Bia', email: 'bia@x.com', id_user: 50, id_condominio: 1, data_nascimento: ADULTO,
      ...opts.morador,
    } as any);
    jest.spyOn(service as any, 'carregarContextoMorador').mockResolvedValue(null);
    return { service, prisma, mail, mobileAuth, auditoria };
  }

  it('conta com senha: manda o link de redefinição e não troca a senha nem derruba as sessões', async () => {
    const { service, prisma, mail, mobileAuth } = harness();

    const res = await service.sendCredentials(5);

    expect(res).toMatchObject({ ok: true, modo: 'link' });
    expect(mobileAuth.solicitarRedefinicaoSenha).toHaveBeenCalledWith('bia@x.com', 'morador');
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it('conta com senha e e-mail do cadastro diferente do login: o link vai para o login da conta', async () => {
    const { service, mobileAuth } = harness({
      morador: { email: 'outro@x.com' },
      conta: { email: 'bia@x.com', login: 'Bia@X.com', password: '$2b$hash' },
    });

    await service.sendCredentials(5);

    expect(mobileAuth.solicitarRedefinicaoSenha).toHaveBeenCalledWith('bia@x.com', 'morador');
  });

  it('nenhum cadastro de morador usa o e-mail de acesso: recusa explicando o que corrigir (o link sairia em silêncio)', async () => {
    const { service, mobileAuth } = harness({
      morador: { email: 'outro@x.com' },
      cadastrosComOEmail: 0,
    });

    const erro = await service.sendCredentials(5).catch((e) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toContain('bia@x.com');
    expect(mobileAuth.solicitarRedefinicaoSenha).not.toHaveBeenCalled();
  });

  it('limite de 3 links por hora já atingido: recusa em vez de dizer que enviou', async () => {
    const { service, mobileAuth } = harness({ linksNaUltimaHora: 3 });

    const erro = await service.sendCredentials(5).catch((e) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toContain('última hora');
    expect(mobileAuth.solicitarRedefinicaoSenha).not.toHaveBeenCalled();
  });

  it('conta com login e sem senha: define a senha inicial e envia (como antes)', async () => {
    const { service, prisma, mail, mobileAuth } = harness({ conta: { email: 'bia@x.com', login: 'bia@x.com', password: null } });

    const res = await service.sendCredentials(5);

    expect(res).toMatchObject({ ok: true, modo: 'senha' });
    expect(mobileAuth.solicitarRedefinicaoSenha).not.toHaveBeenCalled();
    expect(prisma.users.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 50 }, data: expect.objectContaining({ password: expect.any(String) }) }),
    );
    expect(mail.sendWelcomeMorador).toHaveBeenCalledWith('bia@x.com', 'Bia', expect.stringMatching(/^[0-9a-f]{8}$/));
  });

  it('conta sem login nem e-mail (importada sem acesso): o login nasce com o e-mail do cadastro', async () => {
    const { service, prisma, mail } = harness({ conta: { email: null, login: null, password: null } });

    await service.sendCredentials(5);

    const data = prisma.users.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ login: 'bia@x.com', email: 'bia@x.com', password: expect.any(String) });
    expect(mail.sendWelcomeMorador).toHaveBeenCalledWith('bia@x.com', 'Bia', expect.any(String));
  });

  it('conta sem login, mas o e-mail já é de outra conta: recusa sem gravar', async () => {
    const { service, prisma, mail } = harness({
      conta: { email: null, login: null, password: null },
      contaAchadaPeloEmail: { id: 77 },
    });

    await expect(service.sendCredentials(5)).rejects.toThrow('Já existe outro usuário com este e-mail.');
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it('cadastro sem conta ligada e conta achada pelo e-mail já com senha: liga e manda o link, sem trocar a senha', async () => {
    const { service, prisma, mail, mobileAuth } = harness({
      morador: { id_user: null },
      contaAchadaPeloEmail: { id: 77, email: 'bia@x.com', login: 'bia@x.com', password: '$2b$hash' },
    });

    const res = await service.sendCredentials(5);

    expect(res).toMatchObject({ ok: true, modo: 'link' });
    expect(prisma.moradores.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { id_user: 77 } });
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    expect(mobileAuth.solicitarRedefinicaoSenha).toHaveBeenCalledWith('bia@x.com', 'morador');
  });

  it('sem data de nascimento: 400 pedindo a data, sem gravar nada nem enviar', async () => {
    const { service, prisma, mail, mobileAuth } = harness({ morador: { data_nascimento: null } });

    const erro = await service.sendCredentials(5).catch((e) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toBe('Informe a data de nascimento do morador antes de enviar o acesso.');
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    expect(mobileAuth.solicitarRedefinicaoSenha).not.toHaveBeenCalled();
  });

  it('a auditoria registra o link, não "reenviou credenciais"', async () => {
    const { service, auditoria } = harness();
    await service.sendCredentials(5);
    expect(auditoria.registrar.mock.calls[0][0].descricao).toContain('link');
  });
});
