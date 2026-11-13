import { ForbiddenException } from '@nestjs/common';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { FERRAMENTAS_LEITURA, type ContextoFerramenta } from '../chat-ia/chat-ia.tools';
import { ChatIaService } from '../chat-ia/chat-ia.service';
import { RelatoriosController } from '../relatorios/relatorios.controller';
import { RelatoriosService } from '../relatorios/relatorios.service';
import { montarSqlEspinha, montarSqlTotal, type FiltroEspinha } from '../relatorios/eventos-espinha';
import { DashboardController } from '../dashboard/dashboard.controller';
import { DashboardService } from '../dashboard/dashboard.service';

/**
 * Funcionário do app com a flag `ocorrencias` desligada lê só públicas + as próprias em
 * OcorrenciasService.findAll e no getOcorrenciaById do app. Os leitores derivados — tool
 * `minhas_ocorrencias` do chat, relatório de ocorrências, linha do tempo de eventos e painel —
 * ignoravam a flag e entregavam as privadas (descrição, resposta, autor).
 */
const funcionario: JwtPayload = { sub: 10, nome: 'Func QA', typeAccess: 'Funcionario' };
const sindico: JwtPayload = { sub: 11, nome: 'Síndico QA', typeAccess: 'Sindico' };
const porteiro: JwtPayload = { sub: 3, nome: 'Porteiro QA', id_condominio: 1 };
const SO_PUBLICAS_OU_DO_10 = { OR: [{ publica: true }, { user: 10 }] };

function tenantCom(flag: number) {
  const prisma: any = {
    isConnected: true,
    funcionarios: { findFirst: jest.fn(async () => ({ ocorrencias: flag })) },
  };
  return { tenant: new TenantAccessService(prisma), prisma };
}

describe('TenantAccessService.recorteOcorrenciasPrivadas', () => {
  it('funcionário do app SEM a flag → recorte pelo próprio Users.id', async () => {
    const { tenant } = tenantCom(0);
    await expect(tenant.recorteOcorrenciasPrivadas(1, funcionario)).resolves.toBe(10);
  });

  it('funcionário do app COM a flag → vê todas', async () => {
    const { tenant } = tenantCom(1);
    await expect(tenant.recorteOcorrenciasPrivadas(1, funcionario)).resolves.toBeNull();
  });

  it.each([['síndico', sindico], ['porteiro do console', porteiro]])('%s → vê todas, sem consultar flag', async (_n, p) => {
    const { tenant, prisma } = tenantCom(0);
    await expect(tenant.recorteOcorrenciasPrivadas(1, p)).resolves.toBeNull();
    expect(prisma.funcionarios.findFirst).not.toHaveBeenCalled();
  });
});

describe('chat-ia — minhas_ocorrencias e o contexto', () => {
  const tool = FERRAMENTAS_LEITURA.find((f) => f.nome === 'minhas_ocorrencias')!;
  function ctx(over: Partial<ContextoFerramenta>): ContextoFerramenta {
    return {
      idCondominio: 1, idUser: 10, papel: 'Funcionario', staff: true, aptos: [],
      prisma: { ocorrencias: { findMany: jest.fn(async () => []) } } as any,
      cartoes: [], ...over,
    } as ContextoFerramenta;
  }

  it('staff sem acesso às privadas: só públicas + as próprias', async () => {
    const c = ctx({ ocorrenciasPrivadas: false });
    await tool.executar({}, c);
    const where = (c.prisma as any).ocorrencias.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ id_condominio: 1, ...SO_PUBLICAS_OU_DO_10 });
  });

  it('staff com acesso às privadas: condomínio inteiro', async () => {
    const c = ctx({ ocorrenciasPrivadas: true });
    await tool.executar({}, c);
    expect((c.prisma as any).ocorrencias.findMany.mock.calls[0][0].where).toEqual({ id_condominio: 1 });
  });

  it('montarContextoFerramenta: funcionário sem a flag → ocorrenciasPrivadas false', async () => {
    const prisma: any = { apartamentos_Users: { findMany: jest.fn(async () => []) } };
    const { tenant } = tenantCom(0);
    const svc: any = new ChatIaService(prisma, tenant as any, {} as any);
    const c = await svc.montarContextoFerramenta(1, 10, 'Funcionario', funcionario);
    expect(c.staff).toBe(true);
    expect(c.ocorrenciasPrivadas).toBe(false);
  });

  it('montarContextoFerramenta: síndico → ocorrenciasPrivadas true', async () => {
    const prisma: any = { apartamentos_Users: { findMany: jest.fn(async () => []) } };
    const tenant: any = { recorteOcorrenciasPrivadas: jest.fn() };
    const svc: any = new ChatIaService(prisma, tenant, {} as any);
    const c = await svc.montarContextoFerramenta(1, 11, 'Sindico', sindico);
    expect(c.ocorrenciasPrivadas).toBe(true);
    expect(tenant.recorteOcorrenciasPrivadas).not.toHaveBeenCalled();
  });
});

describe('relatórios — exportação e linha do tempo', () => {
  function ctrl(flag: number) {
    const service: any = {
      generate: jest.fn(async () => ({ buffer: Buffer.from(''), mime: 'text/csv', filename: 'x.csv' })),
      getEventos: jest.fn(async () => ({ items: [] })),
    };
    const res: any = { setHeader: jest.fn(), end: jest.fn() };
    const { tenant } = tenantCom(flag);
    return { c: new RelatoriosController(service, undefined, tenant), service, res };
  }

  it('NEGA o relatório de ocorrências ao funcionário sem a flag', async () => {
    const { c, service, res } = ctrl(0);
    await expect(c.download(1, res, funcionario, 'ocorrencias', 'xlsx')).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.generate).not.toHaveBeenCalled();
  });

  it('funcionário COM a flag e síndico continuam baixando', async () => {
    const a = ctrl(1);
    await a.c.download(1, a.res, funcionario, 'ocorrencias', 'xlsx');
    expect(a.service.generate).toHaveBeenCalled();
    const b = ctrl(0);
    await b.c.download(1, b.res, sindico, 'ocorrencias', 'xlsx');
    expect(b.service.generate).toHaveBeenCalled();
  });

  it('funcionário sem a flag NÃO perde os outros relatórios operacionais', async () => {
    const { c, service, res } = ctrl(0);
    await c.download(1, res, funcionario, 'visitantes', 'xlsx');
    expect(service.generate).toHaveBeenCalled();
  });

  it('eventos: o controller repassa o recorte (10) ao service; síndico passa null', async () => {
    const a = ctrl(0);
    await a.c.getEventos(1, funcionario);
    expect(a.service.getEventos).toHaveBeenCalledWith(1, undefined, undefined, 1, 50, undefined, 10);
    const b = ctrl(0);
    await b.c.getEventos(1, sindico);
    expect(b.service.getEventos).toHaveBeenCalledWith(1, undefined, undefined, 1, 50, undefined, null);
  });

  it('RelatoriosService.getEventos põe o recorte no filtro da espinha', async () => {
    delete process.env['PESSOAS_MIGRATION_ENABLED'];
    const svc: any = new RelatoriosService({ isConnected: true } as any);
    const espinha = jest.spyOn(svc, 'consultarEspinhaEventos').mockResolvedValue({ linhas: [], total: 0 });
    await svc.getEventos(1, undefined, undefined, 1, 50, undefined, 10);
    expect(espinha.mock.calls[0][0]).toMatchObject({ idCondominio: 1, ocorrenciasSoPublicasOuDe: 10 });
  });

  it('ramo ocorrência do SQL: com recorte filtra publica/autor (parâmetro); sem recorte, não', () => {
    const base: FiltroEspinha = { idCondominio: 1, inicio: null, fimExclusivo: null, migrado: false, limit: 50, offset: 0 };
    for (const sql of [montarSqlEspinha({ ...base, ocorrenciasSoPublicasOuDe: 10 }), montarSqlTotal({ ...base, ocorrenciasSoPublicasOuDe: 10 })]) {
      expect(sql.sql).toMatch(/o\.publica = 1 OR o\.user = \?/);
      expect(sql.values).toContain(10);
    }
    expect(montarSqlEspinha(base).sql).not.toContain('o.publica');
  });
});

describe('painel da portaria', () => {
  function prismaPainel() {
    const prisma: any = {
      isConnected: true,
      visitantes: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      visitas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      pessoas: { findMany: jest.fn(async () => []) },
      prestadores_servico: { count: jest.fn(async () => 0) },
      ocorrencias: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      encomendas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      comunicados: { count: jest.fn(async () => 0) },
      apartamentos: { count: jest.fn(async () => 0) },
      moradores: { count: jest.fn(async () => 0) },
      acessos_Facial: { findMany: jest.fn(async () => []) },
      auditLog: { findMany: jest.fn(async () => []) },
      facial_Devices: { findMany: jest.fn(async () => []) },
    };
    return prisma;
  }
  const ultimas = (prisma: any) =>
    prisma.ocorrencias.findMany.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.take === 15);

  it('controller: funcionário sem a flag → summary com o recorte; porteiro → sem a chave', async () => {
    const service: any = { summary: jest.fn(async () => ({})) };
    const { tenant } = tenantCom(0);
    const c = new DashboardController(service, tenant);
    await c.get(1, funcionario);
    expect(service.summary).toHaveBeenLastCalledWith(1, { incluirFotoDocumento: false, ocorrenciasSoPublicasOuDe: 10 });
    await c.get(1, porteiro);
    expect(service.summary).toHaveBeenLastCalledWith(1, { incluirFotoDocumento: false });
  });

  it('service: com recorte, as 15 últimas ocorrências saem só públicas + do autor', async () => {
    delete process.env['PESSOAS_MIGRATION_ENABLED'];
    const prisma = prismaPainel();
    await new DashboardService(prisma).summary(1, { ocorrenciasSoPublicasOuDe: 10 });
    expect(ultimas(prisma).where).toEqual({ id_condominio: 1, ...SO_PUBLICAS_OU_DO_10 });
  });

  it('service: sem recorte, o where fica como antes', async () => {
    delete process.env['PESSOAS_MIGRATION_ENABLED'];
    const prisma = prismaPainel();
    await new DashboardService(prisma).summary(1);
    expect(ultimas(prisma).where).toEqual({ id_condominio: 1 });
  });
});
