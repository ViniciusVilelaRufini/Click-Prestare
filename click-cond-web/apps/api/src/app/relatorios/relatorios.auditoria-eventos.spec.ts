import { RelatoriosService } from './relatorios.service';

/**
 * Defeitos do "Log de Auditoria" e do "Log de Eventos" (serviço):
 *  - foto do documento do visitante saía em toda linha de evento;
 *  - o porteiro lia pelo log os módulos que o controller declara sigilosos;
 *  - o filtro por módulo perdia linhas gravadas com nome vizinho;
 *  - "Apto 106Bloco A" (rótulo colado);
 *  - histórico cortado em 2000 linhas por fonte sem aviso (hoje paginado no
 *    banco, sem teto — ver relatorios.eventos-paginacao.spec.ts);
 *  - exportar o log não deixava rastro.
 */
describe('RelatoriosService — auditoria e eventos', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  /**
   * A página do Log de Eventos vem de SQL cru (ver eventos-espinha.ts), que o
   * Prisma simulado não executa: aqui a "espinha" (fonte, id) é informada à
   * mão e o teste confere a hidratação/contrato. O SQL em si é exercitado em
   * relatorios.eventos-paginacao.spec.ts.
   */
  function comEspinha(prisma: any, linhas: Array<[string, number]>, total = linhas.length) {
    const svc: any = new RelatoriosService(prisma);
    jest.spyOn(svc, 'consultarEspinhaEventos').mockResolvedValue({
      linhas: linhas.map(([fonte, id]) => ({ fonte, id })),
      total,
    });
    return svc as RelatoriosService;
  }

  function buildPrisma(over: any = {}) {
    const prisma: any = {
      isConnected: true,
      visitantes: { findMany: jest.fn(async () => []) },
      visitas: { findMany: jest.fn(async () => []) },
      pessoas: { findMany: jest.fn(async () => []) },
      moradores: { findMany: jest.fn(async () => []) },
      prestadores_servico: { findMany: jest.fn(async () => []) },
      encomendas: { findMany: jest.fn(async () => []) },
      ocorrencias: { findMany: jest.fn(async () => []) },
      acessos_Facial: { findMany: jest.fn(async () => []) },
      auditLog: {
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        create: jest.fn(async () => ({})),
      },
      facial_Devices: { findMany: jest.fn(async () => []) },
      ...over,
    };
    return prisma;
  }

  const visitanteLegado = {
    id: 30,
    nome: 'Maria Legado',
    doc_identificacao: '98765432100',
    is_prestador: 0,
    data_entrada: new Date('2026-09-01T10:00:00Z'),
    data_saida: new Date('2026-09-01T12:00:00Z'),
    foto_pessoa: 'rosto.jpg',
    foto_documento: 'rg.jpg',
    apartamento: { apto: '106', bloco: 'Bloco A' },
    criadoPor: { name: 'Morador Teste' },
  };

  describe('getEventos() — foto do documento', () => {
    it('flag OFF: nenhuma linha de visitante devolve fotoDocumento', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const prisma = buildPrisma({ visitantes: { findMany: jest.fn(async () => [visitanteLegado]) } });
      const r: any = await comEspinha(prisma, [['visita_entrada', 30], ['visita_saida', 30]]).getEventos(1);
      expect(r.items).toHaveLength(2);
      for (const ev of r.items) {
        expect(ev.detalhes).not.toHaveProperty('fotoDocumento');
        expect(ev.detalhes.fotoPessoa).toBe('rosto.jpg');
      }
      expect(JSON.stringify(r)).not.toContain('rg.jpg');
    });

    it('flag ON: não devolve fotoDocumento e nem busca a coluna (select enxuto de pessoa)', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const visita = {
        id: 300,
        is_prestador: 0,
        data_entrada: new Date('2026-09-01T10:00:00Z'),
        data_saida: null,
        apartamento: { apto: '106', bloco: 'Bloco A' },
        criadoPor: { name: 'Morador Teste' },
        pessoa: { id: 700, nome: 'Maria Migrada', doc_identificacao: '1', foto_pessoa: 'rosto.jpg', foto_documento: 'rg.jpg' },
      };
      const prisma = buildPrisma({
        visitas: { findMany: jest.fn(async () => [visita]) },
      });
      const r: any = await comEspinha(prisma, [['visita_entrada', 300]]).getEventos(1);
      const ev = r.items.find((i: any) => i.detalhes?.nome === 'Maria Migrada');
      expect(ev).toBeDefined();
      expect(ev.detalhes).not.toHaveProperty('fotoDocumento');
      expect(ev.detalhes.fotoPessoa).toBe('rosto.jpg');
      expect(JSON.stringify(r)).not.toContain('rg.jpg');

      expect(prisma.visitas.findMany).toHaveBeenCalled();
      for (const call of prisma.visitas.findMany.mock.calls) {
        const args: any = call[0];
        expect(args.include.pessoa).toEqual({
          select: { id: true, nome: true, doc_identificacao: true, foto_pessoa: true },
        });
      }
    });
  });

  describe('getEventos() — rótulo da unidade', () => {
    it('visitante (entrada e saída): "Apto 106 · Bloco A", sem colar o bloco', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const prisma = buildPrisma({ visitantes: { findMany: jest.fn(async () => [visitanteLegado]) } });
      const r: any = await comEspinha(prisma, [['visita_entrada', 30], ['visita_saida', 30]]).getEventos(1);
      const ent = r.items.find((i: any) => i.id === 'visitante-ent-30');
      const sai = r.items.find((i: any) => i.id === 'visitante-sai-30');
      expect(ent.detalhes.blocoApto).toBe('Apto 106 · Bloco A');
      expect(ent.descricao).toBe('Maria Legado entrou — Apto 106 · Bloco A');
      expect(sai.detalhes.blocoApto).toBe('Apto 106 · Bloco A');
      expect(sai.descricao).toBe('Maria Legado saiu — Apto 106 · Bloco A');
    });

    it('visitante sem bloco: só "Apto 106"', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const prisma = buildPrisma({
        visitantes: {
          findMany: jest.fn(async () => [{ ...visitanteLegado, data_saida: null, apartamento: { apto: '106', bloco: null } }]),
        },
      });
      const r: any = await comEspinha(prisma, [['visita_entrada', 30]]).getEventos(1);
      const ent = r.items.find((i: any) => i.id === 'visitante-ent-30');
      expect(ent.detalhes.blocoApto).toBe('Apto 106');
    });

    it('encomenda: bloco cadastrado só como "A" vira "Apto 101 · Bloco A"', async () => {
      const prisma = buildPrisma({
        encomendas: {
          findMany: jest.fn(async () => [
            {
              id: 7, descricao: 'Caixa', destinatario_apto: '101', destinatario_bloco: 'A',
              recebido_de: null, recebido_em: new Date('2026-10-03T14:00:00Z'), status: 'Aguardando',
              recebidoPor: null, entreguePor: null,
            },
          ]),
        },
      });
      const r: any = await comEspinha(prisma, [['encomenda', 7]]).getEventos(1);
      const ev = r.items.find((i: any) => i.id === 'encomenda-7');
      expect(ev.detalhes.blocoApto).toBe('Apto 101 · Bloco A');
      expect(ev.detalhes.nome).toBe('Apto 101 · Bloco A');
      expect(ev.descricao).toBe('Caixa — Apto 101 · Bloco A');
    });

    it('acesso facial de morador, visitante e funcionário usa o mesmo rótulo', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const base = {
        id_condominio: 1, tipo_dispositivo: 'facial', evento: 'entrada', confianca: 0.9, id_device: 1,
      };
      const prisma = buildPrisma({
        acessos_Facial: {
          findMany: jest.fn(async () => [
            { ...base, id: 1, timestamp: new Date('2026-09-05T08:00:00Z'), nome_pessoa: 'Mora', tipo_pessoa: 'morador', id_pessoa: 1 },
            { ...base, id: 2, timestamp: new Date('2026-09-05T09:00:00Z'), nome_pessoa: 'Visi', tipo_pessoa: 'visitante', id_pessoa: 2 },
            { ...base, id: 3, timestamp: new Date('2026-09-05T10:00:00Z'), nome_pessoa: 'Func', tipo_pessoa: 'funcionario', id_pessoa: 3 },
          ]),
        },
        moradores: { findMany: jest.fn(async () => [{ id: 1, foto_pessoa: null, bloco: 'Bloco A', apartamento: '106', user: null }]) },
        visitantes: {
          findMany: jest.fn(async (a: any) =>
            a?.where?.id?.in ? [{ id: 2, foto_pessoa: null, doc_identificacao: null, apartamento: { bloco: 'Bloco B', apto: '202' } }] : [],
          ),
        },
        prestadores_servico: { findMany: jest.fn(async () => [{ id: 3, foto_pessoa: null, apartamento: { bloco: 'C', apto: '303' } }]) },
      });
      const r: any = await comEspinha(prisma, [['facial', 1], ['facial', 2], ['facial', 3]]).getEventos(1);
      const por = (nome: string) => r.items.find((i: any) => i.detalhes?.nome === nome).detalhes.blocoApto;
      expect(por('Mora')).toBe('Apto 106 · Bloco A');
      expect(por('Visi')).toBe('Apto 202 · Bloco B');
      expect(por('Func')).toBe('Apto 303 · Bloco C');
    });
  });

  describe('getEventos() — truncado', () => {
    // A paginação passou a ser feita no banco: não existe mais teto por fonte.
    // O campo continua no contrato (a tela o lê), sempre `false`.
    it('false com a lista vazia', async () => {
      const r: any = await comEspinha(buildPrisma(), []).getEventos(1);
      expect(r.truncado).toBe(false);
    });

    it('false mesmo com histórico grande: o total vem da contagem do banco, não do que foi lido', async () => {
      const ocorrencias = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1, descricao: 'x', status: 'Aberta', created_at: new Date('2026-09-01T10:00:00Z'),
        criadoPor: null, categoria: null, resposta: null, resposta_at: null,
      }));
      const prisma = buildPrisma({ ocorrencias: { findMany: jest.fn(async () => ocorrencias) } });
      const pagina = ocorrencias.slice(0, 10).map((o) => ['ocorrencia', o.id] as [string, number]);
      const r: any = await comEspinha(prisma, pagina, 123456).getEventos(1, undefined, undefined, 1, 10);
      expect(r.truncado).toBe(false);
      expect(r.total).toBe(123456);
      // Linhas que o banco devolver além da página não entram na resposta.
      expect(r.items).toHaveLength(10);
    });

    it('sem banco: devolve truncado false', async () => {
      const r: any = await new RelatoriosService(buildPrisma({ isConnected: false })).getEventos(1);
      expect(r.truncado).toBe(false);
    });
  });

  describe('getAuditoria() — módulos sigilosos', () => {
    const SIGILOSOS = ['financeiro', 'crm', 'crm-condominio', 'superlogica', 'auth', 'AUTH'];

    async function whereDe(modulo: string | undefined, verSigilosos?: boolean) {
      const prisma = buildPrisma();
      const svc: any = new RelatoriosService(prisma);
      const r = await svc.getAuditoria(1, modulo, undefined, undefined, 1, 50, verSigilosos);
      expect(prisma.auditLog.count.mock.calls[0][0].where).toEqual(prisma.auditLog.findMany.mock.calls[0][0].where);
      return { where: prisma.auditLog.findMany.mock.calls[0][0].where, r };
    }

    it('porteiro sem filtro: exclui os módulos sigilosos', async () => {
      const { where } = await whereDe(undefined, false);
      expect(where).toEqual({ id_condominio: 1, modulo: { notIn: SIGILOSOS } });
    });

    it('por padrão (sem dizer o papel) também exclui', async () => {
      const { where } = await whereDe('todos');
      expect(where.modulo).toEqual({ notIn: SIGILOSOS });
    });

    it.each(['financeiro', 'crm', 'crm-condominio', 'superlogica', 'FINANCEIRO', ' Financeiro '])(
      'porteiro pedindo "%s": resultado vazio, sem erro',
      async (modulo) => {
        const { where } = await whereDe(modulo, false);
        expect(where.modulo).toEqual({ in: [] });
      },
    );

    it('síndico sem filtro: vê tudo', async () => {
      const { where } = await whereDe(undefined, true);
      expect(where).toEqual({ id_condominio: 1 });
    });

    it('síndico pedindo financeiro: igualdade simples', async () => {
      const { where } = await whereDe('financeiro', true);
      expect(where.modulo).toBe('financeiro');
    });
  });

  describe('getAuditoria() — filtro por módulo como grupo', () => {
    async function moduloWhere(modulo: any, verSigilosos = false) {
      const prisma = buildPrisma();
      await (new RelatoriosService(prisma) as any).getAuditoria(1, modulo, undefined, undefined, 1, 50, verSigilosos);
      return prisma.auditLog.findMany.mock.calls[0][0].where.modulo;
    }

    it('visitantes inclui visitas e pessoas', async () => {
      expect(await moduloWhere('visitantes')).toEqual({ in: ['visitantes', 'visitas', 'pessoas'] });
    });

    it('facial inclui facial-health e dispositivos', async () => {
      expect(await moduloWhere('facial')).toEqual({ in: ['facial', 'facial-health', 'dispositivos'] });
    });

    it('auth inclui AUTH em maiúsculas (síndico)', async () => {
      expect(await moduloWhere('auth', true)).toEqual({ in: ['auth', 'AUTH'] });
    });

    it('porteiro pedindo auth recebe lista vazia: logins são só do síndico', async () => {
      expect(await moduloWhere('auth')).toEqual({ in: [] });
      expect(await moduloWhere('AUTH')).toEqual({ in: [] });
    });

    it('demais módulos seguem com igualdade simples', async () => {
      expect(await moduloWhere('encomendas')).toBe('encomendas');
    });
  });

  describe('exportAuditoriaCsv() — rastro do export', () => {
    const linha = {
      id: 1, created_at: new Date('2026-09-01T10:00:00Z'), usuario_nome: 'P', usuario_email: null,
      acao: 'CREATE', modulo: 'visitantes', entidade_id: 5, descricao: 'd', ip: null, detalhes: null,
    };

    it('com AuditoriaService: registra quem, filtros e quantidade de linhas', async () => {
      const prisma = buildPrisma();
      prisma.auditLog.findMany = jest.fn(async () => [linha, linha]);
      const auditoria: any = { registrar: jest.fn(async () => undefined) };
      const svc: any = new (RelatoriosService as any)(prisma, auditoria);
      const { buffer } = await svc.exportAuditoriaCsv(1, 'visitantes', '2026-09-01', '2026-09-30', {
        nome: 'Síndico Teste',
        email: 's@x.com',
      });
      expect(buffer.length).toBeGreaterThan(0);
      expect(auditoria.registrar).toHaveBeenCalledTimes(1);
      expect(auditoria.registrar).toHaveBeenCalledWith({
        id_condominio: 1,
        usuario_nome: 'Síndico Teste',
        usuario_email: 's@x.com',
        acao: 'EXPORT',
        modulo: 'auditoria',
        descricao: 'Exportação do log de auditoria em CSV (2 linhas)',
        detalhes: {
          filtros: { modulo: 'visitantes', dataInicio: '2026-09-01', dataFim: '2026-09-30' },
          linhas: 2,
        },
      });
      // O export é só do síndico: não aplica o recorte de módulos sigilosos.
      expect(prisma.auditLog.findMany.mock.calls[0][0].where.modulo).toEqual({
        in: ['visitantes', 'visitas', 'pessoas'],
      });
    });

    it('sem AuditoriaService (instância montada à mão): grava direto no auditLog', async () => {
      const prisma = buildPrisma();
      prisma.auditLog.findMany = jest.fn(async () => [linha]);
      await new RelatoriosService(prisma).exportAuditoriaCsv(1);
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const data = prisma.auditLog.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        id_condominio: 1,
        usuario_nome: 'Síndico',
        usuario_email: null,
        acao: 'EXPORT',
        modulo: 'auditoria',
      });
      expect(JSON.parse(data.detalhes)).toEqual({
        filtros: { modulo: null, dataInicio: null, dataFim: null },
        linhas: 1,
      });
    });

    it('síndico exportando sem filtro continua vendo os módulos sigilosos', async () => {
      const prisma = buildPrisma();
      await new RelatoriosService(prisma).exportAuditoriaCsv(1);
      expect(prisma.auditLog.findMany.mock.calls[0][0].where).toEqual({ id_condominio: 1 });
    });

    it('falha ao registrar o rastro não derruba o export', async () => {
      const prisma = buildPrisma();
      prisma.auditLog.create = jest.fn(async () => {
        throw new Error('db fora');
      });
      const erro = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { buffer } = await new RelatoriosService(prisma).exportAuditoriaCsv(1);
      expect(buffer.length).toBeGreaterThan(0);
      erro.mockRestore();
    });
  });
});
