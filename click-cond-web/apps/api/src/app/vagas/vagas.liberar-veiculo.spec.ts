import { BadRequestException } from '@nestjs/common';
import { VagasService } from './vagas.service';

describe('VagasService.liberar — veículo precisa ser de morador deste apartamento/condomínio', () => {
  const APTO = { id: 10, id_condominio: 1, bloco: 'A', apto: '101', qtd_vagas: 2 };
  const MORADORES = [{ id: 5, nome: 'Titular', tipo: 'Morador' }, { id: 6, nome: 'Inquilino', tipo: 'Inquilino' }];
  // Veículo 99 é de outro condomínio; 40 é do titular deste apto.
  const VEICULOS = [
    { id: 99, id_condominio: 2, id_morador: 77, placa: 'TST0B00' },
    { id: 40, id_condominio: 1, id_morador: 5, placa: 'TST1A11' },
  ];

  function build() {
    const prisma: any = {
      isConnected: true,
      vagas: {
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: any) => ({
          id: 1, ...data, veiculo: VEICULOS.find((v) => v.id === data.id_veiculo) ?? null,
          visitante: null, visita: null, beneficiario: { nome: 'Inquilino' }, titular: { nome: 'Titular' },
        })),
      },
      veiculos: {
        count: jest.fn(async () => 0),
        findFirst: jest.fn(async ({ where }: any) =>
          VEICULOS.find((v) => v.id === where.id && v.id_condominio === where.id_condominio && where.id_morador.in.includes(v.id_morador)) ?? null,
        ),
      },
    };
    const svc = new VagasService(prisma, { syncVisitante: jest.fn() } as any);
    jest.spyOn(svc as any, 'resolveApartamento').mockResolvedValue(APTO);
    jest.spyOn(svc as any, 'moradoresDoApto').mockResolvedValue(MORADORES);
    return { svc, prisma };
  }
  const body = (id_veiculo: number) => ({ id_morador_titular: 5, tipo: 'inquilino', id_morador_beneficiario: 6, id_veiculo });

  it('veículo de outro condomínio: 400 e nenhuma vaga criada', async () => {
    const { svc, prisma } = build();
    await expect(svc.liberar(1, APTO.id, body(99))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vagas.create).not.toHaveBeenCalled();
  });

  it('veículo de morador do apartamento: grava', async () => {
    const { svc, prisma } = build();
    await svc.liberar(1, APTO.id, body(40));
    expect(prisma.vagas.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id_veiculo: 40 }) }));
  });
});
