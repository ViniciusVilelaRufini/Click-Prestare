import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Quem agendou e quem aprovou são coisas diferentes (rodada 4). A lista de
 * reservas devolve os dois em campos novos — `criado_por` e
 * `aprovado_por_nome` (só quem decidiu) — e mantém `aprovado_por` como era,
 * porque o app publicado o lê. Reserva gravada antes da coluna nova (a
 * rodada 3 punha quem agendou em aprovado_por_nome) segue aparecendo igual.
 */
describe('AreasSociaisService — listas com quem agendou e quem aprovou', () => {
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 2, typeAccess: 'Sindico' };
  const base = {
    data: new Date(2026, 5, 10), hora_de: new Date(1970, 0, 1, 10, 0), hora_ate: new Date(1970, 0, 1, 12, 0),
    created_at: new Date(2026, 5, 1), confirmada_em: null, aprovado_em: null, motivo_recusa: null,
    area: { nome: 'Salão', exige_confirmacao: 0 }, apartamento: { bloco: 'A', apto: '101' },
  };
  const linhas = [
    // agendada pela portaria, nasceu aprovada: ninguém "aprovou"
    { ...base, id: 1, status: 'aprovado', criado_por_nome: 'Portaria · Carlos', aprovado_por_nome: null },
    // pedida pelo morador e aprovada pelo síndico
    { ...base, id: 2, status: 'aprovado', criado_por_nome: 'Bruno Lima', aprovado_por_nome: 'Ana Souza' },
    // gravada antes da coluna nova (rodada 3)
    { ...base, id: 3, status: 'aprovado', criado_por_nome: null, aprovado_por_nome: 'Carlos' },
  ];

  function build() {
    const prisma: any = {
      isConnected: true,
      areas_Sociais_Agendamentos: { findMany: jest.fn(async () => linhas) },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_apto: 100 }]) },
      sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
    };
    const tenant = new TenantAccessService(prisma);
    jest.spyOn(tenant, 'assertCondominio').mockResolvedValue(undefined as any);
    return new AreasSociaisService(prisma, {} as any, {} as any, {} as any, tenant);
  }

  it('fila do console: criado_por e aprovado_por_nome separados; aprovado_por como antes', async () => {
    const lista: any[] = await build().getAllAgendamentos(2, sindico);
    expect(lista[0]).toMatchObject({ criado_por: 'Portaria · Carlos', aprovado_por_nome: null, aprovado_por: 'Síndico' });
    expect(lista[1]).toMatchObject({ criado_por: 'Bruno Lima', aprovado_por_nome: 'Ana Souza', aprovado_por: 'Ana Souza' });
    expect(lista[2]).toMatchObject({ criado_por: null, aprovado_por_nome: 'Carlos', aprovado_por: 'Carlos' });
  });

  it('"minhas reservas" do app ganha os mesmos campos novos', async () => {
    const lista: any[] = await build().getAllMeusAgendamentos(2, 5, undefined, sindico);
    expect(lista[0]).toMatchObject({ criado_por: 'Portaria · Carlos', aprovado_por: 'Síndico' });
  });
});
