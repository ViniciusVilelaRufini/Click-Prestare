import { VisitantesService } from './visitantes.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { VisitasService } from '../visitas/visitas.service';

/**
 * Task 4 (fecha a migração Pessoas/Visitas — superfície de escrita): com
 * PESSOAS_MIGRATION_ENABLED='true', `update`/`remove`/`removerPessoa`/
 * `atualizarPessoa` passam a resolver o id recebido contra `Pessoas`/
 * `Visitas` — NUNCA contra `Visitantes`. Resolver ali seria a mesma falha
 * que quebrou a migração original (ler de um lado, escrever no outro), só
 * que um nível abaixo: as duas tabelas nascem do id 1 e crescem em
 * paralelo, então um id "existe" nas duas por coincidência, e apagar/editar
 * pelo id errado atinge a pessoa errada — libera a vaga e desinscreve o
 * rosto de quem nunca pediu nada.
 */
function buildCreateHarness() {
  let pessoasSeq = 1;
  let visitasSeq = 1;
  const pessoas: any[] = [];
  const visitas: any[] = [];

  const prisma: any = {
    isConnected: true,
    visitantes: {
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null), // usado pelo check de colisão de PIN (gerarPinUnicoVisita)
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    pessoas: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.bloqueado === 1) return null;
        return (
          pessoas.find((p) => {
            if (p.id_condominio !== where.id_condominio) return false;
            if (where.doc_identificacao) return p.doc_identificacao === where.doc_identificacao;
            if (where.face_id) return p.face_id === where.face_id;
            return false;
          }) ?? null
        );
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
      findFirst: jest.fn().mockResolvedValue(null), // unicidade de PIN
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const v of visitas) {
          if (where.id_condominio !== undefined && v.id_condominio !== where.id_condominio) continue;
          if (where.id_pessoa !== undefined && v.id_pessoa !== where.id_pessoa) continue;
          if (where.id?.not !== undefined && v.id === where.id.not) continue;
          if (where.data_entrada !== undefined && v.data_entrada !== where.data_entrada) continue;
          if (where.data_saida !== undefined && v.data_saida !== where.data_saida) continue;
          Object.assign(v, data);
          count++;
        }
        return { count };
      }),
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
    assertPermissaoFuncionario: jest.fn().mockResolvedValue(true),
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

  return { service, prisma, pessoas, visitas, facial, auditoria };
}

describe('VisitantesService — superfície de escrita Pessoas/Visitas (Task 4)', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  describe('flag ON', () => {
    beforeEach(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    });

    it('remove() apaga a Visita, solta a vaga por id_visita e nunca chama o delegate prisma.visitantes', async () => {
      const visitasDelete = jest.fn().mockResolvedValue({ id: 42 });
      const vagasUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
      const visitantesDelegate = jest.fn();
      const prisma: any = {
        isConnected: true,
        visitas: {
          findUnique: jest.fn().mockResolvedValue({
            id: 42,
            id_condominio: 1,
            id_apartamento: 101,
            is_prestador: 0,
            id_pessoa: 7,
            pessoa: { id: 7, nome: 'Fulano', doc_identificacao: null, face_id: 'face-7' },
          }),
          delete: visitasDelete,
        },
        vagas: { updateMany: vagasUpdateMany },
        visitantes: {
          findUnique: visitantesDelegate,
          delete: visitantesDelegate,
          findFirst: visitantesDelegate,
          update: visitantesDelegate,
        },
        $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
      };
      const auditoria: any = { registrar: jest.fn() };
      const facial: any = { syncPessoa: jest.fn().mockResolvedValue({}) };
      const tenant: any = { assertCondominio: jest.fn().mockResolvedValue(true) };

      const service = new VisitantesService(
        prisma,
        {} as any,
        {} as any,
        facial,
        auditoria,
        tenant,
        {} as any,
        {} as any,
      );

      const porteiro = { sub: 1, nome: 'Porteiro', id_condominio: 1 };
      const res = await service.remove(42, porteiro as any);

      expect(res).toEqual({ success: true });
      expect(visitasDelete).toHaveBeenCalledWith({ where: { id: 42 } });
      expect(vagasUpdateMany).toHaveBeenCalledWith({
        where: { id_visita: 42 },
        data: { id_visita: null, ativo: 0 },
      });
      // A asserção que prova a correção do Critical: o delegate de
      // Visitantes nunca é sequer chamado — nem para achar, nem para apagar.
      expect(visitantesDelegate).not.toHaveBeenCalled();
      // face_id fica com a Pessoa: reavalia via syncPessoa (que considera as
      // visitas restantes), em vez de desinscrever incondicionalmente.
      expect(facial.syncPessoa).toHaveBeenCalledWith(7);
    });

    /**
     * 2ª rodada da revisão (Critical): `removerPessoa` recebe `id_pessoa`
     * (Pessoas.id) — um espaço de id só, sem tentar `Visitas` primeiro. Uma
     * Pessoa sem visita (id=5) e a Visita de OUTRA pessoa (id=5, coincidência
     * — os dois autoincrement nascem do 1) têm o mesmo número por acaso; o
     * teste prova que o código nunca sequer consulta `Visitas` para resolver
     * esse id, então não há como confundir as duas.
     */
    it('removerPessoa com um id_pessoa que colide com o Visitas.id de outra pessoa apaga só a pessoa certa', async () => {
      const pessoasDelete = jest.fn(async ({ where }: any) => ({ id: where.id }));
      const visitasFindUnique = jest.fn(); // nunca deveria ser chamado
      const prisma: any = {
        isConnected: true,
        pessoas: {
          findUnique: jest.fn(async ({ where }: any) =>
            where.id === 5
              ? { id: 5, id_condominio: 1, nome: 'Pessoa A (sem visita)', face_id: 'face-A' }
              : null,
          ),
          delete: pessoasDelete,
        },
        visitas: {
          // Pessoa B (id_pessoa=99) tem uma Visita cujo id é 5 — o MESMO
          // número que o Pessoas.id da Pessoa A, por coincidência.
          findUnique: visitasFindUnique.mockResolvedValue({
            id: 5,
            id_condominio: 1,
            id_pessoa: 99,
            pessoa: { id: 99, nome: 'Pessoa B (tem a Visita 5)', face_id: 'face-B' },
          }),
          findMany: jest.fn().mockResolvedValue([]), // Pessoa A não tem visitas
        },
        vagas: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
      };
      const auditoria: any = { registrar: jest.fn() };
      const facial: any = { unsyncPessoa: jest.fn().mockResolvedValue(true) };
      const tenant: any = {};

      const service = new VisitantesService(prisma, {} as any, {} as any, facial, auditoria, tenant);

      const res = await service.removerPessoa(1, 5);

      expect(res).toEqual({ ok: true, removidos: 0 });
      // Apagou Pessoa A (Pessoas.id=5) — nunca tentou resolver o id contra
      // Visitas, que teria achado a Visita de Pessoa B.
      expect(visitasFindUnique).not.toHaveBeenCalled();
      expect(pessoasDelete).toHaveBeenCalledWith({ where: { id: 5 } });
      expect(facial.unsyncPessoa).toHaveBeenCalledWith(5, 'face-A', 1);
      // Pessoa B nunca é tocada: nem apagada, nem tem o rosto desinscrito.
      expect(facial.unsyncPessoa).not.toHaveBeenCalledWith(
        expect.anything(),
        'face-B',
        expect.anything(),
      );
    });

    it('registrar a mesma pessoa de novo revoga o PIN/liberação da Visita anterior em aberto', async () => {
      const { service, visitas } = buildCreateHarness();
      const dto = {
        nome: 'Rodrigo Silva',
        doc_identificacao: '11122233344',
        id_apartamento: 101,
        id_condominio: 1,
      };

      const r1: any = await service.create({ ...dto } as any);
      const r2: any = await service.create({ ...dto } as any);

      const v1 = visitas.find((v) => v.id === r1.id);
      const v2 = visitas.find((v) => v.id === r2.id);

      expect(v1.liberado).toBe(0);
      expect(v1.codigo_acesso).toBeNull();
      expect(v2.liberado).toBe(1);
      expect(typeof v2.codigo_acesso).toBe('string');
    });

    it('registrar com o nome corrigido atualiza o nome da Pessoa, e a resposta carrega o novo nome', async () => {
      const { service, pessoas } = buildCreateHarness();
      const doc = '99988877766';

      await service.create({
        nome: 'Vinicius dd',
        doc_identificacao: doc,
        id_apartamento: 101,
        id_condominio: 1,
      } as any);
      const r2: any = await service.create({
        nome: 'Vinicius Vilela',
        doc_identificacao: doc,
        id_apartamento: 101,
        id_condominio: 1,
      } as any);

      expect(pessoas).toHaveLength(1); // mesma pessoa, mesma Pessoa
      expect(pessoas[0].nome).toBe('Vinicius Vilela');
      expect(r2.nome).toBe('Vinicius Vilela');
    });
  });

  describe('flag OFF (default) — os quatro métodos migrados continuam 100% em Visitantes', () => {
    function buildLegacyHarness() {
      const prisma: any = {
        isConnected: true,
        visitantes: {
          findUnique: jest.fn().mockResolvedValue({
            id: 10,
            id_condominio: 1,
            id_apartamento: 101,
            nome: 'Legado',
            doc_identificacao: null,
            face_id: null,
            is_prestador: 0,
          }),
          findMany: jest.fn().mockResolvedValue([
            { id: 10, face_id: null, id_condominio: 1, doc_identificacao: null, nome: 'Legado' },
          ]),
          update: jest.fn().mockResolvedValue({ id: 10, id_condominio: 1, is_prestador: 0, nome: 'Legado' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          delete: jest.fn().mockResolvedValue({ id: 10 }),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        pessoas: {
          findFirst: jest.fn(),
          findMany: jest.fn(),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        visitas: {
          findFirst: jest.fn(),
          findMany: jest.fn(),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn(),
          delete: jest.fn(),
        },
        vagas: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
      };
      const auditoria: any = { registrar: jest.fn() };
      const facial: any = {
        unsyncVisitante: jest.fn().mockResolvedValue(true),
        syncVisitante: jest.fn().mockResolvedValue({}),
      };
      const tenant: any = { assertCondominio: jest.fn().mockResolvedValue(true) };
      const service = new VisitantesService(prisma, {} as any, {} as any, facial, auditoria, tenant);
      return { service, prisma };
    }

    const assertNuncaTocaPessoasEVisitas = (prisma: any) => {
      for (const [name, fn] of Object.entries<any>(prisma.pessoas)) {
        expect(fn).not.toHaveBeenCalled();
      }
      for (const [name, fn] of Object.entries<any>(prisma.visitas)) {
        expect(fn).not.toHaveBeenCalled();
      }
    };

    beforeEach(() => {
      delete process.env['PESSOAS_MIGRATION_ENABLED'];
    });

    it('remove() nunca toca prisma.pessoas/prisma.visitas', async () => {
      const { service, prisma } = buildLegacyHarness();
      await service.remove(10);
      expect(prisma.visitantes.delete).toHaveBeenCalled();
      assertNuncaTocaPessoasEVisitas(prisma);
    });

    it('update() nunca toca prisma.pessoas/prisma.visitas', async () => {
      const { service, prisma } = buildLegacyHarness();
      await service.update({ id: 10, dias_semana: 'seg,ter' } as any);
      expect(prisma.visitantes.update).toHaveBeenCalled();
      assertNuncaTocaPessoasEVisitas(prisma);
    });

    it('removerPessoa() nunca toca prisma.pessoas/prisma.visitas', async () => {
      const { service, prisma } = buildLegacyHarness();
      await service.removerPessoa(1, 10);
      expect(prisma.visitantes.deleteMany).toHaveBeenCalled();
      assertNuncaTocaPessoasEVisitas(prisma);
    });

    it('atualizarPessoa() nunca toca prisma.pessoas/prisma.visitas', async () => {
      const { service, prisma } = buildLegacyHarness();
      await service.atualizarPessoa(1, 10, { nome: 'Legado Atualizado' });
      expect(prisma.visitantes.updateMany).toHaveBeenCalled();
      assertNuncaTocaPessoasEVisitas(prisma);
    });
  });
});
