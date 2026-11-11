import { VisitantesGlobalController } from './visitantes.controller';
import { parseLocalTimeToUTC } from './visitantes.service';

/**
 * O app edita a visita a partir de `data_inicio`/`data_termino` ("dd/MM/aaaa
 * HH:mm") que a API monta. O servidor roda em UTC e formatava com getHours():
 * 10:00 de Brasília aparecia como 13:00. Ao salvar, `parseLocalTimeToUTC` lê a
 * mesma string como horário de Brasília — cada edição empurrava a janela da
 * visita 3 horas para frente (e o PIN/facial passavam a valer na hora errada).
 */
describe('GET /visitantes/get — datas da visita no horário de Brasília', () => {
  const tzOriginal = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'UTC'; });
  afterAll(() => { process.env.TZ = tzOriginal; });

  const inicio = new Date('2026-09-23T13:00:00Z'); // 10:00 em Brasília
  const termino = new Date('2026-09-24T02:30:00Z'); // 23:30 do dia 23 em Brasília

  function montar() {
    const service: any = {
      findOne: jest.fn(async () => ({
        id: 1000004,
        data_hora_inicio: inicio,
        data_hora_termino: termino,
        foto_pessoa: null,
        apartamento: { bloco: 'A', apto: '106' },
      })),
    };
    return new VisitantesGlobalController(service);
  }

  it('devolve início e término em Brasília', async () => {
    const r: any = await montar().getOne('1000004', {} as any);
    expect(r.data_inicio).toBe('23/09/2026 10:00');
    expect(r.data_termino).toBe('23/09/2026 23:30');
  });

  it('salvar sem mexer nas datas mantém a mesma janela', async () => {
    const r: any = await montar().getOne('1000004', {} as any);
    expect(parseLocalTimeToUTC(r.data_inicio).toISOString()).toBe(inicio.toISOString());
    expect(parseLocalTimeToUTC(r.data_termino).toISOString()).toBe(termino.toISOString());
  });
});

describe('auditoria da visita — horários em Brasília', () => {
  const tzOriginal = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'UTC'; });
  afterAll(() => { process.env.TZ = tzOriginal; });

  it('janela e entrada saem no horário de Brasília', () => {
    const { VisitantesService } = jest.requireActual('./visitantes.service');
    const svc = new VisitantesService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const ctx = (svc as any).construirContextoAuditoria({
      is_prestador: 0,
      id_apartamento: 106,
      pessoa: { id: 2000001, nome: 'QA_SECURITY_20260923', doc_identificacao: null },
      apartamento: { bloco: 'A', apto: '106' },
      data_hora_inicio: new Date('2026-09-23T13:00:00Z'),
      data_hora_termino: null,
      data_entrada: new Date('2026-09-24T01:15:00Z'),
      data_saida: null,
      liberado: 1,
    });
    expect(ctx.janela.inicio).toContain('10:00');
    expect(ctx.status.dataEntrada).toContain('23/09/2026');
    expect(ctx.status.dataEntrada).toContain('22:15');
  });
});

/**
 * O PIN/QR do visitante é credencial de acesso físico: gravado no `detalhes`
 * do log, ficava legível na tela de auditoria e saía no CSV exportado.
 */
describe('auditoria da visita — não grava o código de acesso', () => {
  const { VisitantesService } = jest.requireActual('./visitantes.service');

  const visita = (codigo: string | null) => ({
    is_prestador: 0,
    id_apartamento: 106,
    pessoa: { id: 2000001, nome: 'Fulano', doc_identificacao: null },
    apartamento: { bloco: 'A', apto: '106' },
    data_hora_inicio: null,
    data_hora_termino: null,
    data_entrada: null,
    data_saida: null,
    liberado: 1,
    codigo_acesso: codigo,
  });

  it('caminho migrado (Visitas): só diz se há código', () => {
    const svc = new VisitantesService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const com = (svc as any).construirContextoAuditoria(visita('482913'));
    expect(com.status.temCodigoAcesso).toBe(true);
    expect(com.status).not.toHaveProperty('codigoAcesso');
    expect(JSON.stringify(com)).not.toContain('482913');

    const sem = (svc as any).construirContextoAuditoria(visita(null));
    expect(sem.status.temCodigoAcesso).toBe(false);
  });

  it('caminho legado (Visitantes): só diz se há código', async () => {
    const prisma: any = {
      visitantes: {
        findUnique: jest.fn(async () => ({
          id: 30,
          nome: 'Fulano',
          doc_identificacao: null,
          is_prestador: 0,
          id_apartamento: 106,
          apartamento: { bloco: 'A', apto: '106' },
          user: null,
          data_hora_inicio: null,
          data_hora_termino: null,
          data_entrada: null,
          data_saida: null,
          liberado: 1,
          codigo_acesso: '482913',
        })),
      },
    };
    const svc = new VisitantesService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    const ctx = await (svc as any).carregarContextoVisitante(30);
    expect(ctx.status.temCodigoAcesso).toBe(true);
    expect(ctx.status).not.toHaveProperty('codigoAcesso');
    expect(JSON.stringify(ctx)).not.toContain('482913');
  });
});
