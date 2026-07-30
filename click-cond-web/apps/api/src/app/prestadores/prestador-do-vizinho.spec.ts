import { ForbiddenException } from '@nestjs/common';
import { PrestadoresService } from './prestadores.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * As rotas de prestador do APP (/prestadores/update e /prestadores/remove)
 * só conferiam o tenant — e morador pertence ao condomínio. Na prática,
 * qualquer morador editava ou apagava o prestador cadastrado pelo vizinho,
 * e também o eletricista do prédio, que é cadastro da administração.
 *
 * A regra espelha a de visitantes: morador mobile só mexe no que está
 * vinculado a um apartamento dele; `id_apartamento` nulo é do condomínio.
 */
describe('PrestadoresService — morador não mexe em prestador alheio', () => {
  const MEU_APTO = 7;
  const APTO_VIZINHO = 8;

  const morador: JwtPayload = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico' };
  const porteiro: JwtPayload = { sub: 52, nome: 'Porteiro', id_condominio: 1 };

  function build(prestador: any) {
    const prisma: any = {
      isConnected: true,
      prestadores_servico: {
        findUnique: jest.fn(async () => prestador),
        update: jest.fn(async () => ({ ...prestador })),
        delete: jest.fn(async () => ({ ...prestador })),
      },
      // O morador 50 mora no apto 7 e só nele.
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 50 && where.id_apto === MEU_APTO ? { id_apto: MEU_APTO } : null,
        ),
      },
      funcionarios_Portaria: { findFirst: jest.fn(async () => null), deleteMany: jest.fn(async () => ({ count: 0 })) },
      sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = {
      syncPrestadorServico: jest.fn(async () => undefined),
      unsyncPrestadorServico: jest.fn(async () => undefined),
    };
    // Tenant liberado: o teste isola a camada de APARTAMENTO.
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      // Só barra funcionário sem o flag; aqui o foco é a camada de apartamento.
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const svc = new PrestadoresService(prisma, storage, facial, tenant);
    return { svc, prisma };
  }

  const doVizinho = { id: 100, id_condominio: 1, id_apartamento: APTO_VIZINHO, face_id: null, email: null, nome: 'Faxineira do 8', telefone: '9999' };
  const doPredio = { id: 101, id_condominio: 1, id_apartamento: null, face_id: null, email: null, nome: 'Eletricista do prédio', telefone: '8888' };
  const meu = { id: 102, id_condominio: 1, id_apartamento: MEU_APTO, face_id: null, email: null, nome: 'Meu pintor', telefone: '7777' };

  describe('update', () => {
    it('NEGA morador editar prestador do vizinho', async () => {
      const { svc, prisma } = build(doVizinho);
      await expect(svc.update(100, { nome: 'Sequestrado' }, 1, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    });

    it('NEGA morador editar prestador do condomínio', async () => {
      const { svc, prisma } = build(doPredio);
      await expect(svc.update(101, { nome: 'Sequestrado' }, 1, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    });

    it('PERMITE morador editar prestador do próprio apartamento', async () => {
      const { svc, prisma } = build(meu);
      await svc.update(102, { nome: 'Meu pintor novo' }, 1, morador);
      expect(prisma.prestadores_servico.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('NEGA morador apagar prestador do vizinho', async () => {
      const { svc, prisma } = build(doVizinho);
      await expect(svc.remove(100, 1, morador)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.delete).not.toHaveBeenCalled();
    });

    it('PERMITE morador apagar prestador do próprio apartamento', async () => {
      const { svc, prisma } = build(meu);
      await svc.remove(102, 1, morador);
      expect(prisma.prestadores_servico.delete).toHaveBeenCalled();
    });
  });

  describe('clearFoto', () => {
    it('NEGA morador limpar a foto do prestador do vizinho', async () => {
      const { svc, prisma } = build(doVizinho);
      await expect(svc.clearFoto(100, 'pessoa', 1, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    });
  });

  describe('administração continua com alcance total', () => {
    it('síndico edita prestador do condomínio', async () => {
      const { svc, prisma } = build(doPredio);
      await svc.update(101, { nome: 'Eletricista novo' }, 1, sindico);
      expect(prisma.prestadores_servico.update).toHaveBeenCalled();
    });

    it('porteiro do console apaga prestador de qualquer apartamento', async () => {
      const { svc, prisma } = build(doVizinho);
      await svc.remove(100, 1, porteiro);
      expect(prisma.prestadores_servico.delete).toHaveBeenCalled();
    });
  });
});
