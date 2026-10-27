import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VeiculosService } from './veiculos.service';

/**
 * O TenantGuard só amarra o :idCondominio da URL. O morador (URL) e a tag
 * (corpo) eram gravados sem conferir o condomínio: o operador do condomínio 1
 * ligava veículo a morador do 2 (aparece no app dele, consome a vaga dele) ou
 * a uma tag do 2 — e a resposta trazia tag.codigo, a credencial RFID alheia.
 */
describe('VeiculosService — morador e tag precisam ser do condomínio da rota', () => {
  function build() {
    const prisma: any = {
      // Morador 10 e tag 70 são do condomínio 1; morador 20 e tag 80, do 2.
      moradores: {
        findFirst: jest.fn(async ({ where }: any) => (where.id === 10 && where.id_condominio === 1 ? { id: 10 } : null)),
      },
      tags: {
        findFirst: jest.fn(async ({ where }: any) => (where.id === 70 && where.id_condominio === 1 ? { id: 70 } : null)),
      },
      veiculos: {
        create: jest.fn(async ({ data }: any) => ({
          id: 1,
          ...data,
          tag: data.id_tag ? { id: data.id_tag, codigo: 'DUMMY' } : null,
        })),
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === 5 && where.id_condominio === 1 ? { id: 5, id_condominio: 1 } : null,
        ),
        update: jest.fn(async ({ data }: any) => ({ id: 5, ...data })),
      },
    };
    return { svc: new VeiculosService(prisma), prisma };
  }

  it('NEGA cadastrar veículo para morador de outro condomínio', async () => {
    const { svc, prisma } = build();
    await expect(svc.create(1, 20, { placa: 'AAA0A00' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.veiculos.create).not.toHaveBeenCalled();
  });

  it('NEGA cadastrar veículo com tag de outro condomínio', async () => {
    const { svc, prisma } = build();
    await expect(svc.create(1, 10, { placa: 'AAA0A00', id_tag: 80 })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.veiculos.create).not.toHaveBeenCalled();
  });

  it('NEGA trocar a tag do veículo por uma de outro condomínio (e não devolve o codigo)', async () => {
    const { svc, prisma } = build();
    await expect(svc.update(1, 5, { placa: 'AAA0A01', id_tag: 80 })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.veiculos.update).not.toHaveBeenCalled();
  });

  it('PERMITE morador e tag do próprio condomínio', async () => {
    const { svc, prisma } = build();
    await svc.create(1, 10, { placa: 'AAA0A00', id_tag: 70 });
    expect(prisma.veiculos.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id_morador: 10, id_tag: 70, id_condominio: 1 }) }),
    );
  });

  it('PERMITE editar sem tag sem consultar Tags', async () => {
    const { svc, prisma } = build();
    await svc.update(1, 5, { placa: 'AAA0A01', id_tag: null });
    expect(prisma.tags.findFirst).not.toHaveBeenCalled();
    expect(prisma.veiculos.update).toHaveBeenCalled();
  });
});
