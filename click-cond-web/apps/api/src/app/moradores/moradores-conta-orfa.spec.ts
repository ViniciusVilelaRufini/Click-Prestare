import * as bcrypt from 'bcrypt';
import { MoradoresService } from './moradores.service';

/**
 * W1/R3: o /sindico/signup é público e cria Users com e-mail, CPF e senha sem provar a posse do e-mail.
 * O cadastro de morador (console, importação, "criar morador" do CRM) achava essa conta pelo e-mail e ligava
 * a unidade a ela mantendo a senha de quem a criou — o atacante entrava, pedia o QR do portão e o passe.
 * Agora a conta órfã (com senha, sem vínculo em condomínio nenhum, não é do solicitante) só é ligada com senha
 * nova enviada ao e-mail dela, sessões derrubadas e credenciais revogadas (common/adocao-conta.util).
 */
describe('MoradoresService — conta órfã do signup não é adotada sem prova de posse', () => {
  const SENHA_DO_ATACANTE = 'senhaDoAtacante';
  let hashDoAtacante: string;
  beforeAll(async () => {
    hashDoAtacante = await bcrypt.hash(SENHA_DO_ATACANTE, 4);
  });
  const conta = () => ({ id: 70, email: 'vitima@x.com', login: 'vitima@x.com', password: hashDoAtacante, photo: null, senha_alterada_em: null });

  /**
   * vinculo: onde a conta tem vínculo ('aqui' = este condomínio, 1; 'nenhum' = conta órfã;
   * 'pendente' = síndico do condomínio de autocadastro 99, ativo = 0 e aprovado_em nulo, via
   * POST /mobile-auth/register; 'outro-ativo' = síndico do condomínio 99 já aprovado).
   */
  function build(vinculo: 'nenhum' | 'aqui' | 'pendente' | 'outro-ativo' = 'nenhum') {
    const contar = jest.fn(async ({ where }: any) => {
      if (vinculo !== 'aqui') return 0;
      const c = where.id_condominio ?? where.apartamento?.id_condominio;
      return c?.not !== undefined ? 0 : 1; // só neste condomínio
    });
    // Sindicos_Condominios no condomínio 99 (fora deste): o filtro "condomínio não pendente" exclui o pendente.
    const contarSindico = jest.fn(async ({ where }: any) => {
      if (vinculo === 'aqui') return contar({ where });
      if (vinculo === 'nenhum') return 0;
      if (where.id_condominio !== undefined && where.id_condominio?.not === undefined) return 0; // pergunta por este
      return vinculo === 'pendente' && where.condominio?.NOT ? 0 : 1;
    });
    const prisma: any = {
      isConnected: true,
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 300, ...data })),
        update: jest.fn(async () => ({})),
        count: contar,
        findMany: jest.fn(async () => [{ id: 12 }]),
      },
      visitantes: { findFirst: jest.fn(async () => null) },
      users: {
        findFirst: jest.fn(async () => conta()),
        create: jest.fn(async ({ data }: any) => ({ id: 900, ...data })),
        update: jest.fn(async () => ({})),
      },
      apartamentos: {
        findUnique: jest.fn(async () => ({ id: 55, id_condominio: 1, bloco: 'A', apto: '101' })),
        findFirst: jest.fn(async () => null),
      },
      apartamentos_Users: { create: jest.fn(async () => ({})), count: contar },
      sindicos_Condominios: { count: contarSindico },
      funcionarios: { count: contar },
      funcionarios_Portaria: { count: jest.fn(async () => 0) },
      credenciais_Acesso: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const mobileAuth: any = { enviarLinkDefinirSenhaOperador: jest.fn(async () => undefined) };
    const svc = new MoradoresService(
      prisma, mail, storage, {} as any, { registrar: jest.fn(async () => ({})) } as any,
      { enviarMorador: jest.fn(async () => ({ enviado: false })) } as any, undefined, mobileAuth,
    );
    jest.spyOn(svc as any, 'carregarContextoMorador').mockResolvedValue(null);
    jest.spyOn(svc, 'findOne').mockResolvedValue({} as any);
    return { svc, prisma, mail, mobileAuth };
  }

  const dto = (extra: any = {}) => ({
    nome: 'Vítima', email: 'vitima@x.com', data_nascimento: '1990-01-01', id_condominio: 1, id_apartamento: 55, ...extra,
  });

  /** A posse anterior caiu: senha trocada (a do atacante não confere), sessões derrubadas, credenciais revogadas. */
  async function possePerdida(prisma: any) {
    const escrita = prisma.users.update.mock.calls.find(([a]: any) => a.where.id === 70 && a.data.password);
    expect(escrita).toBeDefined();
    const data = escrita[0].data;
    expect(await bcrypt.compare(SENHA_DO_ATACANTE, data.password)).toBe(false);
    expect(data.senha_alterada_em).toBeInstanceOf(Date);
    expect(prisma.credenciais_Acesso.updateMany).toHaveBeenCalledWith({
      where: { tipo_pessoa: 'morador', id_pessoa: { in: [12] }, revogada_em: null },
      data: { revogada_em: expect.any(Date) },
    });
    return data.password as string;
  }

  /** A senha nova saiu para o e-mail da conta e é a que foi gravada. */
  async function senhaNoEmailDaConta(mail: any, hash: string) {
    expect(mail.sendWelcomeMorador).toHaveBeenCalledTimes(1);
    const [destino, , senha] = mail.sendWelcomeMorador.mock.calls[0];
    expect(destino).toBe('vitima@x.com');
    expect(await bcrypt.compare(senha, hash)).toBe(true);
  }

  describe('create (console)', () => {
    it('conta órfã com a senha do atacante: liga a unidade só depois de invalidar a posse e manda a senha ao e-mail da conta', async () => {
      const { svc, prisma, mail } = build();
      await svc.create(dto({ sendCredentials: false }) as any);
      const hash = await possePerdida(prisma);
      await senhaNoEmailDaConta(mail, hash);
      expect(prisma.apartamentos_Users.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_user: 70 }) });
    });

    it('não adota conta pelo CPF: sem e-mail o cadastro nem procura conta existente', async () => {
      const { svc, prisma } = build();
      await svc.create(dto({ email: undefined, documento: '52998224725' }) as any);
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(prisma.users.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cpf: '52998224725' }) });
    });

    it('conta já vinculada neste condomínio: senha e sessões intactas (comportamento de antes)', async () => {
      const { svc, prisma, mail } = build('aqui');
      await svc.create(dto({ sendCredentials: true }) as any);
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(prisma.credenciais_Acesso.updateMany).not.toHaveBeenCalled();
      expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
      expect(mail.sendWelcomeMoradorExisting).toHaveBeenCalledWith('vitima@x.com', 'Vítima');
    });

    it('conta do próprio solicitante: não é tratada como órfã', async () => {
      const { svc, prisma, mail } = build();
      const operador: any = { sub: 70, typeAccess: 'Sindico', user: { id: 70 } };
      await svc.create(dto({ sendCredentials: false }) as any, operador);
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(prisma.credenciais_Acesso.updateMany).not.toHaveBeenCalled();
      expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    });
  });

  // Achado da revisão: o mesmo token do signup chama POST /mobile-auth/register, que cria um condomínio
  // pendente e grava Sindicos_Condominios. A conta deixava de ser órfã e virava "de outro condomínio".
  describe('signup + condomínio de autocadastro pendente', () => {
    it('criar morador do CRM (permitirContaDeOutroCondominio): adotada como órfã, não ligada com a senha antiga', async () => {
      const { svc, prisma, mail } = build('pendente');
      const admin: any = { sub: 1, role: 'crm_admin', typeAccess: 'CrmAdmin' };
      await svc.create(dto({ sendCredentials: false }) as any, admin, { permitirContaDeOutroCondominio: true });
      const hash = await possePerdida(prisma);
      await senhaNoEmailDaConta(mail, hash);
    });

    it('console: a conta é adotada como órfã (não mais 400 de "outro condomínio")', async () => {
      const { svc, prisma, mail } = build('pendente');
      await svc.create(dto({ sendCredentials: false }) as any);
      const hash = await possePerdida(prisma);
      await senhaNoEmailDaConta(mail, hash);
      expect(prisma.moradores.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_user: 70 }) });
    });

    it('importação (importBulk): também adotada como órfã', async () => {
      const { svc, prisma, mail } = build('pendente');
      const r: any = await svc.importBulk(1, [{ nome: 'Vítima', email: 'vitima@x.com', data_nascimento: '01/01/1990' }]);
      expect(r.erros).toEqual([]);
      const hash = await possePerdida(prisma);
      await senhaNoEmailDaConta(mail, hash);
    });

    it('controle: síndico de OUTRO condomínio aprovado continua como antes (CRM liga sem tocar a conta; console recusa)', async () => {
      const crm = build('outro-ativo');
      const admin: any = { sub: 1, role: 'crm_admin', typeAccess: 'CrmAdmin' };
      await crm.svc.create(dto({ sendCredentials: true }) as any, admin, { permitirContaDeOutroCondominio: true });
      expect(crm.prisma.users.update).not.toHaveBeenCalled();
      expect(crm.prisma.credenciais_Acesso.updateMany).not.toHaveBeenCalled();
      expect(crm.mail.sendWelcomeMorador).not.toHaveBeenCalled();

      const doConsole = build('outro-ativo');
      await expect(doConsole.svc.create(dto() as any)).rejects.toThrow('Fale com o suporte para vincular a unidade.');
      expect(doConsole.prisma.users.update).not.toHaveBeenCalled();
    });
  });

  // R3: o CRM passa permitirContaDeOutroCondominio, que só pula a recusa de "outro condomínio".
  it('criar morador do CRM (permitirContaDeOutroCondominio): a regra da conta órfã vale também', async () => {
    const { svc, prisma, mail } = build();
    const admin: any = { sub: 1, role: 'crm_admin', typeAccess: 'CrmAdmin' };
    await svc.create(dto({ sendCredentials: true }) as any, admin, { permitirContaDeOutroCondominio: true });
    const hash = await possePerdida(prisma);
    await senhaNoEmailDaConta(mail, hash);
  });

  it('importação (importBulk): a conta órfã perde a posse e a senha nova entra na fila de e-mails', async () => {
    const { svc, prisma, mail } = build();
    const r: any = await svc.importBulk(1, [{ nome: 'Vítima', email: 'vitima@x.com', data_nascimento: '01/01/1990', sendCredentials: false }]);
    expect(r.erros).toEqual([]);
    const hash = await possePerdida(prisma);
    await senhaNoEmailDaConta(mail, hash);
  });

  describe('sendCredentials ("Enviar acesso" de cadastro sem conta ligada)', () => {
    const morador = { id: 5, nome: 'Vítima', email: 'vitima@x.com', id_user: null, id_condominio: 1, data_nascimento: new Date('1980-04-19') };

    function comConta(vinculo: 'nenhum' | 'aqui') {
      const b = build(vinculo);
      // Conta do signup: síndico sem condomínio, já com sessão (o caminho de antes era o link, senha mantida).
      b.prisma.users.findFirst = jest.fn(async () => ({
        ...conta(), senha_alterada_em: null, is_sindico: 1, _count: { devices: 0, sindicos: 1, sindicosCondominios: 0, funcionarios: 0 },
      }));
      (b.svc.findOne as jest.Mock).mockResolvedValue({ ...morador });
      return b;
    }

    it('conta órfã: senha nova ao e-mail da conta, sessões derrubadas, credenciais revogadas (não o link)', async () => {
      const { svc, prisma, mail, mobileAuth } = comConta('nenhum');
      const r: any = await svc.sendCredentials(5);
      expect(mobileAuth.enviarLinkDefinirSenhaOperador).not.toHaveBeenCalled();
      expect(r.modo).not.toBe('link');
      const hash = await possePerdida(prisma);
      await senhaNoEmailDaConta(mail, hash);
      expect(prisma.moradores.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { id_user: 70 } });
    });

    it('conta órfã e e-mail que não sai: a posse anterior não volta (senha_alterada_em não é restaurado)', async () => {
      const { svc, prisma, mail } = comConta('nenhum');
      mail.sendWelcomeMorador.mockRejectedValue(new Error('smtp'));
      await expect(svc.sendCredentials(5)).rejects.toThrow();
      for (const [a] of prisma.users.update.mock.calls) expect(a.data.senha_alterada_em).not.toBeNull();
    });

    it('conta com vínculo neste condomínio: segue o link, senha mantida (comportamento de antes)', async () => {
      const { svc, prisma, mobileAuth } = comConta('aqui');
      (prisma as any).redefinicoes_Senha = { count: jest.fn(async () => 0) };
      const r: any = await svc.sendCredentials(5);
      expect(r.modo).toBe('link');
      expect(mobileAuth.enviarLinkDefinirSenhaOperador).toHaveBeenCalledWith(70);
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });
});
