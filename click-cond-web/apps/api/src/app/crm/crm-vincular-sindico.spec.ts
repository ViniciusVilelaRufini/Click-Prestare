import { BadRequestException, ConflictException } from '@nestjs/common';
import { CrmCondominiosService } from './crm-condominios.service';

const operador: any = { sub: 1, role: 'crm_admin', email: 'suporte@prestare.com' };
const LOGIN_PORTEIRO = 'porteiro@x.com';

function build(opts: { existente?: any; atual?: any } = {}) {
  const tx: any = {
    users: { create: jest.fn(async () => ({ id: 70 })), update: jest.fn() },
    sindicos: { create: jest.fn(), findFirst: jest.fn(async () => null) },
    sindicos_Condominios: { create: jest.fn(), deleteMany: jest.fn() },
    moradores: { update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
    apartamentos_Users: { deleteMany: jest.fn() },
  };
  const prisma: any = {
    condominios: { findUnique: jest.fn(async () => ({ id: 9, nome: 'Cond' })) },
    users: { findFirst: jest.fn(async () => opts.existente ?? null) },
    funcionarios_Portaria: {
      count: jest.fn(async ({ where }: any) => (where.login === LOGIN_PORTEIRO ? 1 : 0)),
    },
    sindicos_Condominios: { findFirst: jest.fn(async () => opts.atual ?? null) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const auditoria: any = { registrar: jest.fn(async () => undefined) };
  const svc = new CrmCondominiosService(prisma, auditoria, {} as any);
  return { svc, prisma, tx, auditoria };
}

const dto = (extra: any = {}) => ({ nome: 'Ana', email: ' Ana@X.com ', ...extra });
const beto = { id: 1, id_user: 5, user: { id: 5, name: 'Beto', email: 'b@x.com' } };

describe('CrmCondominiosService.vincularSindico', () => {
  it('e-mail novo: cria Users/Sindicos/vínculo e devolve a senha única', async () => {
    const { svc, tx, auditoria } = build();
    const r: any = await svc.vincularSindico(9, dto(), operador);
    expect(tx.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'ana@x.com', login: 'ana@x.com', is_sindico: 1 }),
      }),
    );
    expect(tx.sindicos.create).toHaveBeenCalled();
    expect(tx.sindicos_Condominios.create).toHaveBeenCalledWith({ data: { id_user: 70, id_condominio: 9 } });
    expect(r).toMatchObject({ id_user: 70, contaExistente: false });
    expect(typeof r.senhaSindico).toBe('string');
    expect(auditoria.registrar).toHaveBeenCalled();
  });

  it('e-mail existente (morador do mesmo condomínio): liga a conta sem senha e sem mexer no morador', async () => {
    const { svc, tx } = build({ existente: { id: 40, name: 'Ana', is_sindico: 0 } });
    const r: any = await svc.vincularSindico(9, dto(), operador);
    expect(tx.users.create).not.toHaveBeenCalled();
    expect(tx.users.update).toHaveBeenCalledWith({ where: { id: 40 }, data: { is_sindico: 1 } });
    expect(tx.sindicos.create).toHaveBeenCalled();
    expect(tx.sindicos_Condominios.create).toHaveBeenCalledWith({ data: { id_user: 40, id_condominio: 9 } });
    expect(r).toEqual({ id_user: 40, contaExistente: true });
    expect(tx.moradores.update).not.toHaveBeenCalled();
    expect(tx.moradores.deleteMany).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.deleteMany).not.toHaveBeenCalled();
  });

  it('conta que já é síndica noutro lugar: não recria Sindicos nem refaz is_sindico', async () => {
    const { svc, tx } = build({ existente: { id: 40, name: 'Ana', is_sindico: 1 } });
    tx.sindicos.findFirst.mockResolvedValue({ id: 3 });
    await svc.vincularSindico(9, dto(), operador);
    expect(tx.users.update).not.toHaveBeenCalled();
    expect(tx.sindicos.create).not.toHaveBeenCalled();
  });

  it('já existe outro síndico e sem substituirAtual: 409 com o nome', async () => {
    const { svc, tx } = build({ atual: beto });
    await expect(svc.vincularSindico(9, dto(), operador)).rejects.toThrow(
      new ConflictException('Este condomínio já tem síndico (Beto). Confirme a substituição.'),
    );
    expect(tx.sindicos_Condominios.deleteMany).not.toHaveBeenCalled();
  });

  it('substituirAtual: remove só o vínculo do anterior e devolve anteriorRemovido', async () => {
    const { svc, tx } = build({ atual: beto });
    const r: any = await svc.vincularSindico(9, dto({ substituirAtual: true }), operador);
    expect(tx.sindicos_Condominios.deleteMany).toHaveBeenCalledWith({ where: { id_condominio: 9 } });
    expect(tx.users.update).not.toHaveBeenCalled();
    expect(r.anteriorRemovido).toEqual({ id_user: 5, nome: 'Beto' });
  });

  it('mesma pessoa de novo: 409', async () => {
    const { svc } = build({ existente: { id: 5, name: 'Beto', is_sindico: 1 }, atual: beto });
    await expect(svc.vincularSindico(9, dto({ substituirAtual: true }), operador)).rejects.toThrow(
      new ConflictException('Essa pessoa já é síndica deste condomínio.'),
    );
  });

  it('e-mail de login da portaria: recusado como em criar', async () => {
    const { svc, tx } = build();
    await expect(svc.vincularSindico(9, dto({ email: LOGIN_PORTEIRO }), operador)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.users.create).not.toHaveBeenCalled();
  });

  it('e-mail inválido: 400', async () => {
    const { svc } = build();
    await expect(svc.vincularSindico(9, dto({ email: 'xx' }), operador)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
