import { BadRequestException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';
import { StorageService } from '../common/storage/storage.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { VisitasService } from '../visitas/visitas.service';

/**
 * Foto e documento de visitante vêm do cliente. A API assina toda URL do
 * bucket que devolve, então aceitar uma URL do bucket qualquer era renovar
 * para sempre o link de um arquivo alheio. Só passam: data URL nova, a mesma
 * chave já gravada naquela pessoa, ou vazio.
 *
 * "Naquela pessoa" inclui o reaproveitamento que o app e a portaria já fazem:
 * o app reenvia a foto da visita anterior (`id_anterior`) e a portaria a da
 * pessoa achada pelo documento. Só vale o que o próprio servidor deixaria
 * herdar — morador não reaproveita a foto do visitante do vizinho.
 */
describe('visitantes — arquivos recebidos do cliente', () => {
  const BUCKET = 'prestare-arquivos-teste';
  const BASE = `https://${BUCKET}.s3.sa-east-1.amazonaws.com`;
  const FOTO_PROPRIA = `${BASE}/visitantes/1700000000000-propria.jpg`;
  const FOTO_VIZINHO = `${BASE}/visitantes/1700000000000-vizinho.jpg`;
  const ALHEIA = `${BASE}/moradores/1700000000000-alheia.jpg`;
  const FOTO_CONVITE = `${BASE}/convites/1700000000000-convite.jpg`;
  const DOC = '52998224725';
  const moradorA = { sub: 2, nome: 'Morador A', typeAccess: 'Morador' } as any;
  const porteiro = { sub: 3, nome: 'Porteiro', id_condominio: 1 } as any;
  const ambienteOriginal = { ...process.env };

  function storageReal() {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXEMPLOEXEMPLO00';
    process.env.AWS_SECRET_ACCESS_KEY = 'segredo-de-teste-que-nao-existe-na-aws';
    process.env.AWS_S3_BUCKET_NAME = BUCKET;
    process.env.AWS_S3_BASE_URL = BASE;
    process.env.AWS_S3_BUCKET_REGION = 'sa-east-1';
    for (const k of ['R2_ACCESS_KEY_ID', 'R2_BUCKET', 'R2_PUBLIC_URL', 'R2_ENDPOINT']) delete process.env[k];
    const storage = new StorageService();
    jest.spyOn(storage, 'uploadDataUrl').mockResolvedValue(`${BASE}/visitantes/1800000000000-nova.jpg`);
    return storage;
  }

  afterEach(() => {
    process.env = { ...ambienteOriginal };
    jest.restoreAllMocks();
  });

  async function arquivoInvalido(p: Promise<unknown>) {
    const erro: any = await p.catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toBe('Arquivo inválido.');
  }

  const tenant: any = {
    assertCondominio: jest.fn(async () => undefined),
    assertPermissaoFuncionario: jest.fn(async () => undefined),
  };
  const notifications: any = { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };

  describe('caminho legado (Visitantes)', () => {
    beforeEach(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    });

    function casa(row: any, where: any): boolean {
      if (where.id_condominio !== undefined && row.id_condominio !== where.id_condominio) return false;
      if (where.id_apartamento?.in && !where.id_apartamento.in.includes(row.id_apartamento)) return false;
      if (where.doc_identificacao !== undefined && row.doc_identificacao !== where.doc_identificacao) return false;
      if (where.nome !== undefined && row.nome !== where.nome) return false;
      if (where.codigo_acesso !== undefined && row.codigo_acesso !== where.codigo_acesso) return false;
      if (where.bloqueado !== undefined && row.bloqueado !== where.bloqueado) return false;
      if (where.data_entrada === null && row.data_entrada !== null) return false;
      if (where.data_saida === null && row.data_saida !== null) return false;
      if (where.OR && !where.OR.some((o: any) => casa(row, o))) return false;
      if (where.id !== undefined && typeof where.id === 'number' && row.id !== where.id) return false;
      if (where.id?.in && !where.id.in.includes(row.id)) return false;
      return true;
    }

    function build() {
      const base = {
        id_condominio: 1, doc_identificacao: DOC, foto_documento: null, face_id: null, face_sync_status: null,
        face_enrolled_at: null, codigo_acesso: null, liberado: 1, user: 99, is_visitante: 1, is_prestador: 0,
        bloqueado: 0, created_at: new Date('2026-10-01T00:00:00Z'),
      };
      // Visita já encerrada do próprio apartamento (a que o app reaproveita) e
      // a do vizinho, com o mesmo documento.
      const propria: any = {
        ...base, id: 6, id_apartamento: 100, nome: 'Ana', foto_pessoa: FOTO_PROPRIA,
        data_entrada: new Date('2026-10-01T10:00:00Z'), data_saida: new Date('2026-10-01T12:00:00Z'),
      };
      const vizinho: any = {
        ...base, id: 5, id_apartamento: 200, nome: 'Ana', foto_pessoa: FOTO_VIZINHO,
        data_entrada: new Date('2026-10-01T10:00:00Z'), data_saida: new Date('2026-10-01T12:00:00Z'),
      };
      const rows: any[] = [propria, vizinho];
      let seq = 100;
      const prisma: any = {
        isConnected: true,
        visitantes: {
          findMany: jest.fn(async ({ where, orderBy, take }: any) => {
            let achados = rows.filter((r) => casa(r, where));
            if (orderBy?.created_at === 'desc') {
              achados = [...achados].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
            }
            if (take) achados = achados.slice(0, take);
            return achados.map((r) => ({ ...r, apartamento: { bloco: 'A', apto: String(r.id_apartamento) } }));
          }),
          findFirst: jest.fn(async ({ where }: any) => rows.find((r) => casa(r, where)) ?? null),
          findUnique: jest.fn(async ({ where }: any) => {
            const r = rows.find((x) => x.id === where.id);
            return r ? { ...r, apartamento: { bloco: 'A', apto: String(r.id_apartamento) } } : null;
          }),
          update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
          updateMany: jest.fn(async () => ({ count: 1 })),
          create: jest.fn(async ({ data }: any) => {
            const nova = { id: seq++, data_entrada: null, data_saida: null, bloqueado: 0, created_at: new Date(), ...data };
            rows.push(nova);
            return nova;
          }),
        },
        apartamentos: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: 1 })) },
        apartamentos_Users: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 2 && where.id_apto === 100 ? { id_apto: 100 } : null,
          ),
          findMany: jest.fn(async ({ where }: any) => (where.id_user === 2 ? [{ id_apto: 100 }] : [])),
        },
        users: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => ({ id: 2, name: 'Morador A' })) },
      };
      const facial: any = { syncVisitante: jest.fn().mockResolvedValue({}) };
      const service = new VisitantesService(
        prisma, notifications, storageReal(), facial, { registrar: jest.fn() } as any, tenant, {} as any, undefined as any,
      );
      return { service, prisma, rows };
    }

    const visita = (extra: any) => ({ nome: 'Ana', doc_identificacao: DOC, id_apartamento: 100, id_condominio: 1, ...extra });

    it('criar com URL do bucket que não é de nenhuma visita da pessoa: 400, nada criado', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.create(visita({ foto_pessoa: ALHEIA }) as any, moradorA));
      expect(prisma.visitantes.create).not.toHaveBeenCalled();
      expect(prisma.visitantes.update).not.toHaveBeenCalled();
    });

    it('app reaproveita a visita anterior (id_anterior) reenviando a foto dela: aceito', async () => {
      const { service, prisma } = build();
      await service.create(visita({ foto_pessoa: FOTO_PROPRIA, id_anterior: 6, nome_anterior: 'Ana' }) as any, moradorA);
      expect(prisma.visitantes.create.mock.calls[0][0].data.foto_pessoa).toBe(FOTO_PROPRIA);
    });

    it('morador não reaproveita a foto do visitante do vizinho (id_anterior de outro apartamento)', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(
        service.create(visita({ foto_pessoa: FOTO_VIZINHO, id_anterior: 5, nome_anterior: 'Ana' }) as any, moradorA),
      );
      expect(prisma.visitantes.create).not.toHaveBeenCalled();
    });

    it('portaria reaproveita a foto da pessoa achada pelo documento: aceito', async () => {
      const { service, prisma } = build();
      await service.create(visita({ foto_pessoa: FOTO_VIZINHO }) as any, porteiro);
      expect(prisma.visitantes.create.mock.calls[0][0].data.foto_pessoa).toBe(FOTO_VIZINHO);
    });

    it('convite: a foto que o próprio servidor guardou no convite segue valendo', async () => {
      const { service, prisma } = build();
      await service.create(
        visita({ doc_identificacao: '11144477735', nome: 'Convidado', foto_pessoa: FOTO_CONVITE }) as any,
        moradorA,
        { arquivosDoServidor: true },
      );
      expect(prisma.visitantes.create.mock.calls[0][0].data.foto_pessoa).toBe(FOTO_CONVITE);
    });

    it('nova visita para pessoa (portaria): as fotos copiadas pelo servidor do registro de referência passam', async () => {
      const { service, prisma, rows } = build();
      // Mais de 20 registros mais novos da mesma pessoa, sem a foto da referência.
      for (let i = 0; i < 21; i++) {
        rows.push({
          ...rows[0], id: 200 + i, foto_pessoa: null, created_at: new Date(`2026-10-${10 + (i % 15)}T00:00:00Z`),
        });
      }
      await service.novaVisitaParaPessoa(6, { id_apartamento: 100 }, porteiro);
      expect(prisma.visitantes.create.mock.calls[0][0].data.foto_pessoa).toBe(FOTO_PROPRIA);
    });

    it('editar a visita com URL de outro registro: 400; com a foto dela: aceito', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.update({ id: 6, foto_pessoa: ALHEIA } as any, moradorA));
      expect(prisma.visitantes.update).not.toHaveBeenCalled();
      await service.update({ id: 6, foto_pessoa: FOTO_PROPRIA } as any, moradorA);
      expect(prisma.visitantes.update.mock.calls[0][0].data.foto_pessoa).toBe(FOTO_PROPRIA);
    });

    it('editar a pessoa (portaria) com URL de outro registro: 400; com a foto dela: aceito', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.atualizarPessoa(1, 6, { foto_pessoa: ALHEIA } as any, porteiro));
      expect(prisma.visitantes.updateMany).not.toHaveBeenCalled();
      await service.atualizarPessoa(1, 6, { foto_pessoa: FOTO_PROPRIA } as any, porteiro);
      expect(prisma.visitantes.updateMany.mock.calls[0][0].data.foto_pessoa).toBe(FOTO_PROPRIA);
    });
  });

  describe('caminho novo (Pessoas/Visitas)', () => {
    beforeEach(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    });

    function build() {
      const pessoas: any[] = [
        { id: 1, id_condominio: 1, nome: 'Ana', doc_identificacao: DOC, foto_pessoa: FOTO_PROPRIA, foto_documento: null, bloqueado: 0 },
      ];
      const visitas: any[] = [
        { id: 10, id_pessoa: 1, id_condominio: 1, id_apartamento: 100, bloqueado: 0, data_entrada: null },
      ];
      let pessoasSeq = 2;
      let visitasSeq = 11;
      const prisma: any = {
        isConnected: true,
        visitantes: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        pessoas: {
          findFirst: jest.fn(async ({ where }: any) => {
            if (where.bloqueado === 1) return null;
            return (
              pessoas.find((p) => {
                if (p.id_condominio !== where.id_condominio) return false;
                if (where.id !== undefined) return p.id === where.id;
                if (where.doc_identificacao) return p.doc_identificacao === where.doc_identificacao;
                return false;
              }) ?? null
            );
          }),
          findUnique: jest.fn(async ({ where }: any) => pessoas.find((p) => p.id === where.id) ?? null),
          create: jest.fn(async ({ data }: any) => {
            const novo = { id: pessoasSeq++, ...data };
            pessoas.push(novo);
            return novo;
          }),
          update: jest.fn(async ({ where, data }: any) => Object.assign(pessoas.find((x) => x.id === where.id), data)),
        },
        visitas: {
          create: jest.fn(async ({ data }: any) => {
            const nova = { id: visitasSeq++, bloqueado: 0, ...data, created_at: new Date(), updated_at: new Date() };
            visitas.push(nova);
            return { ...nova, pessoa: pessoas.find((p) => p.id === nova.id_pessoa), apartamento: { id: nova.id_apartamento, bloco: 'A', apto: '100' } };
          }),
          findFirst: jest.fn(async ({ where }: any) => {
            if (where.codigo_acesso !== undefined) return null; // PIN nunca colide
            const v = visitas.find(
              (x) =>
                (where.id === undefined || x.id === where.id) &&
                (where.id_condominio === undefined || x.id_condominio === where.id_condominio) &&
                (!where.id_apartamento?.in || where.id_apartamento.in.includes(x.id_apartamento)),
            );
            return v ? { ...v, pessoa: pessoas.find((p) => p.id === v.id_pessoa) } : null;
          }),
          findUnique: jest.fn(async ({ where }: any) => {
            const v = visitas.find((x) => x.id === where.id);
            return v ? { ...v, pessoa: pessoas.find((p) => p.id === v.id_pessoa) } : null;
          }),
          findMany: jest.fn(async () => []),
          count: jest.fn(async () => 0),
          update: jest.fn(async ({ where, data }: any) => Object.assign(visitas.find((x) => x.id === where.id), data)),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        apartamentos: { findUnique: jest.fn().mockResolvedValue({ id: 100, id_condominio: 1 }) },
        apartamentos_Users: {
          findFirst: jest.fn(async ({ where }: any) => (where.id_user === 2 && where.id_apto === 100 ? { id_apto: 100 } : null)),
          findMany: jest.fn(async ({ where }: any) => (where.id_user === 2 ? [{ id_apto: 100 }] : [])),
        },
        users: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
      };
      const pessoasService = new PessoasService(prisma);
      const visitasService = new VisitasService(prisma, pessoasService);
      const facial: any = { syncVisitante: jest.fn().mockResolvedValue({}), syncPessoa: jest.fn().mockResolvedValue({}) };
      const service = new VisitantesService(
        prisma, notifications, storageReal(), facial, { registrar: jest.fn() } as any, tenant, {} as any, visitasService,
      );
      return { service, prisma, pessoas };
    }

    const visita = (extra: any) => ({ nome: 'Ana', doc_identificacao: DOC, id_apartamento: 100, id_condominio: 1, ...extra });

    it('criar com URL do bucket alheia: 400, nada criado', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.create(visita({ doc_identificacao: '11144477735', foto_pessoa: ALHEIA }) as any, moradorA));
      expect(prisma.pessoas.create).not.toHaveBeenCalled();
      expect(prisma.visitas.create).not.toHaveBeenCalled();
    });

    it('app reaproveita a visita anterior (id_anterior) reenviando a foto da pessoa: aceito', async () => {
      const { service, prisma } = build();
      await service.create(visita({ foto_pessoa: FOTO_PROPRIA, id_anterior: 10 }) as any, moradorA);
      expect(prisma.visitas.create).toHaveBeenCalled();
    });

    it('editar a visita com URL de outro registro: 400', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.update({ id: 10, foto_pessoa: ALHEIA } as any, moradorA));
      expect(prisma.pessoas.update).not.toHaveBeenCalled();
    });

    it('editar a pessoa (portaria) com URL de outro registro: 400; com a foto dela: aceito', async () => {
      const { service, prisma, pessoas } = build();
      await arquivoInvalido(service.atualizarPessoa(1, 1, { foto_pessoa: ALHEIA } as any, porteiro));
      expect(prisma.pessoas.update).not.toHaveBeenCalled();
      await service.atualizarPessoa(1, 1, { foto_pessoa: FOTO_PROPRIA, nome: 'Ana Maria' } as any, porteiro);
      expect(pessoas[0].foto_pessoa).toBe(FOTO_PROPRIA);
    });
  });
});
