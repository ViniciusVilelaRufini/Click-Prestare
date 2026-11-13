import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OcorrenciasService } from './ocorrencias.service';
import { OcorrenciasController } from './ocorrencias.controller';
import { OcorrenciasMobileController } from '../auth/mobile-auth.controller';
import { CrmController } from '../crm/crm.controller';
import { CrmAdminGuard } from '../crm/crm-admin.guard';

/**
 * Ocorrencias_Categorias não tem id_condominio: qualquer síndico (inclusive o
 * criado pelo signup público) alterava nome e SLA das ocorrências de todos os
 * prédios. Agora a escrita é só do administrador do CRM.
 */
describe('Categorias de ocorrência: escrita só pelo CRM', () => {
  const MSG = 'As categorias são definidas pela Prestare.';
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };
  const funcionario: any = { sub: 2, typeAccess: 'Funcionario' };
  const morador: any = { sub: 3, typeAccess: 'Morador' };
  const admin: any = { sub: 9, role: 'crm_admin' };

  function build() {
    const prisma: any = {
      ocorrencias_Categorias: {
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        delete: jest.fn(async () => ({})),
        findMany: jest.fn(async () => [{ id: 1, nome: 'Barulho', prioridade: 1 }]),
      },
    };
    return { svc: new OcorrenciasService(prisma, {} as any, {} as any), prisma };
  }

  for (const [nome, user] of [['síndico', sindico], ['funcionário', funcionario], ['morador', morador]] as const) {
    it(`service nega criar/atualizar/remover para ${nome} com a mensagem definida`, async () => {
      const { svc, prisma } = build();
      for (const f of [
        () => svc.createCategoria({ nome: 'X' }, user),
        () => svc.updateCategoria(1, { nome: 'X' }, user),
        () => svc.removeCategoria(1, user),
      ]) {
        const e: any = await f().catch((x) => x);
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.message).toBe(MSG);
      }
      expect(prisma.ocorrencias_Categorias.create).not.toHaveBeenCalled();
      expect(prisma.ocorrencias_Categorias.update).not.toHaveBeenCalled();
      expect(prisma.ocorrencias_Categorias.delete).not.toHaveBeenCalled();
    });
  }

  it('service permite o administrador do CRM', async () => {
    const { svc, prisma } = build();
    await svc.createCategoria({ nome: 'X', sla_horas: 4 }, admin, { viaCrm: true });
    await svc.updateCategoria(1, { nome: 'Y' }, admin, { viaCrm: true });
    await svc.removeCategoria(1, admin, { viaCrm: true });
    expect(prisma.ocorrencias_Categorias.create).toHaveBeenCalled();
    expect(prisma.ocorrencias_Categorias.update).toHaveBeenCalled();
    expect(prisma.ocorrencias_Categorias.delete).toHaveBeenCalled();
  });

  it('listagem segue aberta (sem checagem de papel)', async () => {
    const { svc } = build();
    expect(await svc.listCategorias()).toHaveLength(1);
  });

  it('rotas do app e do console devolvem 403 ao síndico', async () => {
    const { svc, prisma } = build();
    const app = new OcorrenciasMobileController({} as any, svc);
    const consolee = new OcorrenciasController(svc);
    const chamadas = [
      () => app.insertCategoria({ nome: 'X' }, sindico),
      () => app.updateCategoria({ id: 1, nome: 'X' }, sindico),
      () => app.removeCategoria({ id: 1 }, sindico),
      () => consolee.createCategoria({ nome: 'X' }, sindico),
      () => consolee.updateCategoria(1, { nome: 'X' }, sindico),
      () => consolee.removeCategoria(1, sindico),
    ];
    for (const c of chamadas) {
      const e: any = await Promise.resolve().then(c).catch((x) => x);
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(e.message).toBe(MSG);
    }
    expect(prisma.ocorrencias_Categorias.create).not.toHaveBeenCalled();
    expect(prisma.ocorrencias_Categorias.delete).not.toHaveBeenCalled();
  });

  it('rotas do CRM gravam para o admin e exigem CrmAdminGuard', async () => {
    const { svc, prisma } = build();
    const crm = new CrmController({} as any, {} as any, {} as any, {} as any, {} as any, svc);
    await crm.criarCategoria({ nome: 'X' }, admin);
    await crm.atualizarCategoria(1, { nome: 'Y' }, admin);
    expect(await crm.removerCategoria(1, admin)).toEqual({ ok: true });
    expect(prisma.ocorrencias_Categorias.create).toHaveBeenCalled();
    expect(prisma.ocorrencias_Categorias.update).toHaveBeenCalled();
    expect(prisma.ocorrencias_Categorias.delete).toHaveBeenCalled();
    for (const m of ['criarCategoria', 'atualizarCategoria', 'removerCategoria']) {
      const guards = Reflect.getMetadata(GUARDS_METADATA, (CrmController.prototype as any)[m]);
      expect(guards).toContain(CrmAdminGuard);
    }
  });
});
