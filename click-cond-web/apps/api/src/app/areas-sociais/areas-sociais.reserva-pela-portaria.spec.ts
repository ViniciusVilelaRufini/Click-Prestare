import { BadRequestException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';

/**
 * Reserva feita pela portaria-web em nome de um apartamento
 * (agendarPeloSindico). Sem morador vinculado ao apto, o dono ficava sendo
 * `userId` — que no token do porteiro é Funcionarios_Portaria.id: a reserva
 * ia para o morador de mesmo número (ou estourava a FK para Users). E o
 * apartamento não era conferido contra o condomínio da área.
 */
describe('Reserva pela portaria — dono e apartamento', () => {
  function montar(opts: { vinculo?: any; apto?: any }) {
    const prisma: any = {
      isConnected: true,
      areas_Sociais: { findUnique: jest.fn(async () => ({ id: 4, id_condominio: 1, nome: 'Salão' })) },
      apartamentos: { findUnique: jest.fn(async () => opts.apto ?? { id: 10, id_condominio: 1 }) },
      apartamentos_Users: { findFirst: jest.fn(async () => opts.vinculo ?? null) },
      areas_Sociais_Agendamentos: { create: jest.fn(async () => ({ id: 1 })) },
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const svc = new AreasSociaisService(prisma, {} as any, {} as any, {} as any, tenant);
    return { svc, prisma };
  }

  const porteiro = { sub: 7, nome: 'QA_SECURITY_20260923 porteiro', id_condominio: 1 } as any;
  const reserva = { id_area_social: 4, id_apartamento: 10, agendarPeloSindico: true, data: '2026-10-01' };

  it('apto sem morador vinculado: recusa em vez de pôr a reserva no sub do porteiro', async () => {
    const { svc, prisma } = montar({});
    await expect(svc.insertAgendamento({ ...reserva }, 7, 'Morador', porteiro)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
  });

  it('apartamento de outro condomínio é recusado', async () => {
    const { svc, prisma } = montar({ apto: { id: 10, id_condominio: 2 }, vinculo: { id_user: 55 } });
    await expect(svc.insertAgendamento({ ...reserva }, 7, 'Morador', porteiro)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
  });
});
