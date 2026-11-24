import * as bcrypt from 'bcrypt';
import { CrmCondominiosService } from './crm-condominios.service';

/**
 * R1: "Vincular síndico" achava a conta pelo e-mail/login e ligava o papel de síndico a ela sem prova de
 * posse — o token de 365 dias do /sindico/signup passava a valer no console. Agora a conta órfã (com senha,
 * sem vínculo em condomínio nenhum) só é ligada com senha nova enviada ao e-mail dela, sessões derrubadas e
 * credenciais revogadas; o operador do CRM não recebe essa senha (common/adocao-conta.util).
 */
describe('CrmCondominiosService.vincularSindico — conta órfã do signup', () => {
  const operador: any = { sub: 1, role: 'crm_admin', email: 'suporte@prestare.com' };
  const SENHA_DO_ATACANTE = 'senhaDoAtacante';
  let hashDoAtacante: string;
  beforeAll(async () => {
    hashDoAtacante = await bcrypt.hash(SENHA_DO_ATACANTE, 4);
  });
  const orfa = () => ({ id: 40, name: 'Ana', is_sindico: 1, email: 'ana@x.com', login: 'ana@x.com', password: hashDoAtacante });

  // 'pendente' = Sindicos_Condominios só no condomínio de autocadastro (ativo = 0, aprovado_em nulo), que o
  // mesmo token do signup cria por POST /mobile-auth/register; 'aqui' = vínculo em condomínio aprovado.
  function build(existente: any, vinculo: 'nenhum' | 'aqui' | 'pendente' = 'nenhum') {
    const contar = jest.fn(async () => (vinculo === 'aqui' ? 1 : 0));
    const contarSindico = jest.fn(async ({ where }: any) =>
      vinculo === 'aqui' ? 1 : vinculo === 'pendente' && !where.condominio?.NOT ? 1 : 0,
    );
    const tx: any = {
      users: { create: jest.fn(), update: jest.fn(async () => ({})) },
      sindicos: { create: jest.fn(), findFirst: jest.fn(async () => ({ id: 3 })) },
      sindicos_Condominios: { create: jest.fn(), deleteMany: jest.fn() },
      moradores: { findMany: jest.fn(async () => [{ id: 12 }]) },
      credenciais_Acesso: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma: any = {
      condominios: { findUnique: jest.fn(async () => ({ id: 9, nome: 'Cond' })) },
      users: { findFirst: jest.fn(async () => existente) },
      funcionarios_Portaria: { count: jest.fn(async () => 0) },
      sindicos_Condominios: { findFirst: jest.fn(async () => null), count: contarSindico },
      funcionarios: { count: contar },
      moradores: { count: contar },
      apartamentos_Users: { count: contar },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const mail: any = { sendForgotPassword: jest.fn(async () => undefined) };
    const svc = new CrmCondominiosService(prisma, { registrar: jest.fn(async () => undefined) } as any, {} as any, undefined, mail);
    return { svc, prisma, tx, mail };
  }

  it('conta órfã: senha do atacante deixa de valer, sessões caem, credenciais revogadas, senha nova só no e-mail da conta', async () => {
    const { svc, tx, mail } = build(orfa());
    const r: any = await svc.vincularSindico(9, { nome: 'Ana', email: 'ana@x.com' }, operador);

    const escrita = tx.users.update.mock.calls.find(([a]: any) => a.where.id === 40 && a.data.password);
    expect(escrita).toBeDefined();
    const data = escrita[0].data;
    expect(await bcrypt.compare(SENHA_DO_ATACANTE, data.password)).toBe(false);
    expect(data.senha_alterada_em).toBeInstanceOf(Date);
    expect(tx.credenciais_Acesso.updateMany).toHaveBeenCalledWith({
      where: { tipo_pessoa: 'morador', id_pessoa: { in: [12] }, revogada_em: null },
      data: { revogada_em: expect.any(Date) },
    });
    expect(mail.sendForgotPassword).toHaveBeenCalledTimes(1);
    const [destino, senha] = mail.sendForgotPassword.mock.calls[0];
    expect(destino).toBe('ana@x.com');
    expect(await bcrypt.compare(senha, data.password)).toBe(true);
    expect(tx.sindicos_Condominios.create).toHaveBeenCalledWith({ data: { id_user: 40, id_condominio: 9 } });
    // O operador não vê a senha da conta.
    expect(r.senhaSindico).toBeUndefined();
    expect(r).toMatchObject({ id_user: 40, contaExistente: true, credenciais_enviadas: true });
  });

  it('signup + condomínio pendente: tratada como órfã (senha nova só no e-mail da conta, sessões e credenciais caem)', async () => {
    const { svc, tx, mail } = build(orfa(), 'pendente');
    const r: any = await svc.vincularSindico(9, { nome: 'Ana', email: 'ana@x.com' }, operador);
    const escrita = tx.users.update.mock.calls.find(([a]: any) => a.where.id === 40 && a.data.password);
    expect(escrita).toBeDefined();
    expect(await bcrypt.compare(SENHA_DO_ATACANTE, escrita[0].data.password)).toBe(false);
    expect(escrita[0].data.senha_alterada_em).toBeInstanceOf(Date);
    expect(tx.credenciais_Acesso.updateMany).toHaveBeenCalled();
    expect(mail.sendForgotPassword).toHaveBeenCalledWith('ana@x.com', expect.any(String), 'Síndico');
    expect(r.senhaSindico).toBeUndefined();
  });

  it('conta órfã sem is_sindico: a flag entra na mesma escrita da senha nova', async () => {
    const { svc, tx } = build({ ...orfa(), is_sindico: 0 });
    await svc.vincularSindico(9, { nome: 'Ana', email: 'ana@x.com' }, operador);
    expect(tx.users.update).toHaveBeenCalledTimes(1);
    expect(tx.users.update.mock.calls[0][0].data).toMatchObject({ is_sindico: 1, password: expect.any(String) });
  });

  it('e-mail que não sai: o vínculo fica e a resposta avisa (a posse anterior já caiu)', async () => {
    const { svc, mail, tx } = build(orfa());
    mail.sendForgotPassword.mockRejectedValue(new Error('smtp'));
    const r: any = await svc.vincularSindico(9, { nome: 'Ana', email: 'ana@x.com' }, operador);
    expect(r.credenciais_enviadas).toBe(false);
    expect(tx.sindicos_Condominios.create).toHaveBeenCalled();
  });

  it('conta com vínculo em algum condomínio: senha e sessões intactas (comportamento de antes)', async () => {
    const { svc, tx, mail } = build(orfa(), 'aqui');
    const r: any = await svc.vincularSindico(9, { nome: 'Ana', email: 'ana@x.com' }, operador);
    expect(tx.users.update).not.toHaveBeenCalled();
    expect(tx.credenciais_Acesso.updateMany).not.toHaveBeenCalled();
    expect(mail.sendForgotPassword).not.toHaveBeenCalled();
    expect(r).toEqual({ id_user: 40, contaExistente: true, nomeConta: 'Ana' });
  });
});
