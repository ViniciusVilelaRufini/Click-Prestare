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
    const linha = (turno: string | null) => ({ id: 12, nome: 'P', login: 'p@x.com', email: 'p@x.com', telefone: '1', turno, ativo: 1, id_condominio: 1, password: '$2b$04$h' });
    function svc(turnoAtual: string | null = 'Diurno') {
      const prisma: any = {
        isConnected: true,
        funcionarios_Portaria: {
          findUnique: jest.fn(async () => linha(turnoAtual)),
          findFirst: jest.fn(async () => null),
          create: jest.fn(),
          update: jest.fn(async ({ data }: any) => ({ ...linha(turnoAtual), ...data })),
        },
        // Conta do porteiro já da equipe daqui: a sincronização só atualiza.
        users: { findFirst: jest.fn(async () => ({ id: 5, login: 'p@x.com', password: 'h' })), update: jest.fn(async () => ({})) },
        funcionarios: { findFirst: jest.fn(async () => ({ id: 70 })), update: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
        sindicos_Condominios: { count: jest.fn(async () => 0) },
        moradores: { count: jest.fn(async () => 0) },
        apartamentos_Users: { count: jest.fn(async () => 0) },
      };
      const tenant: any = { assertEntidade: jest.fn(async () => undefined), assertCondominio: jest.fn(async () => undefined) };
      const storage: any = { isDataUrl: () => false, exigirArquivoDoRegistro: jest.fn(async () => undefined) };
      return { s: new MobileAuthService(prisma, {} as any, {} as any, storage, {} as any, tenant), prisma };
    }
    /** O payload do app 1.2.48 na edição: reenvia o turno salvo (ch) junto com nome e telefone. */
    const edicao = (ch: string) => ({ id_condominio: 1, funcionario: { id: 12, nome: 'P 2', email: 'p@x.com', telefone: '2', ch, senha: '' } });

    it.each([['Síndico'], ['  sindico '], ['SÍNDICO']])('cadastro com ch %p → 400 e nada é gravado', async (ch) => {
      const { s, prisma } = svc();
      await expect(
        s.saveFuncionario({ id_condominio: 1, funcionario: { nome: 'P', email: 'p@x.com', senha: 'Senha#1', ch } }, false, sindico),
      ).rejects.toThrow(new BadRequestException('Este turno é reservado.'));
      expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
    });

    it.each([['Síndico'], ['  sindico ']])('edição que MUDA o turno para %p → 400 e nada é gravado', async (ch) => {
      const { s, prisma } = svc('Diurno');
      await expect(s.saveFuncionario(edicao(ch), true, sindico)).rejects.toThrow('Este turno é reservado.');
      expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
    });

    it('edição de funcionário legado que já tem o turno "Síndico" e o mantém (o app reenvia): passa', async () => {
      const { s, prisma } = svc('Síndico');
      await expect(s.saveFuncionario(edicao('Síndico'), true, sindico)).resolves.toBe('');
      expect(prisma.funcionarios_Portaria.update.mock.calls[0][0].data).toEqual(expect.objectContaining({ nome: 'P 2', telefone: '2' }));
    });

    it('gerenciar funcionários exige o typeAccess de síndico (o turno "Síndico" sozinho não basta)', async () => {
      const { s, prisma } = svc();
      const soTurno = { sub: 9, nome: 'X', turno: 'Síndico', user: { id: 9 } } as any;
      await expect(s.saveFuncionario(edicao('Diurno'), true, soTurno)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.funcionarios_Portaria.findUnique).not.toHaveBeenCalled();
      await expect(s.saveFuncionario(edicao('Diurno'), true, sindico)).resolves.toBe('');
    });
  });
});
