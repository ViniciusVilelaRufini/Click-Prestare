import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConvitesService, HORAS_DE_VALIDADE } from './convites.service';
import { ConvitesController } from './convites.controller';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * M14: a validade contava só da geração. Preenchido perto das 24 h, o convite já não podia ser
 * confirmado, mas seguia em Pendentes até a retenção. Ao preencher, a validade passa a contar do
 * preenchimento, e a lista de pendentes só traz o que ainda pode ser confirmado.
 * B5: o convite saía sempre para a primeira unidade da conta; o app pode escolher a unidade,
 * conferida contra os vínculos do próprio morador.
 */
describe('ConvitesService — validade do preenchido e unidade do convite (M14, B5)', () => {
  const MORADOR: JwtPayload = { sub: 7, nome: 'Morador', typeAccess: 'Morador' };
  const hash = (t: string) => createHash('sha256').update(t).digest('hex');

  beforeEach(() => { process.env.CONVITE_BASE_URL = 'https://exemplo.test'; });
  afterEach(() => { delete process.env.CONVITE_BASE_URL; });

  function build(convite?: any, vinculos: any[] = [{ id_apto: 5, apartamento: { id_condominio: 2 } }]) {
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          vinculos.find((v) => where.id_apto === undefined || v.id_apto === where.id_apto) ?? null,
        ),
      },
      users: { findUnique: jest.fn(async () => ({ fcm_token: null })) },
      convites_Visita: {
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        findUnique: jest.fn(async () => convite ?? null),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn(async () => []),
      },
    };
    const storage: any = { enabled: false };
    const terceiros: any = { registrarConvite: jest.fn(async () => ({ ok: true })) };
    const svc = new ConvitesService(prisma, storage, {} as any, {} as any, terceiros);
    return { svc, prisma };
  }

  it('M14: ao preencher, a validade passa a contar do preenchimento', async () => {
    const quaseVencido = {
      id: 1, token_hash: hash('tok'), id_condominio: 2, id_apartamento: 5, id_usuario: 7, is_prestador: 0,
      status: 'aguardando', expira_em: new Date(Date.now() + 60_000),
    };
    const { svc, prisma } = build(quaseVencido);
    const antes = Date.now();
    await svc.responder('tok', { nome: 'Rodrigo Rufini', cpf: '390.533.447-05', foto: 'data:image/png;base64,AAAA', aceite: true });
    const data = prisma.convites_Visita.updateMany.mock.calls[0][0].data;
    expect(data.expira_em).toBeInstanceOf(Date);
    expect(data.expira_em.getTime()).toBeGreaterThanOrEqual(antes + HORAS_DE_VALIDADE * 3600_000 - 1000);
  });

  it('M14: pendentes traz só o que ainda pode ser confirmado', async () => {
    const { svc, prisma } = build();
    await svc.listarPendentes(MORADOR);
    const where = prisma.convites_Visita.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('preenchido');
    expect(where.expira_em?.gt).toBeInstanceOf(Date);
  });

  const vinculos2 = [
    { id_apto: 5, apartamento: { id_condominio: 2 } },
    { id_apto: 9, apartamento: { id_condominio: 3 } },
  ];

  it('B5: com a unidade escolhida, o convite sai para ela (e o condomínio dela)', async () => {
    const { svc, prisma } = build(undefined, vinculos2);
    const r = await svc.gerar(MORADOR, false, 9);
    const data = prisma.convites_Visita.create.mock.calls[0][0].data;
    expect(data.id_apartamento).toBe(9);
    expect(data.id_condominio).toBe(3);
    expect(r.id_apartamento).toBe(9);
  });

  it('B5: unidade que não é do morador é recusada', async () => {
    const { svc, prisma } = build(undefined, vinculos2);
    await expect(svc.gerar(MORADOR, false, 44)).rejects.toThrow(ForbiddenException);
    expect(prisma.convites_Visita.create).not.toHaveBeenCalled();
  });

  it('B5: sem escolha, segue a primeira unidade (app já publicado)', async () => {
    const { svc, prisma } = build(undefined, vinculos2);
    await svc.gerar(MORADOR, false);
    expect(prisma.convites_Visita.create.mock.calls[0][0].data.id_apartamento).toBe(5);
  });
});

describe('ConvitesController.gerar — id_apartamento inválido (B5)', () => {
  const user: any = { sub: 7 };
  const build = () => {
    const service = { gerar: jest.fn(async () => ({ ok: true })) };
    return { ctrl: new ConvitesController(service as any), service };
  };

  it.each(['abc', 0, -1, 1.5, '', true])('%p responde 400 e não gera', async (valor) => {
    const { ctrl, service } = build();
    expect(() => ctrl.gerar({ id_apartamento: valor }, user)).toThrow('Unidade inválida.');
    expect(service.gerar).not.toHaveBeenCalled();
  });

  it('ausente: segue para a primeira unidade (app publicado)', async () => {
    const { ctrl, service } = build();
    await ctrl.gerar({}, user);
    expect(service.gerar).toHaveBeenCalledWith(user, false, undefined);
  });

  it('válido (número ou texto numérico) passa adiante', async () => {
    const { ctrl, service } = build();
    await ctrl.gerar({ id_apartamento: '9', is_prestador: true }, user);
    expect(service.gerar).toHaveBeenCalledWith(user, true, 9);
  });
});
