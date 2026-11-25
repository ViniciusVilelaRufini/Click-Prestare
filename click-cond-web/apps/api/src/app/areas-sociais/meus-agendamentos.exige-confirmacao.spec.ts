import { AreasSociaisService } from './areas-sociais.service';

/**
 * F2: o app do morador vai ganhar "Confirmar presença" na reserva. A lista
 * que ele usa (GET areas-sociais/meus-agendamentos/get-all) já trazia
 * `confirmada_em`, mas não dizia se a área exige confirmação: sem isso o app
 * não sabe quando mostrar o botão. Mesmo campo e formato de getAllAgendamentos.
 */
describe('AreasSociaisService.getAllMeusAgendamentos — exige_confirmacao', () => {
  function build(linhas: any[]) {
    const findMany = jest.fn().mockResolvedValue(linhas);
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: { findMany: jest.fn().mockResolvedValue([{ id_apto: 7 }]) },
      areas_Sociais_Agendamentos: { findMany },
    };
    const svc = Object.create(AreasSociaisService.prototype) as any;
    svc.prisma = prisma;
    svc.tenant = { assertCondominio: jest.fn() };
    return { svc, findMany };
  }

  const linha = (over: any) => ({
    id: 1, status: 'aprovado', created_at: new Date('2026-11-20T12:00:00Z'), data: new Date('2026-11-30T00:00:00Z'),
    hora_de: new Date(1970, 0, 1, 10, 0), hora_ate: new Date(1970, 0, 1, 12, 0), confirmada_em: null,
    apartamento: { bloco: 'A', apto: '101' }, ...over,
  });

  it('pede o campo da área e devolve booleano, junto com confirmada_em', async () => {
    const confirmada = new Date('2026-11-30T09:40:00Z');
    const { svc, findMany } = build([
      linha({ id: 1, area: { nome: 'Salão', exige_confirmacao: 1 } }),
      linha({ id: 2, area: { nome: 'Churrasqueira', exige_confirmacao: 0 }, confirmada_em: confirmada }),
    ]);
    const res = await svc.getAllMeusAgendamentos(1, 41, undefined, { sub: 41 } as any);
    expect(findMany.mock.calls[0][0].include.area).toEqual({ select: { nome: true, exige_confirmacao: true } });
    expect(res.find((r: any) => r.id === 1)).toMatchObject({ exige_confirmacao: true, confirmada_em: null });
    expect(res.find((r: any) => r.id === 2)).toMatchObject({ exige_confirmacao: false, confirmada_em: confirmada });
  });
});
