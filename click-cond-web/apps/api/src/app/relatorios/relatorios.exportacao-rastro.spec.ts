import { BadRequestException } from '@nestjs/common';
import { RelatoriosService } from './relatorios.service';
import { RelatoriosController } from './relatorios.controller';
import { MoradoresController } from '../moradores/moradores.controller';
import { MoradoresService } from '../moradores/moradores.service';
import { requestContext } from '../common/context/request-context';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/** X1: download de relatório deixa rastro. X2: máscara e finalidade na exportação de moradores. X3/X4: auditoria. */
describe('Relatórios — rastro de exportação (X1)', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Cond' })) },
      visitantes: {
        findMany: jest.fn(async () => [
          { nome: 'A', doc_identificacao: '1', apartamento: null, criadoPor: null, created_at: new Date() },
          { nome: 'B', doc_identificacao: '2', apartamento: null, criadoPor: null, created_at: new Date() },
        ]),
      },
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    return { prisma, auditoria, service: new RelatoriosService(prisma, auditoria) };
  }

  it('generate registra EXPORT com tipo, formato, filtros, linhas, autor e IP', async () => {
    const { service, auditoria } = build();
    await service.generate(1, 'visitantes', 'xlsx', '2026-11-01', '2026-11-30', 'A', '12', {}, {
      nome: 'Porteiro', email: 'p@x.com', autor_id: 7, autor_tipo: 'funcionario_portaria', ip: '1.2.3.4',
    });
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    const reg = auditoria.registrar.mock.calls[0][0];
    expect(reg).toMatchObject({
      id_condominio: 1, acao: 'EXPORT', modulo: 'relatorios', autor_id: 7, autor_tipo: 'funcionario_portaria',
      ip: '1.2.3.4', usuario_nome: 'Porteiro',
    });
    expect(reg.detalhes).toMatchObject({
      linhas: 2,
      filtros: { tipo: 'visitantes', formato: 'xlsx', dataInicio: '2026-11-01', dataFim: '2026-11-30', bloco: 'A', apto: '12' },
    });
  });

  it('falha ao registrar não derruba o download', async () => {
    const { service, auditoria } = build();
    auditoria.registrar.mockRejectedValue(new Error('banco fora'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await service.generate(1, 'visitantes', 'xlsx');
    expect(r.buffer.length).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it('controller passa autor do token e IP do contexto ao generate', async () => {
    const generate = jest.fn(async () => ({ buffer: Buffer.from(''), mime: 'x', filename: 'x' }));
    const ctrl = new RelatoriosController({ generate } as any);
    const res: any = { setHeader: jest.fn(), end: jest.fn() };
    const porteiro: JwtPayload = { sub: 9, nome: 'Porteiro', tipo_sub: 'funcionario_portaria', id_condominio: 1 } as any;
    await requestContext.run({ ip: '::ffff:10.0.0.5' } as any, () =>
      ctrl.download(1, res, porteiro, 'visitantes', 'pdf'),
    );
    const solicitante = (generate.mock.calls[0] as any[])[8];
    expect(solicitante).toMatchObject({ autor_id: 9, autor_tipo: 'funcionario_portaria', ip: '10.0.0.5' });
  });

  it('controller: data mal formada no download é 400 e não gera', async () => {
    const generate = jest.fn();
    const ctrl = new RelatoriosController({ generate } as any);
    const res: any = { setHeader: jest.fn(), end: jest.fn() };
    const sindico: JwtPayload = { sub: 1, typeAccess: 'Sindico' } as any;
    await expect(ctrl.download(1, res, sindico, 'visitantes', 'pdf', '2026-13-45')).rejects.toBeInstanceOf(BadRequestException);
    expect(generate).not.toHaveBeenCalled();
  });

  it('export LGPD completo recebe o IP do contexto', async () => {
    const gerarPacoteExportacao = jest.fn(async () => ({ buffer: Buffer.from(''), filename: 'x.zip' }));
    const ctrl = new RelatoriosController({} as any, { gerarPacoteExportacao } as any);
    const res: any = { setHeader: jest.fn(), end: jest.fn() };
    const sindico: JwtPayload = { sub: 1, nome: 'S', email: 's@x.com', typeAccess: 'Sindico' } as any;
    await requestContext.run({ ip: '9.9.9.9' } as any, () => ctrl.exportDadosCondominio(1, res, sindico));
    expect((gerarPacoteExportacao.mock.calls[0] as any[])[1].ip).toBe('9.9.9.9');
  });
});

describe('Auditoria — paginação e CSV (X3, X4)', () => {
  function build(rows: any[]) {
    const findMany = jest.fn(async () => rows);
    const prisma: any = { isConnected: true, auditLog: { findMany, count: jest.fn(async () => rows.length), create: jest.fn() } };
    return { findMany, service: new RelatoriosService(prisma, { registrar: jest.fn() } as any) };
  }

  it('X3: a paginação desempata por id', async () => {
    const { service, findMany } = build([]);
    await service.getAuditoria(1);
    expect((findMany.mock.calls[0] as any[])[0].orderBy).toEqual([{ created_at: 'desc' }, { id: 'desc' }]);
  });

  it('X4: CSV usa horário de Brasília (e não ISO/UTC)', async () => {
    const { service } = build([{ id: 1, created_at: new Date('2026-11-24T15:30:05.000Z'), acao: 'EXPORT' }]);
    const { buffer } = await service.exportAuditoriaCsv(1);
    const csv = buffer.toString('utf8');
    expect(csv).toContain('24/11/2026');
    expect(csv).toContain('12:30:05');
    expect(csv).not.toContain('T15:30');
  });

  it('X4: acima de 10.000 linhas avisa o truncamento na última linha', async () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => ({ id: i, created_at: new Date('2026-11-24T15:00:00Z'), acao: 'A' }));
    const { service, findMany } = build(rows);
    const { buffer } = await service.exportAuditoriaCsv(1);
    expect((findMany.mock.calls[0] as any[])[0].take).toBe(10_001);
    const linhas = buffer.toString('utf8').split('\n');
    expect(linhas).toHaveLength(1 + 10_000 + 1);
    expect(linhas[linhas.length - 1]).toContain('truncada');
  });

  it('X4: dentro do teto não há aviso', async () => {
    const { service } = build([{ id: 1, created_at: new Date(), acao: 'A' }]);
    const csv = (await service.exportAuditoriaCsv(1)).buffer.toString('utf8');
    expect(csv).not.toContain('truncada');
  });
});

describe('Moradores — exportação (X2)', () => {
  function build() {
    const service: any = { exportExcel: jest.fn(async () => ({})) };
    return { ctrl: new MoradoresController(service, {} as any), service };
  }
  const sindico: JwtPayload = { sub: 1, nome: 'S', typeAccess: 'Sindico' } as any;
  const porteiro: JwtPayload = { sub: 2, nome: 'P', tipo_sub: 'funcionario_portaria', id_condominio: 1 } as any;

  it('síndico estrito pode desligar a máscara', () => {
    const { ctrl, service } = build();
    ctrl.exportExcel(1, sindico, 'false', 'Auditoria');
    expect(service.exportExcel.mock.calls[0][1]).toMatchObject({ mascarar: false, finalidade: 'Auditoria', autor_id: 1, autor_tipo: 'user' });
  });

  it('porteiro pede mascarar=false e a máscara é forçada (não recusa)', () => {
    const { ctrl, service } = build();
    ctrl.exportExcel(1, porteiro, 'false', 'Conferência');
    expect(service.exportExcel.mock.calls[0][1].mascarar).toBe(true);
  });

  it('sem finalidade (ou só espaços) é 400 e não exporta', () => {
    const { ctrl, service } = build();
    expect(() => ctrl.exportExcel(1, sindico, 'true')).toThrow(BadRequestException);
    expect(() => ctrl.exportExcel(1, sindico, 'true', '   ')).toThrow(BadRequestException);
    expect(service.exportExcel).not.toHaveBeenCalled();
  });

  it('service grava a ação EXPORT com o autor', async () => {
    const registrar = jest.fn();
    const svc: any = Object.create(MoradoresService.prototype);
    svc.auditoria = { registrar };
    svc.findAll = jest.fn(async () => []);
    await svc.exportExcel(1, { finalidade: 'X', autor_id: 5, autor_tipo: 'user' });
    expect(registrar.mock.calls[0][0]).toMatchObject({ acao: 'EXPORT', modulo: 'moradores', autor_id: 5, autor_tipo: 'user' });
  });
});
