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
  /** Conta que já entrou no app: senha trocada/definida depois do cadastro. */
  const JA_ENTROU = { email: 'bia@x.com', login: 'bia@x.com', password: '$2b$hash', senha_alterada_em: new Date('2026-10-01') };
  /** Conta criada pelo cadastro (senha aleatória que ninguém recebeu) e que nunca entrou. */
  const NUNCA_ENTROU = { email: 'bia@x.com', login: 'bia@x.com', password: '$2b$hash', senha_alterada_em: null, fcm_token: null, _count: { devices: 0 } };

  function harness(opts: {
    morador?: Record<string, unknown>;
    conta?: Record<string, unknown> | null;
    cadastrosComOEmail?: number;
    linksNaUltimaHora?: number;
    contaAchadaPeloEmail?: Record<string, unknown> | null;
    outroCondominio?: boolean;
    loginDePortaria?: boolean;
    /** A conta já tem vínculo de unidade neste condomínio (não é conta órfã, common/adocao-conta.util). */
    vinculoAqui?: boolean;
  } = {}) {
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn().mockResolvedValue(opts.conta === undefined ? { ...JA_ENTROU } : opts.conta),
        findFirst: jest.fn().mockResolvedValue(opts.contaAchadaPeloEmail ?? null),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 51 }),
      },
      moradores: {
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn(async ({ where }: any) => (where?.email ? (opts.cadastrosComOEmail ?? 1) : opts.outroCondominio && where?.id_condominio?.not != null ? 1 : 0)),
      },
      redefinicoes_Senha: { count: jest.fn().mockResolvedValue(opts.linksNaUltimaHora ?? 0) },
      funcionarios_Portaria: { count: jest.fn(async ({ where }: any) => (opts.loginDePortaria && where?.login === 'bia@x.com' ? 1 : 0)) },
      sindicos_Condominios: { count: jest.fn().mockResolvedValue(0) },
      funcionarios: { count: jest.fn().mockResolvedValue(0) },
      apartamentos_Users: {
        count: jest.fn(async ({ where }: any) => (opts.vinculoAqui && where?.apartamento?.id_condominio?.not === undefined ? 1 : 0)),
      },
    };
    const mail: any = { sendWelcomeMorador: jest.fn().mockResolvedValue({}), sendWelcomeMoradorExisting: jest.fn() };
    const auditoria: any = { registrar: jest.fn().mockResolvedValue({}) };
    const mobileAuth: any = { enviarLinkDefinirSenhaOperador: jest.fn().mockResolvedValue(undefined) };
    const service = new MoradoresService(prisma, mail, {} as any, {} as any, auditoria, {} as any, undefined, mobileAuth);
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 5, nome: 'Bia', email: 'bia@x.com', id_user: 50, id_condominio: 1, data_nascimento: ADULTO,
      ...opts.morador,
    } as any);
    jest.spyOn(service as any, 'carregarContextoMorador').mockResolvedValue(null);
    return { service, prisma, mail, mobileAuth, auditoria };
  }

  it('conta que já entrou no app: manda o link de redefinição e não troca a senha nem derruba as sessões', async () => {
    const { service, prisma, mail, mobileAuth } = harness();

    const res = await service.sendCredentials(5);

    expect(res).toMatchObject({ ok: true, modo: 'link' });
    expect(mobileAuth.enviarLinkDefinirSenhaOperador).toHaveBeenCalledWith(50);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it('conta com senha e e-mail do cadastro diferente do login: o link vai para o login da conta', async () => {
    const { service, mobileAuth } = harness({
      morador: { email: 'outro@x.com' },
      conta: { ...JA_ENTROU, login: 'Bia@X.com' },
    });

    const res = await service.sendCredentials(5);

    expect(mobileAuth.enviarLinkDefinirSenhaOperador).toHaveBeenCalledWith(50);
    // O login da conta, diferente do e-mail do cadastro, não aparece para o operador.
    expect(res.message).not.toContain('bia@x.com');
    expect(res.message).toContain('e-mail de acesso do morador');
  });

  describe('revisão final I-1: conta com outro papel (síndico, equipe, portaria) nunca tem a senha trocada', () => {
    const casos: Array<[string, Record<string, unknown>, boolean?]> = [
      ['síndico-morador que só usa o console web (sem push, sem senha_alterada_em), pela flag', { is_sindico: 1 }],
      ['síndico-morador pelo vínculo Sindicos_Condominios', { _count: { devices: 0, sindicosCondominios: 1 } }],
      ['síndico-morador pelo perfil em Sindicos', { _count: { devices: 0, sindicos: 1 } }],
      ['funcionário-morador pela flag', { is_funcionario: 1 }],
      ['funcionário-morador pela equipe (Funcionarios)', { _count: { devices: 0, funcionarios: 1 } }],
      ['conta com o login de portaria', {}, true],
    ];
    for (const [nome, papel, portaria] of casos) {
      it(`${nome}: link, senha intacta`, async () => {
        const { service, prisma, mail, mobileAuth } = harness({ conta: { ...NUNCA_ENTROU, ...papel }, loginDePortaria: portaria });
        const res = await service.sendCredentials(5);
        expect(res).toMatchObject({ ok: true, modo: 'link' });
        expect(mobileAuth.enviarLinkDefinirSenhaOperador).toHaveBeenCalledWith(50);
        expect(prisma.users.update).not.toHaveBeenCalled();
        expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
      });
    }

    it('conta da equipe sem login de e-mail: recusa, sem gravar senha', async () => {
      const { service, prisma, mail } = harness({ conta: { email: null, login: null, password: null, is_funcionario: 1 } });
      await expect(service.sendCredentials(5)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    });

    it('morador comum (só morador, só daqui) que nunca entrou: credencial inicial', async () => {
      const { service, prisma, mail } = harness({ conta: { ...NUNCA_ENTROU, is_sindico: 0, is_funcionario: 0, _count: { devices: 0, sindicos: 0, sindicosCondominios: 0, funcionarios: 0 } } });
      await expect(service.sendCredentials(5)).resolves.toMatchObject({ modo: 'senha' });
      expect(prisma.users.update).toHaveBeenCalled();
      expect(mail.sendWelcomeMorador).toHaveBeenCalled();
    });
  });

  describe('primeiro acesso (rodada 1 da revisão): a senha aleatória do cadastro não conta como "já usa o app"', () => {
    it('nunca entrou e é só deste condomínio: credencial inicial (senha + boas-vindas), sem link de 30 min', async () => {
      const { service, prisma, mail, mobileAuth } = harness({ conta: { ...NUNCA_ENTROU } });
      const res = await service.sendCredentials(5);
      expect(res).toMatchObject({ ok: true, modo: 'senha' });
      expect(mobileAuth.enviarLinkDefinirSenhaOperador).not.toHaveBeenCalled();
      expect(prisma.users.update.mock.calls[0][0].data).toMatchObject({ password: expect.any(String) });
      expect(mail.sendWelcomeMorador).toHaveBeenCalledWith('bia@x.com', 'Bia', expect.stringMatching(/^[0-9a-f]{8}$/));
    });

    it('nunca entrou, mas a conta também é de outro condomínio: link, nunca troca a senha dela', async () => {
      const { service, prisma, mail, mobileAuth } = harness({ conta: { ...NUNCA_ENTROU }, outroCondominio: true });
      const res = await service.sendCredentials(5);
      expect(res).toMatchObject({ ok: true, modo: 'link' });
      expect(mobileAuth.enviarLinkDefinirSenhaOperador).toHaveBeenCalledWith(50);
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    });

    it('aparelho com push registrado (fcm_token ou Users_Devices) conta como uso: link', async () => {
      for (const sinal of [{ fcm_token: 'tok' }, { _count: { devices: 1 } }]) {
        const { service, prisma, mobileAuth } = harness({ conta: { ...NUNCA_ENTROU, ...sinal } });
        await expect(service.sendCredentials(5)).resolves.toMatchObject({ modo: 'link' });
        expect(mobileAuth.enviarLinkDefinirSenhaOperador).toHaveBeenCalled();
        expect(prisma.users.update).not.toHaveBeenCalled();
      }
    });
  });

  it('nenhum cadastro de morador usa o e-mail de acesso: recusa explicando o que corrigir (o link sairia em silêncio)', async () => {
    const { service, mobileAuth } = harness({
      morador: { email: 'outro@x.com' },
      cadastrosComOEmail: 0,
    });

    const erro = await service.sendCredentials(5).catch((e) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toBe('O e-mail de acesso deste morador é diferente do e-mail do cadastro; peça a ele para usar "Esqueci a senha" no app.');
    expect(erro.message).not.toContain('bia@x.com');
    expect(mobileAuth.enviarLinkDefinirSenhaOperador).not.toHaveBeenCalled();
  });

  it('limite de 3 links por hora já atingido: recusa em vez de dizer que enviou', async () => {
    const { service, mobileAuth } = harness({ linksNaUltimaHora: 3 });

    const erro = await service.sendCredentials(5).catch((e) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toContain('última hora');
    expect(mobileAuth.enviarLinkDefinirSenhaOperador).not.toHaveBeenCalled();
  });

  it('conta com login e sem senha, só deste condomínio: define a senha inicial e envia (como antes)', async () => {
    const { service, prisma, mail, mobileAuth } = harness({ conta: { email: 'bia@x.com', login: 'bia@x.com', password: null } });

    const res = await service.sendCredentials(5);

    expect(res).toMatchObject({ ok: true, modo: 'senha' });
    expect(mobileAuth.enviarLinkDefinirSenhaOperador).not.toHaveBeenCalled();
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
      contaAchadaPeloEmail: { id: 77, ...JA_ENTROU },
      vinculoAqui: true,
    });

    const res = await service.sendCredentials(5);

    expect(res).toMatchObject({ ok: true, modo: 'link' });
    expect(prisma.moradores.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { id_user: 77 } });
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    expect(mobileAuth.enviarLinkDefinirSenhaOperador).toHaveBeenCalledWith(77);
  });

  it('cadastro sem conta ligada, conta achada pelo e-mail e recusa (limite de links): o cadastro não fica ligado', async () => {
    const { service, prisma, mobileAuth } = harness({
      morador: { id_user: null },
      contaAchadaPeloEmail: { id: 77, ...JA_ENTROU },
      vinculoAqui: true,
      linksNaUltimaHora: 3,
    });

    await expect(service.sendCredentials(5)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.moradores.update).not.toHaveBeenCalled();
    expect(mobileAuth.enviarLinkDefinirSenhaOperador).not.toHaveBeenCalled();
  });

  it('sem data de nascimento: 400 pedindo a data, sem gravar nada nem enviar', async () => {
    const { service, prisma, mail, mobileAuth } = harness({ morador: { data_nascimento: null } });

    const erro = await service.sendCredentials(5).catch((e) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toBe('Informe a data de nascimento do morador antes de enviar o acesso.');
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    expect(mobileAuth.enviarLinkDefinirSenhaOperador).not.toHaveBeenCalled();
  });

  it('a auditoria registra o link, não "reenviou credenciais"', async () => {
    const { service, auditoria } = harness();
    await service.sendCredentials(5);
    expect(auditoria.registrar.mock.calls[0][0].descricao).toContain('link');
  });
});

describe('MoradoresService.findAll — envio_acesso_por_link segue a mesma regra do Enviar Acesso', () => {
  const linha = (id: number, user: any) => ({
    id, id_user: user ? 100 + id : null, id_condominio: 1, nome: `M${id}`, foto_pessoa: null, face_id: null,
    face_sync_error: null, bloco: 'A', apartamento: '101', user,
  });

  it('já entrou → link; nunca entrou e só daqui → senha inicial; também de outro condomínio → link; sem conta → senha', async () => {
    const lista = [
      linha(1, { id: 101, login: 'a@x.com', password: 'h', senha_alterada_em: new Date(), apartamentosUsers: [] }),
      linha(2, { id: 102, login: 'b@x.com', password: 'h', senha_alterada_em: null, fcm_token: null, _count: { devices: 0 }, apartamentosUsers: [] }),
      linha(3, { id: 103, login: 'c@x.com', password: 'h', senha_alterada_em: null, apartamentosUsers: [] }),
      linha(4, null),
    ];
    const prisma: any = {
      isConnected: true,
      moradores: { findMany: jest.fn(async ({ where }: any) => (where?.id_user ? [{ id_user: 103 }] : lista)) },
      sindicos_Condominios: { findMany: jest.fn(async () => []) },
      funcionarios: { findMany: jest.fn(async () => []) },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
      consentimentos: { findMany: jest.fn(async () => []) },
    };
    const service = new MoradoresService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    const res: any[] = await service.findAll(1);
    expect(res.map((r) => r.envio_acesso_por_link)).toEqual([true, false, true, false]);
    // O hash da senha e os sinais de uso não saem na lista.
    expect(JSON.stringify(res)).not.toContain('senha_alterada_em');
    expect(res[0]).not.toHaveProperty('password');
  });

  it('revisão final I-1: síndico, equipe e login de portaria → link; cadastro sem id_user reflete a conta achada pelo e-mail', async () => {
    const nunca = { password: 'h', senha_alterada_em: null, fcm_token: null, apartamentosUsers: [] };
    const lista = [
      linha(1, { id: 101, login: 'sind@x.com', is_sindico: 1, ...nunca }),
      linha(2, { id: 102, login: 'func@x.com', _count: { devices: 0, funcionarios: 1 }, ...nunca }),
      linha(3, { id: 103, login: 'port@x.com', ...nunca }),
      linha(4, { id: 104, login: 'comum@x.com', ...nunca }),
      // Sem id_user: o "Enviar Acesso" acha a conta pelo e-mail do cadastro.
      { ...linha(5, null), email: 'achada@x.com' },
      { ...linha(6, null), email: 'novo@x.com' },
    ];
    const prisma: any = {
      isConnected: true,
      moradores: { findMany: jest.fn(async ({ where }: any) => (where?.id_user ? [] : lista)) },
      sindicos_Condominios: { findMany: jest.fn(async () => []) },
      funcionarios: { findMany: jest.fn(async () => []) },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
      funcionarios_Portaria: { findMany: jest.fn(async () => [{ login: 'port@x.com' }]) },
      users: {
        findMany: jest.fn(async () => [
          { id: 900, email: 'achada@x.com', login: 'achada@x.com', password: 'h', senha_alterada_em: new Date() },
        ]),
      },
    };
    const service = new MoradoresService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    const res: any[] = await service.findAll(1);
    expect(res.map((r) => r.envio_acesso_por_link)).toEqual([true, true, true, false, true, false]);
    // A conta achada pelo e-mail não aparece na lista (nem id, nem login).
    expect(JSON.stringify(res[4])).not.toContain('900');
  });
});
