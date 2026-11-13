import { ForbiddenException } from '@nestjs/common';
import { TenantAccessService } from './tenant-access.service';
import { ApartamentosService } from '../apartamentos/apartamentos.service';
import { OcorrenciasService } from '../ocorrencias/ocorrencias.service';
import { OcorrenciasController } from '../ocorrencias/ocorrencias.controller';
import { CrmController } from '../crm/crm.controller';

/**
 * O token do CRM (sub = crm_admins.id, role 'crm_admin', sem id_condominio) caía no ramo "morador" de
 * assertCondominio (Apartamentos_Users com id_user = crm_admins.id) e a claim `role` sozinha liberava
 * editar/remover apartamento e as categorias globais pelas rotas de tenant, fora do CrmAdminGuard
 * (única reconferência de crm_admins.ativo).
 */
describe('Token do CRM fora das rotas do CRM', () => {
  const crm: any = { sub: 5, nome: 'CRM', role: 'crm_admin' };

  it('assertCondominio recusa o token do CRM sem consultar vínculo de morador', async () => {
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: { findFirst: jest.fn(async () => ({ id_apto: 1 })) },
    };
    await expect(new TenantAccessService(prisma).assertCondominio(1, crm)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.apartamentos_Users.findFirst).not.toHaveBeenCalled();
  });

  describe('apartamentos', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        apartamentos: {
          findUnique: jest.fn(async () => ({ id: 99, apto: '101', bloco: 'A', id_condominio: 2 })),
          update: jest.fn(async () => ({ id: 99 })),
          delete: jest.fn(async () => ({ id: 99 })),
        },
      };
      const tenant: any = {
        assertEntidade: jest.fn(async () => { throw new ForbiddenException('fora do tenant'); }),
        assertPermissaoFuncionario: jest.fn(async () => undefined),
      };
      return { svc: new ApartamentosService(prisma, tenant, { registrar: jest.fn() } as any), prisma };
    }

    it('update/remove pela rota de tenant (sem flag do CRM) não usa o atalho da operadora', async () => {
      const { svc, prisma } = build();
      await expect(svc.update(99, { apto: 'X' }, crm)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.remove(99, crm)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.apartamentos.update).not.toHaveBeenCalled();
      expect(prisma.apartamentos.delete).not.toHaveBeenCalled();
    });

    it('com a flag do CRM o atalho continua valendo', async () => {
      const { svc, prisma } = build();
      await svc.update(99, { apto: 'X' }, crm, { viaCrm: true });
      expect(prisma.apartamentos.update).toHaveBeenCalled();
    });

    it('CrmController passa a flag', async () => {
      const apartamentos: any = {
        create: jest.fn(async () => ({})), update: jest.fn(async () => ({})), remove: jest.fn(async () => ({})),
      };
      const ctrl = new CrmController({} as any, {} as any, {} as any, {} as any, apartamentos, {} as any);
      await ctrl.criarApartamento(2, { apto: '1' }, crm);
      await ctrl.atualizarApartamento(99, { apto: 'X' }, crm);
      await ctrl.removerApartamento(99, crm);
      expect(apartamentos.create).toHaveBeenCalledWith({ apto: '1', id_condominio: 2 }, crm, { viaCrm: true });
      expect(apartamentos.update).toHaveBeenCalledWith(99, { apto: 'X' }, crm, { viaCrm: true });
      expect(apartamentos.remove).toHaveBeenCalledWith(99, crm, { viaCrm: true });
    });
  });

  describe('categorias de ocorrência', () => {
    function build() {
      const prisma: any = {
        ocorrencias_Categorias: {
          create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
          update: jest.fn(async () => ({ id: 1 })),
          delete: jest.fn(async () => ({})),
        },
      };
      return { svc: new OcorrenciasService(prisma, {} as any, {} as any, {} as any), prisma };
    }

    it('rota de tenant com token do CRM: 403', async () => {
      const { svc, prisma } = build();
      const tenantCtrl = new OcorrenciasController(svc);
      for (const c of [
        () => tenantCtrl.createCategoria({ nome: 'X' }, crm),
        () => tenantCtrl.updateCategoria(1, { nome: 'X' }, crm),
        () => tenantCtrl.removeCategoria(1, crm),
      ]) {
        await expect(Promise.resolve().then(c)).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(prisma.ocorrencias_Categorias.create).not.toHaveBeenCalled();
      expect(prisma.ocorrencias_Categorias.update).not.toHaveBeenCalled();
      expect(prisma.ocorrencias_Categorias.delete).not.toHaveBeenCalled();
    });

    it('rota do CRM continua gravando', async () => {
      const { svc, prisma } = build();
      const ctrl = new CrmController({} as any, {} as any, {} as any, {} as any, {} as any, svc);
      await ctrl.criarCategoria({ nome: 'X' }, crm);
      await ctrl.atualizarCategoria(1, { nome: 'Y' }, crm);
      await ctrl.removerCategoria(1, crm);
      expect(prisma.ocorrencias_Categorias.create).toHaveBeenCalled();
      expect(prisma.ocorrencias_Categorias.update).toHaveBeenCalled();
      expect(prisma.ocorrencias_Categorias.delete).toHaveBeenCalled();
    });
  });
});
