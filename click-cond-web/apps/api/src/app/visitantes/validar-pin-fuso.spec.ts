// O servidor (Elastic Beanstalk) roda em UTC. O teste força o mesmo fuso —
// na máquina de dev (horário de Brasília) o defeito não aparece.
process.env.TZ = 'UTC';

import { VisitantesService } from './visitantes.service';

/**
 * Validação de PIN: o dia permitido (dias_semana) e as datas exibidas eram
 * calculados no relógio do servidor. Entre 21:00 e 23:59 de Brasília o
 * servidor já está no dia seguinte: prestador liberado só às segundas era
 * barrado na segunda à noite e passava na terça à noite; e o "válido de/até"
 * aparecia 3 horas adiantado.
 */
describe('validar PIN — horário de Brasília', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    jest.useRealTimers();
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  // Segunda-feira 21/09/2026 23:30 em Brasília = terça 22/09 02:30 UTC.
  const segundaNoiteBrasilia = new Date('2026-09-22T02:30:00Z');

  function servico(visita: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const prisma: any = {
      isConnected: true,
      visitas: {
        findFirst: jest.fn(async () => ({
          id: 1000009, id_condominio: 1, codigo_acesso: '123456', data_saida: null,
          bloqueado: 0, liberado: 1, is_visitante: 0, is_prestador: 1, dias_semana: null,
          data_hora_inicio: new Date('2026-09-21T11:00:00Z'), // 08:00 em Brasília
          data_hora_termino: new Date('2026-09-22T12:00:00Z'), // 09:00 em Brasília
          pessoa: { nome: 'QA_SECURITY_20260923', bloqueado: 0, doc_identificacao: null, foto_documento: null, foto_pessoa: null },
          apartamento: { bloco: 'A', apto: '106' },
          criadoPor: null,
          ...visita,
        })),
      },
    };
    return new VisitantesService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  }

  it('liberado só às segundas passa na segunda às 23:30 de Brasília', async () => {
    jest.useFakeTimers({ now: segundaNoiteBrasilia, doNotFake: ['nextTick', 'setImmediate'] });
    await expect(servico({ dias_semana: 'seg' }).validarCodigo(1, '123456')).resolves.toBeTruthy();
  });

  it('liberado só às terças é barrado na segunda às 23:30 de Brasília', async () => {
    jest.useFakeTimers({ now: segundaNoiteBrasilia, doNotFake: ['nextTick', 'setImmediate'] });
    await expect(servico({ dias_semana: 'ter' }).validarCodigo(1, '123456')).rejects.toThrow(/dia de hoje/);
  });

  it('as datas da janela aparecem no horário de Brasília', async () => {
    jest.useFakeTimers({ now: segundaNoiteBrasilia, doNotFake: ['nextTick', 'setImmediate'] });
    const r: any = await servico({}).validarCodigo(1, '123456');
    expect(r.data_inicio).toBe('21/09/2026 08:00');
    expect(r.data_termino).toBe('22/09/2026 09:00');
  });
});
