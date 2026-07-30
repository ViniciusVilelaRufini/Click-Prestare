import { ForbiddenException } from '@nestjs/common';
import { PrestadoresService } from './prestadores.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Quando o morador cadastra um prestador pelo app, o apartamento dele fica
 * FIXO no registro (a tela nem deixa escolher outro). Mas a listagem
 * devolvia todos os prestadores do condomínio: a faxineira do 302 aparecia
 * para o prédio inteiro, com nome, telefone, foto e a unidade que atende.
 *
 * O recorte aqui é o mesmo já aplicado a editar/apagar, e o mesmo princípio
 * do findAllMobile de visitantes: diretório do prédio (sem apartamento) +
 * o que é dos apartamentos do próprio morador.
 */
describe('PrestadoresService — leitura não vaza prestador do vizinho', () => {
  const MEU_APTO = 7;
  const morador: JwtPayload = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
  const porteiro: JwtPayload = { sub: 52, nome: 'Porteiro', id_condominio: 1 };

  function build(prestador?: any) {
    let whereUsado: any = null;
    const prisma: any = {
      isConnected: true,
      prestadores_servico: {
        findMany: jest.fn(async ({ where }: any) => {
          whereUsado = where;
          return [];
        }),
        findUnique: jest.fn(async () => prestador),
      },
      apartamentos_Users: {
        findMany: jest.fn(async ({ where }: any) =>
          where.id_user === 50 ? [{ id_apto: MEU_APTO }] : [],
        ),
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 50 && where.id_apto === MEU_APTO ? { id_apto: MEU_APTO } : null,
        ),
      },
      funcionarios_Portaria: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
    };
    const svc = new PrestadoresService(prisma, {} as any, {} as any, tenant);
    return { svc, whereUsado: () => whereUsado };
  }

  describe('findAll', () => {
    it('morador recebe o diretório do prédio + os do apartamento dele', async () => {
      const { svc, whereUsado } = build();
      await svc.findAll(1, undefined, morador);
      expect(whereUsado().AND).toEqual([
        { OR: [{ id_apartamento: null }, { id_apartamento: { in: [MEU_APTO] } }] },
      ]);
    });

    /**
     * Escopo e busca usam `OR`. Espalhados no mesmo objeto, um sobrescreve o
     * outro — e a busca apagaria o recorte, devolvendo os vizinhos de novo.
     */
    it('buscar não anula o recorte de privacidade', async () => {
      const { svc, whereUsado } = build();
      await svc.findAll(1, 'maria', morador);
      const filtros = whereUsado().AND;
      expect(filtros).toHaveLength(2);
      expect(filtros[0].OR).toContainEqual({ id_apartamento: null });
      expect(filtros[1].OR[0]).toEqual({ nome: { contains: 'maria' } });
    });

    it('portaria continua enxergando o condomínio inteiro', async () => {
      const { svc, whereUsado } = build();
      await svc.findAll(1, undefined, porteiro);
      expect(whereUsado().AND).toBeUndefined();
      expect(whereUsado().id_condominio).toBe(1);
    });
  });

  describe('findOne', () => {
    const doVizinho = { id: 100, id_condominio: 1, id_apartamento: 8, email: null };
    const doPredio = { id: 101, id_condominio: 1, id_apartamento: null, email: null };
    const meu = { id: 102, id_condominio: 1, id_apartamento: MEU_APTO, email: null };

    it('NEGA morador ler prestador do vizinho pelo id', async () => {
      const { svc } = build(doVizinho);
      await expect(svc.findOne(100, 1, morador)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('PERMITE ler prestador do prédio', async () => {
      const { svc } = build(doPredio);
      await expect(svc.findOne(101, 1, morador)).resolves.toBeTruthy();
    });

    it('PERMITE ler prestador do próprio apartamento', async () => {
      const { svc } = build(meu);
      await expect(svc.findOne(102, 1, morador)).resolves.toBeTruthy();
    });

    it('portaria lê qualquer um', async () => {
      const { svc } = build(doVizinho);
      await expect(svc.findOne(100, 1, porteiro)).resolves.toBeTruthy();
    });
  });
});
