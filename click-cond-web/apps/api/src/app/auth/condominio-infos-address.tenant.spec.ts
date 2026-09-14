import { ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

/**
 * Irmãs esquecidas do `get-condominio`.
 *
 * `GET /condominio/infos/get` e `GET /condominio/address/get` eram as duas
 * únicas rotas do CondominioMobileController sem @ReqUser. Sem payload, o
 * `assertCondominio` passa direto (`if (!payload) return`) e o service ia
 * de findUnique no id cru da query. Qualquer usuário autenticado lia nome,
 * CNPJ (`identificacao`), nome e mandato do subsíndico, foto e o endereço
 * completo de QUALQUER condomínio da plataforma — bastava incrementar o id.
 *
 * O `get-condominio` ao lado já tinha sido corrigido (ver
 * get-condominio.tenant.spec.ts); estas duas passaram batido.
 */
describe('getInfosCondominio / getAddressCondominio — isolamento por condomínio', () => {
  function build() {
    const tenant = {
      assertCondominio: jest.fn(async (id: number, payload: any) => {
        // Espelha o comportamento real: só passa no condomínio a que o usuário pertence.
        if (!payload) return;
        if (payload.condominioPermitido !== id) {
          throw new ForbiddenException('Acesso negado: você não pertence a este condomínio.');
        }
      }),
    };
    const prisma: any = {
      isConnected: true,
      condominios: {
        findUnique: jest.fn(async () => ({
          nome: 'Condomínio do Vizinho',
          identificacao: '99.999.999/0001-99',
          subsindico_nome: 'Subsíndico do Vizinho',
          photo: '',
          data_inicio_mandato: null,
          data_termino_mandato: null,
          enderecoRel: { cep: '01001-000', cidade: 'São Paulo', uf: 'SP', rua: 'Praça da Sé', numero: '100' },
        })),
      },
    };

    const service = new MobileAuthService(
      prisma,
      {} as any, // jwt
      {} as any, // mail
      {} as any, // storage
      {} as any, // facial
      tenant as any,
      {} as any, // financeiro
    );
    return { service, tenant, prisma };
  }

  const forasteiro: any = { sub: 42, nome: 'Morador do cond 1', typeAccess: 'Morador', condominioPermitido: 1 };
  const dono: any = { sub: 7, nome: 'Síndico do cond 2', typeAccess: 'Sindico', condominioPermitido: 2 };

  describe('infos/get', () => {
    it('NEGA usuário de outro condomínio', async () => {
      const { service } = build();
      await expect(service.getInfosCondominio(2, forasteiro)).rejects.toThrow(ForbiddenException);
    });

    it('não consulta o banco quando o acesso é negado', async () => {
      const { service, prisma } = build();
      await expect(service.getInfosCondominio(2, forasteiro)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.condominios.findUnique).not.toHaveBeenCalled();
    });

    it('PERMITE quem pertence ao condomínio', async () => {
      const { service } = build();
      const r = await service.getInfosCondominio(2, dono);
      expect(r?.identificacao).toBe('99.999.999/0001-99');
    });

    /**
     * O modo demo (banco fora) devolve um condomínio fictício. Se o assert
     * ficasse depois dele, a rota continuaria respondendo 200 para forasteiro
     * sempre que o banco caísse.
     */
    it('valida o acesso antes do fallback de banco indisponível', async () => {
      const { service, prisma } = build();
      prisma.isConnected = false;
      await expect(service.getInfosCondominio(2, forasteiro)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('address/get', () => {
    it('NEGA usuário de outro condomínio', async () => {
      const { service } = build();
      await expect(service.getAddressCondominio(2, forasteiro)).rejects.toThrow(ForbiddenException);
    });

    it('não consulta o banco quando o acesso é negado', async () => {
      const { service, prisma } = build();
      await expect(service.getAddressCondominio(2, forasteiro)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.condominios.findUnique).not.toHaveBeenCalled();
    });

    it('PERMITE quem pertence ao condomínio', async () => {
      const { service } = build();
      const r = await service.getAddressCondominio(2, dono);
      expect(r?.cidade).toBe('São Paulo');
    });

    it('valida o acesso antes do fallback de banco indisponível', async () => {
      const { service, prisma } = build();
      prisma.isConnected = false;
      await expect(service.getAddressCondominio(2, forasteiro)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
