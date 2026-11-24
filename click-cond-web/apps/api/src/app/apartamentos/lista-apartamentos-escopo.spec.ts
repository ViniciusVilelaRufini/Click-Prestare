import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ApartamentosController } from './apartamentos.controller';
import { ApartamentosService } from './apartamentos.service';
import { MobileAuthService } from '../auth/mobile-auth.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

const morador: JwtPayload = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
const sindico: JwtPayload = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico' };
const porteiro: JwtPayload = { sub: 52, nome: 'Porteiro', id_condominio: 1 };

/**
 * A listagem de apartamentos do app devolve, junto de cada unidade, o campo
 * `moradores` com os NOMES de quem mora nela — na prática um diretório de
 * "quem mora onde" do prédio inteiro.
 *
 * É seletor de apartamento das telas de staff: no app, todo chamador faz
 * `if (morador) usa o próprio apto; else carrega a lista`. A restrição existia
 * em cinco telas do Flutter e em nenhum lugar do servidor.
 */
describe('Listagem de apartamentos — exige operador', () => {
  describe('/apartamentos/get-all (app)', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        apartamentos: { findMany: jest.fn(async () => []) },
        apartamentos_Users: { findFirst: jest.fn(async () => ({ id_apto: 7 })) },
        sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
      };
      const tenant = new TenantAccessService(prisma);
      const svc = new MobileAuthService(
        prisma, { sign: jest.fn() } as any, {} as any, {} as any, {} as any, tenant, {} as any, {} as any,
      );
      return { svc, prisma };
    }

    it('NEGA morador — a lista revela quem mora em cada unidade', async () => {
      const { svc, prisma } = build();
      await expect(svc.getAllApartamentos(1, morador)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.apartamentos.findMany).not.toHaveBeenCalled();
    });

    it('PERMITE síndico', async () => {
      const { svc, prisma } = build();
      await svc.getAllApartamentos(1, sindico);
      expect(prisma.apartamentos.findMany).toHaveBeenCalled();
    });

    it('PERMITE porteiro da portaria-web', async () => {
      const { svc, prisma } = build();
      await svc.getAllApartamentos(1, porteiro);
      expect(prisma.apartamentos.findMany).toHaveBeenCalled();
    });
  });

  describe('condominios/:id/apartamentos (console)', () => {
    function build() {
      const service: any = { findAll: jest.fn(async () => []) };
      return { ctrl: new ApartamentosController(service), service };
    }

    it('NEGA morador', () => {
      const { ctrl, service } = build();
      expect(() => ctrl.list(1, morador)).toThrow(ForbiddenException);
      expect(service.findAll).not.toHaveBeenCalled();
    });

    it('PERMITE operador', () => {
      const { ctrl, service } = build();
      ctrl.list(1, porteiro);
      expect(service.findAll).toHaveBeenCalled();
    });
  });
});

/**
 * Havia DUAS implementações da exclusão de apartamento — a do console e a do
 * app — e elas já tinham divergido: a primeira conta o que a cascata leva
 * junto e audita; a segunda apagava calada e respondia "não encontrado" para
 * qualquer falha. O app passa a delegar, então existe uma cópia só.
 */
describe('removeApto do app delega para o ApartamentosService', () => {
  it('usa a implementação única, com contagem da cascata', async () => {
    const apartamentos: any = {
      remove: jest.fn(async () => ({ success: true, arrastados: { visitantes: 7 } })),
    };
    const prisma: any = { isConnected: true };
    const svc = new MobileAuthService(
      prisma, { sign: jest.fn() } as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, apartamentos,
    );

    const r: any = await svc.removeApto(5, sindico);
    expect(apartamentos.remove).toHaveBeenCalledWith(5, sindico);
    expect(r.arrastados.visitantes).toBe(7);
  });
});

/**
 * V3 — o cadastro de unidade pelo app tinha a sua própria cópia do create e
 * não deduplicava: "A"/"Bloco A", "0101"/"101" e bloco NULL × '' passavam
 * pelo @@unique e viravam duas linhas da mesma unidade (quórum inflado; com
 * proprietário numa e inquilino na outra, dois votos). Agora delega ao
 * ApartamentosService, como o removeApto.
 */
describe('saveApto do app delega para o ApartamentosService', () => {
  function montar(existentes: any[] = []) {
    const prisma: any = {
      isConnected: true,
      apartamentos: {
        findMany: jest.fn(async () => existentes),
        findUnique: jest.fn(async () => ({ id: 5, id_condominio: 1, bloco: 'A', apto: '101' })),
        create: jest.fn(async ({ data }: any) => ({ id: 99, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 5, bloco: 'A', apto: '101', ...data })),
      },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
      moradores: { findMany: jest.fn(async () => []), updateMany: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    // Real: é a dedup dele que o app passa a ganhar.
    const apartamentos = new ApartamentosService(prisma, tenant, {} as any);
    jest.spyOn(apartamentos, 'create');
    jest.spyOn(apartamentos, 'update');
    const svc = new MobileAuthService(
      prisma, { sign: jest.fn() } as any, {} as any, {} as any, {} as any,
      tenant, {} as any, apartamentos,
    );
    return { svc, prisma, apartamentos };
  }

  it.each([
    ['Bloco A', '101'],
    ['A', '0101'],
    [' a ', 'Apto 101'],
  ])('recusa %j/%j quando já existe A/101 (sem gravar)', async (bloco, apto) => {
    const { svc, prisma } = montar([{ id: 1, bloco: 'A', apto: '101' }]);
    await expect(
      svc.saveApto({ id_condominio: 1, Apartamento: { bloco, apto } }, false, sindico),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.apartamentos.create).not.toHaveBeenCalled();
  });

  it("bloco '' × NULL é a mesma unidade", async () => {
    const { svc, prisma } = montar([{ id: 1, bloco: null, apto: '7' }]);
    await expect(
      svc.saveApto({ id_condominio: 1, Apartamento: { bloco: '', apto: '7' } }, false, sindico),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.apartamentos.create).not.toHaveBeenCalled();
  });

  it('unidade nova é criada pelo service único, com os campos do app', async () => {
    const { svc, prisma, apartamentos } = montar([{ id: 1, bloco: 'A', apto: '101' }]);
    const r: any = await svc.saveApto(
      { id_condominio: '1', Apartamento: { bloco: 'B', apto: '101', fracao: '0,5', qtd_vagas: '2' } },
      false,
      sindico,
    );
    expect(apartamentos.create).toHaveBeenCalledWith(
      { bloco: 'B', apto: '101', fracao: '0,5', qtd_vagas: '2', id_condominio: 1 },
      sindico,
    );
    expect(prisma.apartamentos.create.mock.calls[0][0].data).toEqual({
      bloco: 'B', apto: '101', fracao: '0,5', qtd_vagas: 2, id_condominio: 1,
    });
    expect(r.id).toBe(99);
  });

  it('edição delega ao update (só os campos enviados)', async () => {
    const { svc, apartamentos } = montar();
    await svc.saveApto({ id_condominio: 1, Apartamento: { id: 5, apto: '102' } }, true, sindico);
    expect(apartamentos.update).toHaveBeenCalledWith(5, { apto: '102' }, sindico);
  });
});
