import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RelatoriosController, CondominiosExportController } from '../relatorios/relatorios.controller';
import { FinanceiroController } from '../financeiro/financeiro.controller';
import { MobileAuthService } from './mobile-auth.service';
import { ChatIaService } from '../chat-ia/chat-ia.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Rodada 4 (raia e), I1 — o `assertSindico` (não estrito) aceitava `token.turno === 'Síndico'`. O turno do token do
 * porteiro vem da linha de portaria (texto livre): um ex-síndico, ou qualquer porteiro cuja linha ficasse com turno
 * 'Síndico', recebia sessão de porteiro com poderes de síndico no ZIP LGPD, no relatório financeiro, na auditoria e
 * na inadimplência. Essas rotas passam a usar `assertSindicoEstrito` (typeAccess). O síndico de verdade sempre tem
 * typeAccess 'Sindico': login por senha (montarSessaoPortaria), QR (papel conferido no banco), troca de condomínio
 * (preserva o typeAccess) e app.
 */
describe('Rotas de síndico não aceitam o turno "Síndico" do porteiro', () => {
  const porteiroTurnoSindico = { sub: 3, nome: 'Ex-síndico', id_condominio: 1, turno: 'Síndico', tipo_sub: 'funcionario_portaria' } as JwtPayload;
  const sindicoSenha = { sub: 42, nome: 'Síndico', id_condominio: 1, turno: 'Síndico', typeAccess: 'Sindico' } as JwtPayload;
  const sindicoQr = { sub: 42, nome: 'Síndico', id_condominio: 1, turno: 'Síndico', typeAccess: 'Sindico' } as JwtPayload;
  const sindicoApp = { sub: 42, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 42 } } as any as JwtPayload;
  const legitimos = [['senha', sindicoSenha], ['QR', sindicoQr], ['app', sindicoApp]] as const;

  function relatorios() {
    const service: any = {
      exportAuditoriaCsv: jest.fn(async () => ({ buffer: Buffer.from(''), filename: 'x.csv' })),
      getAuditoria: jest.fn(async () => ({ items: [] })),
      gerarRelatorio: jest.fn(async () => ({ buffer: Buffer.from(''), filename: 'x.pdf', mime: 'application/pdf' })),
    };
    const exportService: any = { gerarPacoteExportacao: jest.fn(async () => ({ buffer: Buffer.from(''), filename: 'x.zip' })) };
    const res: any = { setHeader: jest.fn(), end: jest.fn(), status: jest.fn(() => res), send: jest.fn() };
    return { ctrl: new RelatoriosController(service, exportService) as any, raiz: new CondominiosExportController(exportService) as any, service, exportService, res };
  }

  it('porteiro com turno "Síndico": 403 no ZIP LGPD (as duas rotas), no relatório financeiro e no CSV da auditoria', async () => {
    const { ctrl, raiz, exportService, service, res } = relatorios();
    await expect(ctrl.exportDadosCondominio(1, res, porteiroTurnoSindico)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(raiz.exportDados(1, res, porteiroTurnoSindico)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.download(1, res, porteiroTurnoSindico, 'financeiro', 'pdf')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.exportAuditoria(1, res, porteiroTurnoSindico)).rejects.toBeInstanceOf(ForbiddenException);
    expect(exportService.gerarPacoteExportacao).not.toHaveBeenCalled();
    expect(service.exportAuditoriaCsv).not.toHaveBeenCalled();
  });

  it('porteiro com turno "Síndico": a auditoria sai sem os módulos sigilosos', async () => {
    const { ctrl, service } = relatorios();
    await ctrl.getAuditoria(1, porteiroTurnoSindico);
    expect(service.getAuditoria.mock.calls[0][6]).toBe(false);
  });

  it.each(legitimos)('síndico (%s) segue exportando e lendo tudo', async (_n, user) => {
    const { ctrl, raiz, exportService, service, res } = relatorios();
    await ctrl.exportDadosCondominio(1, res, user);
    await raiz.exportDados(1, res, user);
    await ctrl.exportAuditoria(1, res, user);
    await ctrl.getAuditoria(1, user);
    expect(exportService.gerarPacoteExportacao).toHaveBeenCalledTimes(2);
    expect(service.exportAuditoriaCsv).toHaveBeenCalled();
    expect(service.getAuditoria.mock.calls[0][6]).toBe(true);
  });

  function financeiro() {
    const service: any = {
      getAllMoradores: jest.fn(),
      getAllInadimplentes: jest.fn(),
      getInadimplenciaDashboard: jest.fn(),
      getInadimplenteDetail: jest.fn(),
      notifyInadimplente: jest.fn(),
    };
    return { ctrl: new FinanceiroController(service, {} as any), service };
  }

  it('inadimplência: porteiro com turno "Síndico" recebe 403 nas cinco rotas; síndico passa', () => {
    const chamadas = (c: FinanceiroController, u: JwtPayload) => [
      () => c.getAllMoradores('1', '1', '2026', u),
      () => c.getAllInadimplentes('1', u),
      () => c.inadimplenciaDashboard('1', '1', '2026', u),
      () => c.getInadimplenteDetail('1', '101', 'A', u),
      () => c.notifyInadimplente('1', '101', 'A', u),
    ];
    const { ctrl, service } = financeiro();
    for (const f of chamadas(ctrl, porteiroTurnoSindico)) expect(f).toThrow(ForbiddenException);
    expect(service.getAllInadimplentes).not.toHaveBeenCalled();
    for (const [, u] of legitimos) for (const f of chamadas(ctrl, u)) expect(f).not.toThrow();
  });

  it('reindexar o assistente (chat-ia): porteiro com turno "Síndico" → 403 sem tocar no índice; síndico passa', async () => {
    const prisma: any = { isConnected: true, documentos: { findMany: jest.fn(async () => []) }, rag_Embeddings: { deleteMany: jest.fn(async () => ({ count: 0 })) } };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const svc = new (ChatIaService as any)(prisma, tenant, {}) as ChatIaService;
    await expect(svc.reindexCondominio(1, porteiroTurnoSindico)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.documentos.findMany).not.toHaveBeenCalled();
    await expect(svc.reindexCondominio(1, sindicoSenha)).resolves.toBeDefined();
  });

  describe('o app não grava o turno reservado', () => {
    const sindico = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 9 } } as any;
    function svc() {
      const prisma: any = {
        isConnected: true,
        funcionarios_Portaria: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      };
      return { s: new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any), prisma };
    }

    it.each([['Síndico'], ['  sindico '], ['SÍNDICO']])('cadastro e edição com ch %p → 400 e nada é gravado', async (ch) => {
      const { s, prisma } = svc();
      await expect(
        s.saveFuncionario({ id_condominio: 1, funcionario: { nome: 'P', email: 'p@x.com', senha: 'Senha#1', ch } }, false, sindico),
      ).rejects.toThrow(new BadRequestException('Este turno é reservado.'));
      await expect(s.saveFuncionario({ id_condominio: 1, funcionario: { id: 12, ch } }, true, sindico)).rejects.toThrow(
        'Este turno é reservado.',
      );
      expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
      expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
    });
  });
});
