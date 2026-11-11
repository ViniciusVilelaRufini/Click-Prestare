import { MudancasService } from './mudancas.service';

/**
 * A aprovação da mudança vale para o dia, a hora e a unidade que a
 * administração viu — é o que reserva elevador e avisa a portaria. O morador
 * conseguia remarcar a mudança JÁ aprovada pelo app e ela seguia "aprovada"
 * na nova data, sem ninguém da equipe ter olhado.
 *
 * Regra: mudou data, hora ou unidade por quem não é da equipe (não operador),
 * a mudança volta a `pendente`. Edição pela equipe mantém o status.
 */
describe('MudancasService.update — remarcação pelo morador volta a pendente', () => {
  const MORADOR = 77;
  const aprovada = {
    id_condominio: 2,
    user: MORADOR,
    status: 'aprovada',
    data: new Date('2026-11-20T00:00:00Z'),
    hora_inicio: new Date('1970-01-01T14:00:00Z'),
    id_apartamento: 10,
  };

  function build(atual: any = aprovada) {
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const prisma: any = {
      isConnected: true,
      mudancas: {
        findUnique: jest.fn(async () => ({ ...atual })),
        update: jest.fn(async ({ data }: any) => ({ id: 3, ...data })),
      },
      apartamentos: { findUnique: jest.fn(async () => ({ id_condominio: 2 })) },
      apartamentos_Users: { findFirst: jest.fn(async () => ({ id_apto: 11 })) },
    };
    return { service: new MudancasService(prisma, tenant), prisma };
  }

  const morador: any = { sub: MORADOR, typeAccess: 'Morador', user: { id: MORADOR } };
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };
  const dadosGravados = (prisma: any) => prisma.mudancas.update.mock.calls[0][0].data;

  it.each([
    ['data', { data: '2026-11-21' }],
    ['hora', { hora_inicio: '09:00' }],
    ['unidade', { id_apartamento: 11 }],
  ])('morador mudou a %s → volta a pendente', async (_campo, dto) => {
    const { service, prisma } = build();
    await service.update(3, dto as any, morador);
    expect(dadosGravados(prisma).status).toBe('pendente');
  });

  it('morador reenviando os mesmos valores não perde a aprovação', async () => {
    const { service, prisma } = build();
    await service.update(3, { data: '2026-11-20', hora_inicio: '14:00', id_apartamento: 10 }, morador);
    expect(dadosGravados(prisma).status).toBeUndefined();
  });

  it('síndico remarcando mantém o status', async () => {
    const { service, prisma } = build();
    await service.update(3, { data: '2026-11-21' }, sindico);
    expect(dadosGravados(prisma).status).toBeUndefined();
  });
});
