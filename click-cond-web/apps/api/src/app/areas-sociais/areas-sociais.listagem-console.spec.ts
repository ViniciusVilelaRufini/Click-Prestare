import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * A fila de reservas do console precisa saber se a área exige confirmação de
 * presença: é o que decide o botão "Confirmar presença" e o selo "aguardando
 * confirmação" (a API já aceitava a confirmação feita pelo operador, mas a
 * tela não tinha como saber quando oferecê-la).
 */
describe('AreasSociaisService.getAllAgendamentos — campos da confirmação de presença', () => {
  const funcionario: JwtPayload = { sub: 6, nome: 'Porteiro Y', id_condominio: 2, typeAccess: 'Funcionario' };

  it('devolve exige_confirmacao da área e confirmada_em da reserva', async () => {
    const confirmadaEm = new Date(2026, 5, 10, 9, 45);
    const prisma: any = {
      isConnected: true,
      areas_Sociais_Agendamentos: {
        findMany: jest.fn(async () => [
          {
            id: 1, status: 'aprovado', data: new Date(2026, 5, 10), hora_de: new Date(1970, 0, 1, 10, 0), hora_ate: new Date(1970, 0, 1, 12, 0),
            created_at: new Date(2026, 5, 1), confirmada_em: confirmadaEm, area: { nome: 'Salão', exige_confirmacao: 1 },
            apartamento: { bloco: 'A', apto: '101' },
          },
          {
            id: 2, status: 'aprovado', data: new Date(2026, 5, 10), hora_de: new Date(1970, 0, 1, 14, 0), hora_ate: new Date(1970, 0, 1, 16, 0),
            created_at: new Date(2026, 5, 1), confirmada_em: null, area: { nome: 'Churrasqueira', exige_confirmacao: 0 },
            apartamento: { bloco: 'A', apto: '102' },
          },
        ]),
      },
      funcionarios: { findFirst: jest.fn(async () => ({ id: 1, areas_sociais: 1 })) },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
    };
    const svc = new AreasSociaisService(prisma, {} as any, {} as any, {} as any, new TenantAccessService(prisma));
    const lista = await svc.getAllAgendamentos(2, funcionario);
    expect(lista[0]).toMatchObject({ id: 1, exige_confirmacao: true, confirmada_em: confirmadaEm });
    expect(lista[1]).toMatchObject({ id: 2, exige_confirmacao: false, confirmada_em: null });
    expect(prisma.areas_Sociais_Agendamentos.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ area: { select: expect.objectContaining({ exige_confirmacao: true }) } }),
      }),
    );
  });
});
