import { ForbiddenException } from '@nestjs/common';
import { PrestadoresService } from './prestadores.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * A unidade do prestador vinha do corpo e era gravada como veio: o morador
 * apontava o próprio prestador para o apto do vizinho, para "do prédio"
 * (null — diretório visível a todos e tratado como da administração) ou para
 * um apartamento de OUTRO condomínio.
 */
describe('PrestadoresService — id_apartamento gravado só se for do condomínio (e do morador)', () => {
  const MEU_APTO = 7;
  const APTO_VIZINHO = 8;
  const APTO_OUTRO_COND = 90;
  const morador: JwtPayload = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico' };
  const meu = { id: 102, id_condominio: 1, id_apartamento: MEU_APTO, email: null, nome: 'Meu pintor', telefone: '7777' };

  function build(existente: any = null) {
    const prisma: any = {
      isConnected: true,
      prestadores_servico: {
        findFirst: jest.fn(async () => existente),
        findUnique: jest.fn(async () => meu),
        update: jest.fn(async ({ data }: any) => ({ ...meu, ...data })),
        create: jest.fn(async ({ data }: any) => ({ id: 999, ...data })),
      },
      apartamentos: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === APTO_OUTRO_COND ? { id_condominio: 2 } : { id_condominio: 1 },
        ),
      },
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 50 && where.id_apto === MEU_APTO ? { id_apto: MEU_APTO } : null,
        ),
      },
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = { syncPrestadorServico: jest.fn(async () => undefined) };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    return { svc: new PrestadoresService(prisma, storage, facial, tenant), prisma };
  }

  describe('create', () => {
    it('NEGA morador cadastrar prestador no apto do vizinho', async () => {
      const { svc, prisma } = build();
      await expect(svc.create({ nome: 'X', id_condominio: 1, id_apartamento: APTO_VIZINHO }, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.create).not.toHaveBeenCalled();
    });

    it('NEGA morador cadastrar prestador "do prédio" (sem unidade)', async () => {
      const { svc, prisma } = build();
      await expect(svc.create({ nome: 'X', id_condominio: 1 }, morador)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.create).not.toHaveBeenCalled();
    });

    it('NEGA apartamento de outro condomínio, mesmo para o síndico', async () => {
      const { svc, prisma } = build();
      await expect(svc.create({ nome: 'X', id_condominio: 1, id_apartamento: APTO_OUTRO_COND }, sindico))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.create).not.toHaveBeenCalled();
    });

    it('NEGA o upsert por nome mover o prestador do morador para o vizinho', async () => {
      const { svc, prisma } = build(meu);
      await expect(svc.create({ nome: 'Meu pintor', id_condominio: 1, id_apartamento: APTO_VIZINHO }, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    });

    it('PERMITE morador no próprio apto e síndico sem unidade (prestador do prédio)', async () => {
      const { svc, prisma } = build();
      await svc.create({ nome: 'X', id_condominio: 1, id_apartamento: MEU_APTO }, morador);
      await svc.create({ nome: 'Y', id_condominio: 1 }, sindico);
      expect(prisma.prestadores_servico.create).toHaveBeenCalledTimes(2);
      expect(prisma.prestadores_servico.create.mock.calls[0][0].data.id_apartamento).toBe(MEU_APTO);
      expect(prisma.prestadores_servico.create.mock.calls[1][0].data.id_apartamento).toBeNull();
    });
  });

  describe('update', () => {
    it('NEGA morador mover o próprio prestador para "do prédio" (null)', async () => {
      const { svc, prisma } = build();
      await expect(svc.update(102, { id_apartamento: null as any }, undefined, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    });

    it('NEGA morador mover o próprio prestador para o apto do vizinho', async () => {
      const { svc, prisma } = build();
      await expect(svc.update(102, { id_apartamento: APTO_VIZINHO }, undefined, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    });

    it('PERMITE editar sem mexer na unidade (não consulta apartamento)', async () => {
      const { svc, prisma } = build();
      await svc.update(102, { nome: 'Pintor novo' }, undefined, morador);
      expect(prisma.prestadores_servico.update).toHaveBeenCalled();
      expect(prisma.apartamentos.findUnique).not.toHaveBeenCalled();
    });
  });
});
