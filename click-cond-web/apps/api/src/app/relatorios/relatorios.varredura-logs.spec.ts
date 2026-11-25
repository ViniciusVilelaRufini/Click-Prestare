import { RelatoriosService } from './relatorios.service';
import { RelatoriosController, CondominiosExportController } from './relatorios.controller';
import { CondominiosExportService } from './condominios-export.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Varredura 25/11 (Log de Auditoria / Log de Eventos), tarefa C:
 *  1. o feed de eventos mandava o documento cru para o porteiro;
 *  2. ONLINE/OFFLINE de dispositivo saía como "Ocorrência · Resolvido";
 *  3. abertura manual e falha de acionamento caíam como "entrada";
 *  4. CSV da auditoria: separador vírgula (Excel pt-BR abre numa coluna só),
 *     ação/módulo crus, PIN antigo nos detalhes e export sem autor.
 */
describe('Varredura 25/11 — relatórios (tarefa C)', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function comEspinha(prisma: any, linhas: Array<[string, number]>) {
    const svc: any = new RelatoriosService(prisma);
    jest.spyOn(svc, 'consultarEspinhaEventos').mockResolvedValue({
      linhas: linhas.map(([fonte, id]) => ({ fonte, id })),
      total: linhas.length,
    });
    return svc as RelatoriosService;
  }

  function buildPrisma(over: any = {}) {
    return {
      isConnected: true,
      visitantes: { findMany: jest.fn(async () => []) },
      visitas: { findMany: jest.fn(async () => []) },
      pessoas: { findMany: jest.fn(async () => []) },
      moradores: { findMany: jest.fn(async () => []) },
      prestadores_servico: { findMany: jest.fn(async () => []) },
      encomendas: { findMany: jest.fn(async () => []) },
      ocorrencias: { findMany: jest.fn(async () => []) },
      acessos_Facial: { findMany: jest.fn(async () => []) },
      auditLog: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0), create: jest.fn(async () => ({})) },
      facial_Devices: { findMany: jest.fn(async () => [{ id: 1, nome: 'Portão', ip: '10.0.0.9' }]) },
      ...over,
    } as any;
  }

  const visitante = {
    id: 30, nome: 'Maria', doc_identificacao: '45346648852', is_prestador: 0,
    data_entrada: new Date('2026-11-20T10:00:00Z'), data_saida: new Date('2026-11-20T12:00:00Z'),
    foto_pessoa: null, apartamento: { apto: '106', bloco: 'Bloco A' }, criadoPor: { name: 'M' },
  };
  const facialVisitante = {
    id: 9, id_condominio: 1, id_device: 1, tipo_dispositivo: 'facial', evento: 'entrada', confianca: 0.9,
    timestamp: new Date('2026-11-20T10:00:00Z'), nome_pessoa: 'Maria', tipo_pessoa: 'visitante', id_pessoa: 30,
  };

  function prismaComDocumentos() {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    return buildPrisma({
      visitantes: {
        findMany: jest.fn(async (a: any) =>
          a?.include
            ? [visitante]
            : [{ id: 30, foto_pessoa: null, doc_identificacao: '45346648852', apartamento: { bloco: 'A', apto: '106' } }],
        ),
      },
      acessos_Facial: { findMany: jest.fn(async () => [facialVisitante]) },
    });
  }
  const espinhaDocs: Array<[string, number]> = [['visita_entrada', 30], ['visita_saida', 30], ['facial', 9]];

  describe('1. documento no Log de Eventos', () => {
    it('CPF só com os 4 últimos dígitos em visita e facial', async () => {
      const r: any = await comEspinha(prismaComDocumentos(), espinhaDocs).getEventos(1);
      expect(r.items).toHaveLength(3);
      for (const ev of r.items) expect(ev.detalhes.documento).toBe('***.***.*88-52');
      expect(JSON.stringify(r)).not.toContain('45346648852');
    });

    it('o service não aceita mais pedido de documento inteiro (8º argumento ignorado)', async () => {
      const r: any = await (comEspinha(prismaComDocumentos(), espinhaDocs) as any).getEventos(
        1, undefined, undefined, 1, 50, undefined, null, false,
      );
      expect(JSON.stringify(r)).not.toContain('45346648852');
    });

    it('"Não informado" continua legível', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const prisma = buildPrisma({
        visitantes: { findMany: jest.fn(async () => [{ ...visitante, doc_identificacao: null }]) },
      });
      const r: any = await comEspinha(prisma, [['visita_entrada', 30]]).getEventos(1);
      expect(r.items[0].detalhes.documento).toBe('Não informado');
    });

    it('controller: mascara para todos (a tela não tem "revelar"); não repassa flag de máscara', async () => {
      const getEventos = jest.fn(async () => ({ items: [] }));
      const ctrl = new RelatoriosController({ getEventos } as any);
      const porteiro: JwtPayload = { sub: 12, nome: 'P', id_condominio: 1, tipo_sub: 'funcionario_portaria' } as any;
      const sindico: JwtPayload = { sub: 11, nome: 'S', typeAccess: 'Sindico' } as any;
      await ctrl.getEventos(1, porteiro);
      await ctrl.getEventos(1, sindico);
      expect(getEventos.mock.calls[0] as any[]).toHaveLength(7);
      expect(getEventos.mock.calls[1] as any[]).toHaveLength(7);
    });
  });

  describe('2. evento de dispositivo', () => {
    it('ONLINE/OFFLINE saem como tipo "Dispositivo" com status Online/Offline', async () => {
      const prisma = buildPrisma({
        auditLog: {
          findMany: jest.fn(async () => [
            { id: 4, acao: 'OFFLINE', descricao: 'Terminal 1 ficou offline', created_at: new Date('2026-11-20T10:00:00Z'), ip: null },
            { id: 5, acao: 'ONLINE', descricao: 'Terminal 1 voltou', created_at: new Date('2026-11-20T11:00:00Z'), ip: null },
          ]),
        },
      });
      const r: any = await comEspinha(prisma, [['dispositivo', 5], ['dispositivo', 4]]).getEventos(1);
      const por = (id: string) => r.items.find((i: any) => i.id === id);
      expect(por('dispositivo-4')).toMatchObject({ tipo: 'Dispositivo', direcao: 'offline', detalhes: { status: 'Offline' } });
      expect(por('dispositivo-5')).toMatchObject({ tipo: 'Dispositivo', direcao: 'online', detalhes: { status: 'Online' } });
    });

    // O card da tela mostra detalhes.nome/terminalNome: tem de ser o aparelho (gravado em
    // usuario_nome pelo monitor), não o rótulo fixo "Dispositivos".
    it('leva o nome do terminal (usuario_nome do registro) para o card', async () => {
      const prisma = buildPrisma({
        auditLog: {
          findMany: jest.fn(async () => [
            { id: 6, acao: 'OFFLINE', usuario_nome: 'Facial portão social', descricao: 'Terminal offline', created_at: new Date('2026-11-20T10:00:00Z'), ip: '10.0.0.5' },
          ]),
        },
      });
      const r: any = await comEspinha(prisma, [['dispositivo', 6]]).getEventos(1);
      expect(r.items[0].detalhes).toMatchObject({ nome: 'Facial portão social', terminalNome: 'Facial portão social' });
    });
  });

  describe('3. direção do acesso facial', () => {
    it.each([
      ['entrada', 'entrada'],
      ['saida', 'saida'],
      ['negado', 'bloqueado'],
      ['acionado_manual', 'manual'],
      ['falha_acionamento', 'falha'],
    ])('evento %s -> direção %s', async (evento, direcao) => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const prisma = buildPrisma({
        acessos_Facial: {
          findMany: jest.fn(async () => [{ ...facialVisitante, evento, tipo_pessoa: 'operador', id_pessoa: null }]),
        },
      });
      const r: any = await comEspinha(prisma, [['facial', 9]]).getEventos(1);
      expect(r.items[0].direcao).toBe(direcao);
    });
  });

  describe('4. CSV da auditoria', () => {
    const linha = {
      id: 1, created_at: new Date('2026-11-24T15:30:05.000Z'), usuario_nome: 'Porteiro; Turno A', usuario_email: 'p@x.com',
      acao: 'CREATE', modulo: 'facial-health', entidade_id: 5, descricao: 'Criação em Visitantes', ip: '1.2.3.4',
      detalhes: JSON.stringify({ nome: 'Maria', codigoAcesso: '483920', documento: '45346648852' }),
    };
    function build(rows: any[]) {
      const prisma = buildPrisma();
      prisma.auditLog.findMany = jest.fn(async () => rows);
      const auditoria: any = { registrar: jest.fn(async () => undefined) };
      return { prisma, auditoria, svc: new RelatoriosService(prisma, auditoria) };
    }

    it('a) separador ";" (Excel pt-BR), BOM mantido, ";" dentro do valor vai citado', async () => {
      const { svc } = build([linha]);
      const csv = (await svc.exportAuditoriaCsv(1)).buffer.toString('utf8');
      expect(csv.startsWith('﻿')).toBe(true);
      const [cabecalho, l1] = csv.slice(1).split('\n');
      expect(cabecalho).toBe('Data;Usuário;E-mail;Ação;Módulo;Entidade;Descrição;IP;Detalhes');
      expect(l1.startsWith('"24/11/2026, 12:30:05";"Porteiro; Turno A";p@x.com;')).toBe(true);
    });

    it('b) ação e módulo em português', async () => {
      const { svc } = build([linha]);
      const csv = (await svc.exportAuditoriaCsv(1)).buffer.toString('utf8');
      const l1 = csv.split('\n')[1];
      expect(l1).toContain(';Criação;Reconhecimento facial;');
      expect(l1).not.toContain('CREATE');
      expect(l1).not.toContain('facial-health');
    });

    it('c) detalhes sem PIN e com documento mascarado', async () => {
      const { svc } = build([linha]);
      const csv = (await svc.exportAuditoriaCsv(1)).buffer.toString('utf8');
      expect(csv).not.toContain('483920');
      expect(csv).not.toContain('codigoAcesso');
      expect(csv).not.toContain('45346648852');
      expect(csv).toContain('***.***.*88-52');
      expect(csv).toContain('Maria');
    });

    it('d) rastro do export leva autor_id/autor_tipo', async () => {
      const { svc, auditoria } = build([linha]);
      await svc.exportAuditoriaCsv(1, undefined, undefined, undefined, {
        nome: 'S', email: 's@x.com', autor_id: 11, autor_tipo: 'user',
      });
      expect(auditoria.registrar.mock.calls[0][0]).toMatchObject({ acao: 'EXPORT', autor_id: 11, autor_tipo: 'user' });
    });

    it('d) sem AuditoriaService o insert direto também leva o autor', async () => {
      const prisma = buildPrisma();
      await new RelatoriosService(prisma).exportAuditoriaCsv(1, undefined, undefined, undefined, {
        nome: 'S', autor_id: 11, autor_tipo: 'user',
      });
      expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ autor_id: 11, autor_tipo: 'user' });
    });

    it('d) controller passa o autor do token', async () => {
      const exportAuditoriaCsv = jest.fn(async () => ({ buffer: Buffer.from(''), filename: 'x.csv' }));
      const ctrl = new RelatoriosController({ exportAuditoriaCsv } as any);
      const res: any = { setHeader: jest.fn(), end: jest.fn() };
      const sindico: JwtPayload = { sub: 11, nome: 'S', email: 's@x.com', typeAccess: 'Sindico' } as any;
      await ctrl.exportAuditoria(1, res, sindico);
      expect((exportAuditoriaCsv.mock.calls[0] as any[])[4]).toMatchObject({ autor_id: 11, autor_tipo: 'user' });
    });
  });

  describe('4d. export LGPD completo', () => {
    function exportService() {
      const vazio = { findMany: jest.fn(async () => []) };
      const prisma: any = {
        moradores: vazio, veiculos: vazio, vagas: vazio, visitantes: vazio, visitas: vazio,
        prestadores_servico: vazio, encomendas: vazio, ocorrencias: vazio, acessos_Facial: vazio,
        auditLog: { create: jest.fn(async () => ({})) },
      };
      return { prisma, svc: new CondominiosExportService(prisma) };
    }

    it('registra EXPORT com autor_id/autor_tipo', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const { prisma, svc } = exportService();
      await svc.gerarPacoteExportacao(1, { nome: 'S', email: 's@x.com', autor_id: 11, autor_tipo: 'user' });
      expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ acao: 'EXPORT', autor_id: 11, autor_tipo: 'user' });
    });

    it('os CSVs do pacote usam ";"', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const AdmZip = require('adm-zip');
      const { svc } = exportService();
      const { buffer } = await svc.gerarPacoteExportacao(1);
      const csv = new AdmZip(buffer).getEntry('registros_acessos.csv').getData().toString('utf8');
      expect(csv.slice(1).split('\n')[0]).toBe('Data/Hora;Pessoa;Tipo Pessoa;Ponto de Acesso;Evento;Confiança (%)');
    });

    it('controllers passam o autor do token', async () => {
      const gerarPacoteExportacao = jest.fn(async () => ({ buffer: Buffer.from(''), filename: 'x.zip' }));
      const res: any = { setHeader: jest.fn(), end: jest.fn() };
      const sindico: JwtPayload = { sub: 11, nome: 'S', email: 's@x.com', typeAccess: 'Sindico' } as any;
      await new RelatoriosController({} as any, { gerarPacoteExportacao } as any).exportDadosCondominio(1, res, sindico);
      await new CondominiosExportController({ gerarPacoteExportacao } as any).exportDados(1, res, sindico);
      for (const call of gerarPacoteExportacao.mock.calls as any[]) {
        expect(call[1]).toMatchObject({ autor_id: 11, autor_tipo: 'user' });
      }
    });
  });
});
