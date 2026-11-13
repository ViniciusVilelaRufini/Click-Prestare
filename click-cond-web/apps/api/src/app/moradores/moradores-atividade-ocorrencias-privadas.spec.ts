import { MoradoresController } from './moradores.controller';
import { MoradoresService } from './moradores.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * GET condominios/:id/moradores/:id/atividade devolvia as ocorrências do morador — privadas
 * incluídas, com descrição e resposta — ao funcionário do app sem a flag `ocorrencias`.
 * Mesmo recorte dos outros leitores derivados (recorteOcorrenciasPrivadas): públicas + as dele.
 */
const funcionario: JwtPayload = { sub: 10, nome: 'Func', typeAccess: 'Funcionario', user: { id: 10 } };
const sindico: JwtPayload = { sub: 11, nome: 'Síndico', typeAccess: 'Sindico' };

describe('MoradoresController.atividade — recorte de ocorrências privadas', () => {
  function build(recorte: number | null) {
    const service: any = {
      findOne: jest.fn(async () => ({ id: 5, id_condominio: 1 })),
      atividade: jest.fn(async () => ({})),
    };
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      recorteOcorrenciasPrivadas: jest.fn(async () => recorte),
    };
    return { ctrl: new MoradoresController(service, tenant), service, tenant };
  }

  it('funcionário sem a flag: o service recebe o recorte (Users.id dele)', async () => {
    const { ctrl, service, tenant } = build(10);
    await ctrl.atividade(5, funcionario);
    expect(tenant.recorteOcorrenciasPrivadas).toHaveBeenCalledWith(1, funcionario);
    expect(service.atividade).toHaveBeenCalledWith(5, 10);
  });

  it('síndico: sem recorte (null)', async () => {
    const { ctrl, service } = build(null);
    await ctrl.atividade(5, sindico);
    expect(service.atividade).toHaveBeenCalledWith(5, null);
  });
});

describe('MoradoresService.atividade — filtro das ocorrências', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      moradores: {
        findUnique: jest.fn(async () => ({ id: 5, id_user: 40, id_condominio: 1, apartamento: '', bloco: '' })),
      },
      visitantes: { findMany: jest.fn(async () => []) },
      encomendas: { findMany: jest.fn(async () => []) },
      ocorrencias: { findMany: jest.fn(async () => []) },
      acessos_Facial: { findMany: jest.fn(async () => []) },
      facial_Devices: { findMany: jest.fn(async () => []) },
    };
    const svc = new MoradoresService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it('com recorte: só as públicas ou as abertas por quem pede', async () => {
    const { svc, prisma } = build();
    await svc.atividade(5, 10);
    expect(prisma.ocorrencias.findMany.mock.calls[0][0].where).toEqual({
      id_condominio: 1,
      user: 40,
      OR: [{ publica: true }, { user: 10 }],
    });
  });

  it('sem recorte: todas as do morador, como antes', async () => {
    const { svc, prisma } = build();
    await svc.atividade(5, null);
    expect(prisma.ocorrencias.findMany.mock.calls[0][0].where).toEqual({ id_condominio: 1, user: 40 });
  });
});
