import { ForbiddenException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * `cadastrar_visitante` era cobrada só no create(): o funcionário restringido
 * pelo síndico seguia editando (datas, apartamento, identidade) e apagando
 * qualquer visita do condomínio. Editar/excluir é o mesmo "cadastro" — mesmo
 * critério dos prestadores (update/remove).
 */
describe('VisitantesService — flag cadastrar_visitante em editar/excluir visita', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const funcionario: JwtPayload = { sub: 5, nome: 'Zelador', typeAccess: 'Funcionario' };

  function build(flag: number) {
    const visita = {
      id: 50,
      id_pessoa: 7,
      id_condominio: 1,
      id_apartamento: 100,
      is_prestador: 0,
      data_entrada: null,
      data_saida: null,
      pessoa: { id: 7, nome: 'Fulano', doc_identificacao: null, face_id: null },
    };
    const visitante = { id: 500, id_condominio: 1, id_apartamento: 100, nome: 'Fulano', is_prestador: 0, face_id: null };
    const prisma: any = {
      isConnected: true,
      // Vínculo com o condomínio 1 e a flag saem da mesma linha.
      funcionarios: { findFirst: jest.fn(async () => ({ id: 1, cadastrar_visitante: flag })) },
      pessoas: { update: jest.fn(async () => ({ id: 7, nome: 'X' })) },
      visitas: {
        findUnique: jest.fn(async () => ({ ...visita })),
        update: jest.fn(async () => ({ ...visita, apartamento: { bloco: 'A', apto: '100' } })),
        delete: jest.fn(async () => ({ ...visita })),
      },
      visitantes: {
        findUnique: jest.fn(async () => ({ ...visitante })),
        update: jest.fn(async () => ({ ...visitante })),
        delete: jest.fn(async () => ({ ...visitante })),
      },
      vagas: { updateMany: jest.fn(async () => ({ count: 0 })) },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const facial: any = {
      syncPessoa: jest.fn().mockResolvedValue({}),
      syncVisitante: jest.fn().mockResolvedValue({}),
      unsyncVisitante: jest.fn().mockResolvedValue(true),
    };
    const tenant = new TenantAccessService(prisma);
    const svc = new VisitantesService(
      prisma,
      {} as any,
      { isDataUrl: () => false, uploadDataUrl: jest.fn() } as any,
      facial,
      { registrar: jest.fn() } as any,
      tenant,
    );
    return { svc, prisma };
  }

  describe('Pessoas/Visitas (flag de migração ligada)', () => {
    beforeEach(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    });

    it('NEGA editar visita sem a flag', async () => {
      const { svc, prisma } = build(0);
      await expect(svc.update({ id: 50, nome: 'X' } as any, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.visitas.update).not.toHaveBeenCalled();
    });

    it('NEGA excluir visita sem a flag', async () => {
      const { svc, prisma } = build(0);
      await expect(svc.remove(50, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.visitas.delete).not.toHaveBeenCalled();
    });

    it('PERMITE excluir com a flag', async () => {
      const { svc, prisma } = build(1);
      await expect(svc.remove(50, funcionario)).resolves.toEqual({ success: true });
      expect(prisma.visitas.delete).toHaveBeenCalled();
    });
  });

  describe('legado Visitantes (flag de migração desligada)', () => {
    beforeEach(() => {
      delete process.env['PESSOAS_MIGRATION_ENABLED'];
    });

    it('NEGA editar visita sem a flag', async () => {
      const { svc, prisma } = build(0);
      await expect(svc.update({ id: 500, dias_semana: 'seg' } as any, funcionario)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.visitantes.update).not.toHaveBeenCalled();
    });

    it('NEGA excluir visita sem a flag', async () => {
      const { svc, prisma } = build(0);
      await expect(svc.remove(500, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.visitantes.delete).not.toHaveBeenCalled();
    });
  });
});
