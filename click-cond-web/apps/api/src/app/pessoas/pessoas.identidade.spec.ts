import { PessoasService } from './pessoas.service';

describe('PessoasService.obterOuCriar — fusão de identidade', () => {
  function build(existentes: any[] = []) {
    const criados: any[] = [];
    const prisma: any = {
      pessoas: {
        findFirst: jest.fn(async ({ where }: any) => {
          return (
            existentes.find((p) => {
              if (p.id_condominio !== where.id_condominio) return false;
              if (where.doc_identificacao) return p.doc_identificacao === where.doc_identificacao;
              if (where.face_id) return p.face_id === where.face_id;
              return false;
            }) ?? null
          );
        }),
        create: jest.fn(async ({ data }: any) => {
          const novo = { id: 100 + criados.length, ...data };
          criados.push(novo);
          return novo;
        }),
        update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
    };
    return { svc: new PessoasService(prisma), prisma, criados };
  }

  it('reaproveita a pessoa quando o face_id bate, mesmo sem documento', async () => {
    const existente = { id: 7, id_condominio: 1, nome: 'Rodrigo', doc_identificacao: null, face_id: 'face-abc' };
    const { svc, prisma } = build([existente]);

    const r = await svc.obterOuCriar(1, { nome: 'Rodrigo Silva', face_id: 'face-abc' } as any);

    expect(r.id).toBe(7);
    expect(prisma.pessoas.create).not.toHaveBeenCalled();
  });

  it('cria pessoa nova quando não há documento nem face_id que batam', async () => {
    const { svc, prisma } = build([]);

    await svc.obterOuCriar(1, { nome: 'Alguém Novo' } as any);

    expect(prisma.pessoas.create).toHaveBeenCalledTimes(1);
  });

  it('o documento continua tendo precedência sobre o face_id', async () => {
    const porDoc = { id: 3, id_condominio: 1, nome: 'Ana', doc_identificacao: '11122233344', face_id: 'face-ana' };
    const porFace = { id: 9, id_condominio: 1, nome: 'Outro', doc_identificacao: null, face_id: 'face-x' };
    const { svc } = build([porDoc, porFace]);

    const r = await svc.obterOuCriar(1, {
      nome: 'Ana',
      doc_identificacao: '111.222.333-44',
      face_id: 'face-x',
    } as any);

    expect(r.id).toBe(3);
  });
});
