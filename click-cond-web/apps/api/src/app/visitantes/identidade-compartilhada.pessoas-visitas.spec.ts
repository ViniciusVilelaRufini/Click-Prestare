import { VisitantesService } from './visitantes.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { VisitasService } from '../visitas/visitas.service';

/**
 * A Pessoa é uma linha só por (condomínio, documento): todas as visitas de
 * todos os apartamentos apontam para ela e para o mesmo rosto no terminal.
 * O morador do apto 100 que cadastrava visita com o documento do visitante
 * do apto 200 trocava nome/foto dessa pessoa e derrubava o PIN da visita do
 * 200 — autoridade de um apartamento agindo sobre outro.
 */
describe('Pessoa compartilhada entre apartamentos — morador não reescreve identidade alheia', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const DOC = '52998224725';
  // Morador 2 só tem o apto 100.
  const moradorA = { sub: 2, nome: 'Morador A', typeAccess: 'Morador' } as any;
  const porteiro = { sub: 3, nome: 'Porteiro', id_condominio: 1 } as any;

  function build(opts: { aptoDaVisitaExistente: number }) {
    let visitasSeq = 60;
    const pessoas: any[] = [
      {
        id: 7,
        id_condominio: 1,
        nome: 'Real',
        doc_identificacao: DOC,
        foto_pessoa: 'F1',
        foto_documento: null,
        face_id: 'face-7',
        tipo_pessoa: 'visitante',
      },
    ];
    const visitas: any[] = [
      {
        id: 50,
        id_pessoa: 7,
        id_condominio: 1,
        id_apartamento: opts.aptoDaVisitaExistente,
        liberado: 1,
        codigo_acesso: '111111',
        data_entrada: null,
        data_saida: null,
        bloqueado: 0,
      },
    ];
    const comRelacoes = (v: any) => ({
      ...v,
      pessoa: pessoas.find((p) => p.id === v.id_pessoa),
      apartamento: { id: v.id_apartamento, bloco: 'A', apto: String(v.id_apartamento) },
    });

    const prisma: any = {
      isConnected: true,
      visitantes: { findFirst: jest.fn(async () => null) }, // unicidade de PIN
      pessoas: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.bloqueado === 1) return null;
          return (
            pessoas.find(
              (p) =>
                p.id_condominio === where.id_condominio &&
                !!where.doc_identificacao &&
                p.doc_identificacao === where.doc_identificacao,
            ) ?? null
          );
        }),
        create: jest.fn(),
        update: jest.fn(async ({ where, data }: any) => {
          const p = pessoas.find((x) => x.id === where.id);
          Object.assign(p, data);
          return p;
        }),
      },
      visitas: {
        findFirst: jest.fn(async () => null), // unicidade de PIN
        findUnique: jest.fn(async ({ where }: any) => {
          const v = visitas.find((x) => x.id === where.id);
          return v ? comRelacoes(v) : null;
        }),
        count: jest.fn(
          async ({ where }: any) =>
            visitas.filter(
              (v) =>
                v.id_pessoa === where.id_pessoa &&
                !(where.id_apartamento?.notIn ?? []).includes(v.id_apartamento),
            ).length,
        ),
        create: jest.fn(async ({ data }: any) => {
          const nova = {
            id: visitasSeq++,
            bloqueado: 0,
            data_entrada: null,
            data_saida: null,
            ...data,
            created_at: new Date('2026-10-20T12:00:00Z'),
            updated_at: new Date('2026-10-20T12:00:00Z'),
          };
          visitas.push(nova);
          return comRelacoes(nova);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const v = visitas.find((x) => x.id === where.id);
          Object.assign(v, data);
          return comRelacoes(v);
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const v of visitas) {
            if (v.id_condominio !== where.id_condominio || v.id_pessoa !== where.id_pessoa) continue;
            if (where.id?.not !== undefined && v.id === where.id.not) continue;
            if (where.id_apartamento?.in && !where.id_apartamento.in.includes(v.id_apartamento)) continue;
            if (v.data_entrada !== null || v.data_saida !== null) continue;
            Object.assign(v, data);
            count++;
          }
          return { count };
        }),
      },
      apartamentos: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: 1 })) },
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 2 && where.id_apto === 100 ? { id_apto: 100 } : null,
        ),
        findMany: jest.fn(async ({ where }: any) => (where.id_user === 2 ? [{ id_apto: 100 }] : [])),
      },
      users: { findMany: jest.fn(async () => []) },
    };

    const pessoasService = new PessoasService(prisma);
    const visitasService = new VisitasService(prisma, pessoasService);
    const facial: any = { syncPessoa: jest.fn().mockResolvedValue({}) };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn(), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const notifications: any = { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };
    const service = new VisitantesService(
      prisma,
      notifications,
      storage,
      facial,
      { registrar: jest.fn() } as any,
      tenant,
      {} as any,
      visitasService,
    );
    return { service, prisma, pessoas, visitas };
  }

  const novaVisita = { nome: 'Z', doc_identificacao: DOC, foto_pessoa: 'F2', id_apartamento: 100, id_condominio: 1 };

  it('morador do 100 não troca nome/foto da Pessoa que tem visita no 200', async () => {
    const { service, prisma, pessoas } = build({ aptoDaVisitaExistente: 200 });
    await service.create({ ...novaVisita } as any, moradorA);
    expect(prisma.pessoas.update).not.toHaveBeenCalled();
    expect(pessoas[0].nome).toBe('Real');
    expect(pessoas[0].foto_pessoa).toBe('F1');
  });

  it('e não revoga o PIN da visita em aberto do outro apartamento', async () => {
    const { service, visitas } = build({ aptoDaVisitaExistente: 200 });
    await service.create({ ...novaVisita } as any, moradorA);
    const doVizinho = visitas.find((v) => v.id === 50);
    expect(doVizinho.liberado).toBe(1);
    expect(doVizinho.codigo_acesso).toBe('111111');
  });

  it('Pessoa só do próprio apartamento: a correção de nome continua valendo e o PIN antigo cai', async () => {
    const { service, pessoas, visitas } = build({ aptoDaVisitaExistente: 100 });
    await service.create({ ...novaVisita } as any, moradorA);
    expect(pessoas[0].nome).toBe('Z');
    const anterior = visitas.find((v) => v.id === 50);
    expect(anterior.liberado).toBe(0);
    expect(anterior.codigo_acesso).toBeNull();
  });

  it('operador continua corrigindo a identidade e revogando o PIN anterior', async () => {
    const { service, pessoas, visitas } = build({ aptoDaVisitaExistente: 200 });
    await service.create({ ...novaVisita } as any, porteiro);
    expect(pessoas[0].nome).toBe('Z');
    expect(visitas.find((v) => v.id === 50).liberado).toBe(0);
  });

  it('update da própria visita não reescreve a Pessoa compartilhada', async () => {
    const { service, prisma, visitas } = build({ aptoDaVisitaExistente: 200 });
    visitas.push({
      id: 61,
      id_pessoa: 7,
      id_condominio: 1,
      id_apartamento: 100,
      liberado: 1,
      codigo_acesso: '222222',
      data_entrada: null,
      data_saida: null,
      bloqueado: 0,
    });
    await service.update({ id: 61, nome: 'Z', foto_pessoa: 'F2' } as any, moradorA);
    expect(prisma.visitas.update).toHaveBeenCalled();
    expect(prisma.pessoas.update).not.toHaveBeenCalled();
  });
});
