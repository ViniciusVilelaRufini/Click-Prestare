import { ConflictException } from '@nestjs/common';
import { ApartamentosService } from './apartamentos.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * `remove()` conta quantas visitas vão embora em cascata para compor a
 * mensagem de auditoria (`arrastados.visitantes`). Task "Lote C": essa
 * contagem precisa ler de `Visitas` quando a flag da migração
 * Pessoas/Visitas está ligada, sem nunca misturar fontes.
 *
 * Com a flag ligada, `Visitas → Apartamentos` é RESTRICT (não CASCADE como
 * `Visitantes → Apartamentos` era) — histórico de acesso físico não pode
 * sumir em cascata. Por isso remove() recusa explicitamente quando há
 * visitas, em vez de deixar o .delete() estourar P2003 cru.
 */
describe('ApartamentosService — contagem de visitantes em remove() (Pessoas/Visitas)', () => {
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico', id_condominio: 1 };
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function build() {
    const prisma: any = {
      isConnected: true,
      apartamentos: {
        findUnique: jest.fn(async () => ({ id_condominio: 1, apto: '101', bloco: 'A' })),
        delete: jest.fn(async () => ({ id: 5 })),
      },
      apartamentos_Users: { count: jest.fn(async () => 2) },
      visitantes: { count: jest.fn(async () => 7) },
      visitas: { count: jest.fn(async () => 3) },
      vagas: { count: jest.fn(async () => 1) },
      areas_Sociais_Agendamentos: { count: jest.fn(async () => 0) },
      mudancas: { count: jest.fn(async () => 0) },
    };
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertCondominio: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const svc = new ApartamentosService(prisma, tenant, auditoria);
    return { svc, prisma };
  }

  it('flag OFF: conta contra Visitantes e nunca toca Visitas', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const { svc, prisma } = build();
    const r: any = await svc.remove(5, sindico);
    expect(r.arrastados.visitantes).toBe(7);
    expect(prisma.visitantes.count).toHaveBeenCalled();
    expect(prisma.visitas.count).not.toHaveBeenCalled();
  });

  it('flag ON com visitas > 0: recusa e não chama delete', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma } = build(); // mock padrão: visitas.count = 3
    await expect(svc.remove(5, sindico)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.visitas.count).toHaveBeenCalled();
    expect(prisma.visitantes.count).not.toHaveBeenCalled();
    expect(prisma.apartamentos.delete).not.toHaveBeenCalled();
  });

  it('flag ON sem visitas: remove normalmente, contra Visitas', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma } = build();
    prisma.visitas.count = jest.fn(async () => 0);
    const r: any = await svc.remove(5, sindico);
    expect(r.arrastados.visitantes).toBe(0);
    expect(prisma.visitas.count).toHaveBeenCalled();
    expect(prisma.visitantes.count).not.toHaveBeenCalled();
    expect(prisma.apartamentos.delete).toHaveBeenCalled();
  });
});
