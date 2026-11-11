import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TagsService } from './tags.service';
import { TagsController } from './tags.controller';
import { VeiculosService } from './veiculos.service';

/**
 * Tags de veículo: código gravado normalizado, bloqueio/reativação, exclusão
 * e a regra "uma tag, um veículo ativo" também no cadastro da portaria.
 */
describe('TagsService', () => {
  function build(tags: any[] = []) {
    const prisma: any = {
      tags: {
        upsert: jest.fn(async ({ where, create }: any) => ({ id: 1, ...create, ...where.id_condominio_codigo })),
        findMany: jest.fn(async () => tags),
        findFirst: jest.fn(async ({ where }: any) =>
          tags.find((t) => t.id === where.id && t.id_condominio === where.id_condominio) ?? null,
        ),
        update: jest.fn(async ({ where, data }: any) => ({ ...tags.find((t) => t.id === where.id), ...data })),
        delete: jest.fn(async () => ({})),
      },
      veiculos: { updateMany: jest.fn(async () => ({ count: 1 })) },
      // Unicidade por variantes (assertTagNaoEmUso): sem conflito por padrão.
      // A regra em si está em common/tag-em-uso.util.spec.ts.
      moradores: { findFirst: jest.fn(async () => null) },
      visitantes: { findFirst: jest.fn(async () => null) },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    return { svc: new TagsService(prisma), prisma };
  }

  describe('cadastro grava o código normalizado', () => {
    it.each([
      [' bc:61:4e ', 'BC614E'],
      ['0012345678', '12345678'],
      ['188,24910', '12345678'],
    ])('%p é gravado como %p', async (bruto, esperado) => {
      const { svc, prisma } = build();

      await svc.upsert(1, { codigo: bruto });

      const args = prisma.tags.upsert.mock.calls[0][0];
      expect(args.where.id_condominio_codigo).toEqual({ id_condominio: 1, codigo: esperado });
      expect(args.create.codigo).toBe(esperado);
    });

    it.each([[''], ['   '], [undefined], [null], ['TAG_#1'], ['F'.repeat(65)]])(
      'código vazio/inválido %p é recusado e nada é gravado',
      async (bruto) => {
        const { svc, prisma } = build();

        await expect(svc.upsert(1, { codigo: bruto as any })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.tags.upsert).not.toHaveBeenCalled();
      },
    );
  });

  describe('tag bloqueada não é reativada pelo cadastro', () => {
    it('POST com o código de uma tag bloqueada é recusado e nada é gravado', async () => {
      const { svc, prisma } = build();
      prisma.tags.findFirst = jest.fn(async ({ where }: any) =>
        where.codigo === '12345678' && where.ativo === 0 ? { id: 9, codigo: '12345678', ativo: 0 } : null,
      );

      await expect(svc.upsert(1, { codigo: '0012345678' })).rejects.toThrow(/bloqueada/i);

      expect(prisma.tags.findFirst).toHaveBeenCalledWith({
        where: { id_condominio: 1, codigo: '12345678', ativo: 0 },
      });
      expect(prisma.tags.upsert).not.toHaveBeenCalled();
    });
  });

  describe('listar', () => {
    it('por padrão só as ativas; com incluirInativas traz as bloqueadas (para reativar)', async () => {
      const { svc, prisma } = build();

      await svc.findAll(1);
      await svc.findAll(1, false, true);

      expect(prisma.tags.findMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({ id_condominio: 1, ativo: 1 }),
      );
      expect(prisma.tags.findMany.mock.calls[1][0].where).not.toHaveProperty('ativo');
    });
  });

  describe('bloquear / reativar', () => {
    const TAGS = [{ id: 70, id_condominio: 1, codigo: 'BC614E', ativo: 1 }];

    it('bloqueia a tag do condomínio', async () => {
      const { svc, prisma } = build(TAGS);

      await svc.definirAtivo(1, 70, false);

      expect(prisma.tags.update).toHaveBeenCalledWith({ where: { id: 70 }, data: { ativo: 0 } });
    });

    it('reativa', async () => {
      const { svc, prisma } = build(TAGS);

      await svc.definirAtivo(1, 70, 1);

      expect(prisma.tags.update).toHaveBeenCalledWith({ where: { id: 70 }, data: { ativo: 1 } });
    });

    it('tag de OUTRO condomínio: 404, sem alterar', async () => {
      const { svc, prisma } = build(TAGS);

      await expect(svc.definirAtivo(2, 70, false)).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.tags.update).not.toHaveBeenCalled();
    });

    it.each([[undefined], [null], ['sim'], [2]])('valor de ativo inválido %p é recusado', async (ativo) => {
      const { svc, prisma } = build(TAGS);

      await expect(svc.definirAtivo(1, 70, ativo as any)).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.tags.update).not.toHaveBeenCalled();
    });
  });

  describe('excluir', () => {
    const TAGS = [{ id: 70, id_condominio: 1, codigo: 'BC614E', ativo: 1 }];

    it('desvincula dos veículos e apaga a tag', async () => {
      const { svc, prisma } = build(TAGS);

      await expect(svc.remove(1, 70)).resolves.toEqual({ ok: true });

      expect(prisma.veiculos.updateMany).toHaveBeenCalledWith({
        where: { id_tag: 70, id_condominio: 1 },
        data: { id_tag: null },
      });
      expect(prisma.tags.delete).toHaveBeenCalledWith({ where: { id: 70 } });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('tag de OUTRO condomínio: 404, sem apagar nem desvincular', async () => {
      const { svc, prisma } = build(TAGS);

      await expect(svc.remove(2, 70)).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.veiculos.updateMany).not.toHaveBeenCalled();
      expect(prisma.tags.delete).not.toHaveBeenCalled();
    });
  });
});

describe('TagsController — bloquear/excluir exigem operador', () => {
  const porteiro = { sub: 3, nome: 'Porteiro', id_condominio: 1, turno: 'Diurno' } as any;
  const morador = { sub: 7, typeAccess: 'Morador', user: { typeAccess: 'Morador' } } as any;

  function montar() {
    const service: any = {
      findAll: jest.fn(async () => []),
      definirAtivo: jest.fn(async () => ({ id: 70, ativo: 0 })),
      remove: jest.fn(async () => ({ ok: true })),
    };
    return { ctrl: new TagsController(service), service };
  }

  it('morador não bloqueia nem exclui', () => {
    const { ctrl, service } = montar();

    expect(() => ctrl.update(1, 70, { ativo: false }, morador)).toThrow(ForbiddenException);
    expect(() => ctrl.remove(1, 70, morador)).toThrow(ForbiddenException);

    expect(service.definirAtivo).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('operador bloqueia e exclui, sempre no condomínio da rota', async () => {
    const { ctrl, service } = montar();

    await ctrl.update(1, 70, { ativo: false }, porteiro);
    await ctrl.remove(1, 70, porteiro);

    expect(service.definirAtivo).toHaveBeenCalledWith(1, 70, false);
    expect(service.remove).toHaveBeenCalledWith(1, 70);
  });

  it('listar com ?inativas=true repassa o pedido', async () => {
    const { ctrl, service } = montar();

    await ctrl.list(1, porteiro, undefined, 'true');

    expect(service.findAll).toHaveBeenCalledWith(1, false, true);
  });
});

describe('VeiculosService — tag já vinculada a outro veículo ativo', () => {
  function build(veiculoComATag: any | null) {
    const prisma: any = {
      moradores: { findFirst: jest.fn(async () => ({ id: 10 })) },
      tags: { findFirst: jest.fn(async () => ({ id: 70 })) },
      veiculos: {
        findFirst: jest.fn(async ({ where }: any) => {
          // Busca do próprio veículo (update/remove).
          if (typeof where.id === 'number') return { id: where.id, id_condominio: 1 };
          // Checagem "tag em outro veículo ativo".
          if (where.id_tag !== undefined) {
            if (!veiculoComATag || where.ativo !== 1) return null;
            if (where.id?.not === veiculoComATag.id) return null;
            return veiculoComATag;
          }
          return null;
        }),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 5, ...data })),
      },
    };
    return { svc: new VeiculosService(prisma), prisma };
  }

  it('NEGA cadastrar veículo com tag que já está em outro veículo ativo', async () => {
    const { svc, prisma } = build({ id: 9 });

    await expect(svc.create(1, 10, { placa: 'AAA0A00', id_tag: 70 })).rejects.toThrow(
      'Esta tag já está vinculada a outro veículo.',
    );

    expect(prisma.veiculos.create).not.toHaveBeenCalled();
  });

  it('NEGA trocar a tag do veículo por uma que já está em outro veículo ativo', async () => {
    const { svc, prisma } = build({ id: 9 });

    await expect(svc.update(1, 5, { placa: 'AAA0A00', id_tag: 70 })).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(prisma.veiculos.update).not.toHaveBeenCalled();
  });

  it('PERMITE regravar o próprio veículo mantendo a tag dele', async () => {
    const { svc, prisma } = build({ id: 5 });

    await svc.update(1, 5, { placa: 'AAA0A00', id_tag: 70 });

    expect(prisma.veiculos.update).toHaveBeenCalled();
  });

  it('PERMITE tag livre', async () => {
    const { svc, prisma } = build(null);

    await svc.create(1, 10, { placa: 'AAA0A00', id_tag: 70 });

    expect(prisma.veiculos.create).toHaveBeenCalled();
  });
});
