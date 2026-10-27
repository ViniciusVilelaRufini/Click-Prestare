import { ForbiddenException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * POST /areas-sociais/agendamento/update gravava data, horário, convidados e
 * STATUS de qualquer reserva do condomínio só com o vínculo de tenant: um
 * morador auto-aprovava a própria reserva (e o tick facial enrolava o
 * apartamento no terminal da área) ou cancelava/remarcava a do vizinho.
 * Editar reserva é operação — mesmo par de checagens do updateStatusAgendamento.
 */
describe('AreasSociaisService.updateAgendamento — exige operador e flag areas_sociais', () => {
  function build(flagAreas = 1) {
    const prisma: any = {
      isConnected: true,
      areas_Sociais_Agendamentos: {
        // Reserva 10 é do morador 1 (apto 100), condomínio 1, ainda pendente.
        findUnique: jest.fn(async () => ({
          id: 10,
          id_user: 1,
          id_apartamento: 100,
          status: 'pendente',
          area: { id_condominio: 1 },
        })),
        update: jest.fn(async ({ data }: any) => ({ id: 10, ...data })),
      },
      // Morador 2 mora no condomínio 1 (apto 200): passa no tenant — o que
      // se testa aqui é o papel, não o isolamento por condomínio.
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) => (Number(where?.id_user) === 2 ? { id_apto: 200 } : null)),
      },
      sindicos_Condominios: {
        findFirst: jest.fn(async ({ where }: any) => (Number(where?.id_user) === 9 ? { id: 1 } : null)),
      },
      // Vínculo do funcionário e a flag pedida saem da mesma linha.
      funcionarios: { findFirst: jest.fn(async () => ({ id: 1, areas_sociais: flagAreas })) },
    };
    const tenant = new TenantAccessService(prisma);
    const svc = new AreasSociaisService(prisma, {} as any, {} as any, {} as any, tenant);
    return { svc, prisma };
  }

  const moradorB: JwtPayload = { sub: 2, nome: 'Morador B', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico' };
  const funcionario: JwtPayload = { sub: 5, nome: 'Zelador', typeAccess: 'Funcionario' };

  it('NEGA morador aprovar reserva pelo update', async () => {
    const { svc, prisma } = build();
    await expect(svc.updateAgendamento({ id: 10, status: 'aprovado' }, moradorB)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
  });

  it('NEGA morador remarcar a reserva de outro apartamento', async () => {
    const { svc, prisma } = build();
    await expect(svc.updateAgendamento({ id: 10, data: '01/01/2030' }, moradorB)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
  });

  it('NEGA funcionário sem a flag areas_sociais', async () => {
    const { svc, prisma } = build(0);
    await expect(svc.updateAgendamento({ id: 10, status: 'cancelado' }, funcionario)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
  });

  it('PERMITE o síndico do condomínio', async () => {
    const { svc, prisma } = build();
    await svc.updateAgendamento({ id: 10, status: 'cancelado' }, sindico);
    expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { status: 'cancelado' },
    });
  });

  it('PERMITE funcionário com a flag', async () => {
    const { svc, prisma } = build(1);
    await svc.updateAgendamento({ id: 10, convidados: 3 }, funcionario);
    expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalled();
  });
});
