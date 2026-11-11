import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

/**
 * `/vagas/liberar` (app do morador) gravava `id_veiculo` do corpo sem conferir
 * de quem era o carro, e o inquilino beneficiário só era conferido contra o
 * condomínio: qualquer morador prendia a vaga do seu apto ao carro de outra
 * unidade, ou ao morador de outro apartamento do prédio — que passava a
 * aparecer como ocupante da vaga.
 *
 * Regra: o veículo é de um morador do MESMO apartamento do chamador, e o
 * beneficiário é morador desse apartamento (mesmo critério bloco/apto de
 * `moradoresDoApto`).
 */
describe('MobileAuthService.liberarVaga — veículo e beneficiário do apartamento', () => {
  const APTO = { id: 10, id_condominio: 1, bloco: 'A', apto: '101', qtd_vagas: 3 };
  const CTX = { moradorId: 5, idCondominio: 1, apto: APTO };
  const MORADORES_DO_APTO = [{ id: 5 }, { id: 6 }];

  // Moradores: 5 e 6 são do 101-A; 7 é do 202-B do mesmo condomínio.
  const MORADORES: Record<number, any> = {
    5: { id: 5, id_condominio: 1, bloco: 'A', apartamento: '101' },
    6: { id: 6, id_condominio: 1, bloco: 'A', apartamento: '101' },
    7: { id: 7, id_condominio: 1, bloco: 'B', apartamento: '202' },
  };
  // Veículos: 30 é do morador 6 (mesmo apto); 40 é do morador 7 (outro apto).
  const VEICULOS: Record<number, any> = {
    30: { id: 30, id_morador: 6, id_condominio: 1, ativo: 1 },
    40: { id: 40, id_morador: 7, id_condominio: 1, ativo: 1 },
  };

  const casa = (row: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (v === undefined) return true;
      if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.includes(row[k]);
      return row[k] === v;
    });

  function build() {
    const prisma: any = {
      isConnected: true,
      vagas: {
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: any) => ({ id: 99, ...data })),
      },
      veiculos: {
        count: jest.fn(async () => 0),
        findFirst: jest.fn(async ({ where }: any) =>
          Object.values(VEICULOS).find((v) => casa(v, where)) ?? null,
        ),
      },
      moradores: {
        findFirst: jest.fn(async ({ where }: any) =>
          Object.values(MORADORES).find((m) => casa(m, where)) ?? null,
        ),
        findMany: jest.fn(async () => MORADORES_DO_APTO),
      },
    };
    const facial: any = { syncVisitante: jest.fn(async () => ({ ok: true })) };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, facial);
    jest.spyOn(svc as any, 'resolveMoradorApto').mockResolvedValue(CTX);
    return { svc, prisma };
  }

  it('RECUSA veículo de morador de outro apartamento', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.liberarVaga(1, 1, { tipo: 'inquilino', id_morador_beneficiario: 6, id_veiculo: 40 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vagas.create).not.toHaveBeenCalled();
  });

  it('RECUSA veículo inexistente', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.liberarVaga(1, 1, { tipo: 'inquilino', id_morador_beneficiario: 6, id_veiculo: 999 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vagas.create).not.toHaveBeenCalled();
  });

  it('RECUSA beneficiário morador de outro apartamento do condomínio', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.liberarVaga(1, 1, { tipo: 'inquilino', id_morador_beneficiario: 7 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vagas.create).not.toHaveBeenCalled();
  });

  it('ACEITA veículo e beneficiário do mesmo apartamento', async () => {
    const { svc, prisma } = build();
    await svc.liberarVaga(1, 1, { tipo: 'inquilino', id_morador_beneficiario: 6, id_veiculo: 30 });
    expect(prisma.vagas.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id_veiculo: 30, id_morador_beneficiario: 6, id_apartamento: 10 }),
      }),
    );
  });

  it('sem id_veiculo continua aceitando (o carro é opcional)', async () => {
    const { svc, prisma } = build();
    await svc.liberarVaga(1, 1, { tipo: 'inquilino', id_morador_beneficiario: 6 });
    expect(prisma.vagas.create.mock.calls[0][0].data.id_veiculo).toBeNull();
    expect(prisma.veiculos.findFirst).not.toHaveBeenCalled();
  });
});
