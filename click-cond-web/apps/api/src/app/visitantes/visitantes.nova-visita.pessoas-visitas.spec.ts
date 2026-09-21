import { VisitantesService } from './visitantes.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { VisitasService } from '../visitas/visitas.service';

/**
 * Lote B / Critical 2: `novaVisitaParaPessoa` resolvia o id recebido contra
 * `Visitantes` incondicionalmente — quebrado com a flag ligada (o
 * front-end manda `id_pessoa`, um id de `Pessoas`) e, pior, perigoso: um
 * `id_pessoa` que por coincidência bate com o `Visitantes.id`/`Visitas.id`
 * de OUTRA pessoa copiaria a identidade (nome, doc, foto, face_id) dela para
 * a visita nova — autorizando a porta para o rosto errado.
 *
 * Este spec prova que, com a flag ligada, a resolução de IDENTIDADE usa SÓ
 * `Pessoas` — `prisma.visitantes.findUnique` (que resolveria o id recebido
 * contra a identidade errada) nunca é chamado. `gerarPinUnicoVisita` ainda
 * consulta `prisma.visitantes.findFirst` de propósito (checa unicidade do
 * PIN nas duas tabelas, comportamento existente e correto — não é o
 * Critical), então essa chamada específica é permitida.
 */
function buildHarness() {
  let pessoasSeq = 1;
  let visitasSeq = 1;
  const pessoas: any[] = [];
  const visitas: any[] = [];

  // Só a resolução de IDENTIDADE é o que o Critical proíbe. `findFirst` é
  // usado por `gerarPinUnicoVisita` (checa unicidade do PIN nas duas
  // tabelas) de propósito — rastreado à parte, não conta como o defeito.
  const visitantesDelegate = jest.fn(); // findUnique/findMany/create/update/updateMany — NUNCA devem ser chamados
  const visitantesPinCheck = jest.fn().mockResolvedValue(null);

  const prisma: any = {
    isConnected: true,
    visitantes: {
      findUnique: visitantesDelegate,
      findFirst: visitantesPinCheck,
      findMany: visitantesDelegate,
      create: visitantesDelegate,
      update: visitantesDelegate,
      updateMany: visitantesDelegate,
    },
    pessoas: {
      findUnique: jest.fn(async ({ where }: any) => pessoas.find((p) => p.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id !== undefined) {
          return (
            pessoas.find((p) => p.id === Number(where.id) && p.id_condominio === where.id_condominio) ?? null
          );
        }
        if (where.doc_identificacao) {
          return pessoas.find((p) => p.id_condominio === where.id_condominio && p.doc_identificacao === where.doc_identificacao) ?? null;
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const novo = { id: pessoasSeq++, ...data };
        pessoas.push(novo);
        return novo;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const p = pessoas.find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      }),
    },
    visitas: {
      create: jest.fn(async ({ data }: any) => {
        const nova = {
          id: visitasSeq++,
          bloqueado: 0,
          data_entrada: null,
          data_saida: null,
          ...data,
          created_at: new Date('2026-09-20T12:00:00Z'),
          updated_at: new Date('2026-09-20T12:00:00Z'),
        };
        visitas.push(nova);
        const pessoa = pessoas.find((p) => p.id === nova.id_pessoa);
        return { ...nova, pessoa, apartamento: { id: nova.id_apartamento, bloco: 'A', apto: '101' } };
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        // Usado por gerarPinUnicoVisita (unicidade) e pela busca da última
        // visita (dias_semana/categorias herdados).
        if (where?.id_pessoa !== undefined) {
          const doPessoa = visitas.filter((v) => v.id_pessoa === where.id_pessoa);
          return doPessoa.length ? doPessoa[doPessoa.length - 1] : null;
        }
        return null;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    apartamentos: {
      findUnique: jest.fn().mockResolvedValue({ id: 101, id_condominio: 1 }),
    },
    users: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  const pessoasService = new PessoasService(prisma);
  const visitasService = new VisitasService(prisma, pessoasService);

  const auditoria: any = { registrar: jest.fn() };
  const notifications: any = { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };
  const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
  const facial: any = {
    syncVisitante: jest.fn().mockResolvedValue({}),
    syncPessoa: jest.fn().mockResolvedValue({}),
  };
  const tenant: any = {
    assertCondominio: jest.fn().mockResolvedValue(true),
  };
  const realtime: any = {};

  const service = new VisitantesService(
    prisma,
    notifications,
    storage,
    facial,
    auditoria,
    tenant,
    realtime,
    visitasService,
  );

  return { service, prisma, pessoas, visitas, facial, visitantesDelegate };
}

describe('VisitantesService.novaVisitaParaPessoa — Pessoas/Visitas (Lote B, Critical 2)', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  describe('flag ON', () => {
    beforeEach(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    });

    it('resolve id_pessoa só contra Pessoas e nunca chama o delegate prisma.visitantes', async () => {
      const { service, pessoas, visitas, visitantesDelegate } = buildHarness();
      pessoas.push({
        id: 5,
        id_condominio: 1,
        nome: 'Pessoa A',
        doc_identificacao: '11122233344',
        foto_pessoa: 'https://cdn/a.jpg',
        foto_documento: null,
        tipo_pessoa: 'visitante',
        face_id: 'face-A',
      });

      const payload = { sub: 1, nome: 'Porteiro', id_condominio: 1 } as any;
      const resultado: any = await service.novaVisitaParaPessoa(
        5,
        { id_apartamento: 101, data_hora_inicio: '2026-09-20T12:00', data_hora_termino: '2026-09-21T12:00' },
        payload,
      );

      expect(resultado.nome).toBe('Pessoa A');
      expect(resultado.doc_identificacao).toBe('11122233344');
      const criada = visitas.find((v) => v.id === resultado.id);
      expect(criada.id_pessoa).toBe(5);
      expect(criada.id_condominio).toBe(1);
      expect(visitantesDelegate).not.toHaveBeenCalled();
    });

    it('um id_pessoa que colide com o Visitantes.id de outra pessoa não copia a identidade dela', async () => {
      const { service, pessoas, visitantesDelegate } = buildHarness();
      // A Pessoa de referência tem id=5 em `Pessoas`. Um Visitante legado com
      // o MESMO número (id=5) existe em `Visitantes`, mas pertence a outra
      // pessoa completamente diferente — o bug original copiaria dele.
      pessoas.push({
        id: 5,
        id_condominio: 1,
        nome: 'Pessoa Correta',
        doc_identificacao: '00011122233',
        foto_pessoa: null,
        foto_documento: null,
        tipo_pessoa: 'visitante',
        face_id: null,
      });

      const payload = { sub: 1, nome: 'Porteiro', id_condominio: 1 } as any;
      const resultado: any = await service.novaVisitaParaPessoa(
        5,
        { id_apartamento: 101 },
        payload,
      );

      expect(resultado.nome).toBe('Pessoa Correta');
      expect(resultado.doc_identificacao).toBe('00011122233');
      expect(visitantesDelegate).not.toHaveBeenCalled();
    });

    it('id_pessoa inexistente em Pessoas dá 404, sem cair para Visitantes', async () => {
      const { service, visitantesDelegate } = buildHarness();
      const payload = { sub: 1, nome: 'Porteiro', id_condominio: 1 } as any;

      await expect(
        service.novaVisitaParaPessoa(999, { id_apartamento: 101 }, payload),
      ).rejects.toThrow('Pessoa 999 não encontrada');
      expect(visitantesDelegate).not.toHaveBeenCalled();
    });
  });

  describe('flag OFF (default) — comportamento legado preservado', () => {
    beforeEach(() => {
      delete process.env['PESSOAS_MIGRATION_ENABLED'];
    });

    it('resolve contra Visitantes e delega para create(), sem tocar Pessoas/Visitas', async () => {
      const visitantesFindUnique = jest.fn().mockResolvedValue({
        id: 10,
        id_condominio: 1,
        id_apartamento: 101,
        nome: 'Legado',
        doc_identificacao: null,
        foto_pessoa: null,
        foto_documento: null,
        is_visitante: 1,
        is_prestador: 0,
        dias_semana: null,
        categorias: null,
      });
      const visitantesCreate = jest.fn(async ({ data }: any) => ({ id: 11, ...data }));
      const pessoasDelegate = jest.fn();
      const visitasDelegate = jest.fn();
      const prisma: any = {
        isConnected: true,
        visitantes: {
          findUnique: visitantesFindUnique,
          create: visitantesCreate,
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn(),
          updateMany: jest.fn(),
        },
        pessoas: {
          findUnique: pessoasDelegate,
          findFirst: pessoasDelegate,
          create: pessoasDelegate,
          update: pessoasDelegate,
        },
        visitas: {
          findUnique: visitasDelegate,
          findFirst: visitasDelegate,
          create: visitasDelegate,
          updateMany: visitasDelegate,
        },
        apartamentos: {
          findUnique: jest.fn().mockResolvedValue({ id: 101, id_condominio: 1 }),
        },
        users: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const auditoria: any = { registrar: jest.fn() };
      const notifications: any = { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };
      const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
      const facial: any = { syncVisitante: jest.fn().mockResolvedValue({}) };
      const tenant: any = {
        assertCondominio: jest.fn().mockResolvedValue(true),
        assertPermissaoFuncionario: jest.fn().mockResolvedValue(true),
      };

      const service = new VisitantesService(
        prisma,
        notifications,
        storage,
        facial,
        auditoria,
        tenant,
        {} as any,
        {} as any,
      );

      const payload = { sub: 1, nome: 'Porteiro', id_condominio: 1 } as any;
      await service.novaVisitaParaPessoa(10, { id_apartamento: 101 }, payload);

      expect(visitantesFindUnique).toHaveBeenCalledWith({ where: { id: 10 } });
      expect(visitantesCreate).toHaveBeenCalled();
      expect(pessoasDelegate).not.toHaveBeenCalled();
      expect(visitasDelegate).not.toHaveBeenCalled();
    });
  });
});
