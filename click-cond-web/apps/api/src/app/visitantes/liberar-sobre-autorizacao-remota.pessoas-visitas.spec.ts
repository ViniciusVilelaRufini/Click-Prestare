import { VisitantesService } from './visitantes.service';
import { prazoAutorizacaoRemotaMs } from '../common/janela-visita';

/**
 * Rodada 4, item 1: a autorização remota do morador vale 10 min também no
 * portão (facial). Quando a portaria clica em Liberar depois disso, a decisão
 * passa a ser dela — liberação da portaria vale pela janela, como sempre.
 * Sem limpar o `auth_status`, a visita seguia "autorização remota vencida" e
 * o portão continuava fechado mesmo com a portaria liberando.
 */
describe('Liberar (Pessoas/Visitas) sobre autorização remota do morador', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  function montar(extra: Record<string, unknown> = {}) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const pessoa = { id: 2000001, nome: 'QA_Remota', bloqueado: 0 };
    const agora = Date.now();
    const visita: any = {
      id: 1000004, id_pessoa: 2000001, id_condominio: 1, id_apartamento: 106, user: null,
      is_visitante: 1, is_prestador: 0,
      data_hora_inicio: new Date(agora - 25 * 60_000), data_hora_termino: new Date(agora + 3 * 60 * 60_000),
      data_entrada: null, data_saida: null, codigo_acesso: null, liberado: 1, bloqueado: 0,
      auth_status: 'autorizado', auth_solicitado_em: new Date(agora - 25 * 60_000),
      auth_respondido_em: new Date(agora - 20 * 60_000), auth_respondido_por: 77,
      ...extra,
    };
    const rel = (v: any) => ({ ...v, pessoa, apartamento: { bloco: 'A', apto: '106' } });
    const prisma: any = {
      isConnected: true,
      visitas: {
        update: jest.fn(async ({ data }: any) => rel(Object.assign(visita, data))),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, {} as any, { registrar: jest.fn() } as any, {} as any,
      { emitToCondominio: jest.fn() } as any,
    );
    const s = svc as any;
    jest.spyOn(s, 'assertPodeAcessarVisita').mockImplementation(async () => rel(visita));
    jest.spyOn(s, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
    return { svc, prisma, visita };
  }

  const porteiro = { sub: 3, nome: 'Portaria', id_condominio: 1, turno: 'Manha' } as any;

  it('a portaria libera depois dos 10 min: vira liberação da portaria e o portão volta a abrir pela janela', async () => {
    const { svc, visita } = montar();
    expect(prazoAutorizacaoRemotaMs(visita)).not.toBeNull();
    await svc.liberarAcesso(1000004, porteiro, undefined, 'autorizado');
    expect(visita.liberado).toBe(1);
    expect(visita.auth_status).toBeNull();
    expect(prazoAutorizacaoRemotaMs(visita)).toBeNull();
  });

  it('pedido resolvido pela própria portaria (sem Users.id): o Liberar não mexe no auth_status', async () => {
    const { svc, visita } = montar({ auth_respondido_por: null });
    await svc.liberarAcesso(1000004, porteiro, undefined, 'autorizado');
    expect(visita.auth_status).toBe('autorizado');
  });
});
