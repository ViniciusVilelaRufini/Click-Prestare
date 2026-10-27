import { ForbiddenException } from '@nestjs/common';
import { PrestadoresService } from './prestadores.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * `create` faz upsert por nome: com o mesmo nome de um prestador existente,
 * ele ATUALIZA foto, unidade e dias. O update exige ser dono (prestador do
 * prédio é da administração; o do vizinho, do vizinho), mas o ramo de update
 * do create não exigia — bastava repetir o nome do eletricista do prédio,
 * que todo morador vê na lista, para trocar a foto facial dele pela sua.
 */
describe('PrestadoresService.create — upsert por nome respeita o dono', () => {
  const MEU_APTO = 7;
  const morador: JwtPayload = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico' };

  const doPredio = { id: 101, id_condominio: 1, id_apartamento: null, nome: 'Eletricista do prédio', telefone: '8888', email: null, categorias: null, foto_pessoa: 'https://s3/predio.jpg', foto_documento: null, dias_semana: 'seg' };
  const doVizinho = { ...doPredio, id: 100, id_apartamento: 8, nome: 'Faxineira do 8', foto_pessoa: 'https://s3/vizinho.jpg' };
  const meu = { ...doPredio, id: 102, id_apartamento: MEU_APTO, nome: 'Meu pintor', foto_pessoa: 'https://s3/meu.jpg' };

  function build(existente: any) {
    const prisma: any = {
      isConnected: true,
      prestadores_servico: {
        findFirst: jest.fn(async () => existente),
        update: jest.fn(async ({ data }: any) => ({ ...existente, ...data })),
        create: jest.fn(async ({ data }: any) => ({ id: 999, ...data })),
      },
      // Os aptos 7 e 8 são do condomínio 1 (usado pela checagem de unidade da D2).
      apartamentos: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: 1 })) },
      // O morador 50 mora só no apto 7.
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 50 && where.id_apto === MEU_APTO ? { id_apto: MEU_APTO } : null,
        ),
      },
    };
    const storage: any = { isDataUrl: (v: string) => v.startsWith('data:'), uploadDataUrl: jest.fn(async () => 'https://s3/atacante.jpg') };
    const facial: any = { syncPrestadorServico: jest.fn(async () => undefined) };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    return { svc: new PrestadoresService(prisma, storage, facial, tenant), prisma, storage, facial };
  }

  const dto = (nome: string) => ({
    nome,
    id_condominio: 1,
    id_apartamento: MEU_APTO,
    foto_pessoa: 'data:image/jpeg;base64,AAA',
    dias_semana: 'seg,ter,qua,qui,sex,sab,dom',
  });

  it('NEGA morador sobrescrever o prestador do prédio repetindo o nome (nem sobe a foto)', async () => {
    const { svc, prisma, storage, facial } = build(doPredio);
    await expect(svc.create(dto('Eletricista do prédio'), morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    expect(storage.uploadDataUrl).not.toHaveBeenCalled();
    expect(facial.syncPrestadorServico).not.toHaveBeenCalled();
  });

  it('NEGA morador sobrescrever o prestador do vizinho repetindo o nome', async () => {
    const { svc, prisma } = build(doVizinho);
    await expect(svc.create(dto('Faxineira do 8'), morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
  });

  it('PERMITE morador atualizar pelo nome o prestador do próprio apartamento', async () => {
    const { svc, prisma } = build(meu);
    await svc.create(dto('Meu pintor'), morador);
    expect(prisma.prestadores_servico.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 102 } }),
    );
  });

  it('PERMITE o síndico atualizar pelo nome o prestador do prédio', async () => {
    const { svc, prisma } = build(doPredio);
    await svc.create({ ...dto('Eletricista do prédio'), id_apartamento: undefined } as any, sindico);
    expect(prisma.prestadores_servico.update).toHaveBeenCalled();
  });
});
