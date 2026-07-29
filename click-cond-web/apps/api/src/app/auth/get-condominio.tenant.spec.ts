import { ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

/**
 * `GET /condominio/get-condominio?id_condominio=X` alimenta o card do dashboard
 * do app: nome, endereço, CNPJ, subsíndico e o SALDO financeiro do condomínio.
 *
 * O controller não recebia @ReqUser, então o service era chamado sem payload —
 * e o assertCondominio começa com `if (!payload) return`. Resultado: qualquer
 * usuário logado (morador, síndico ou funcionário de OUTRO condomínio) trocava
 * o id na query e recebia esses dados. Como o id é sequencial, dava para varrer
 * 1, 2, 3... e ler o financeiro de todos os condomínios da plataforma.
 */
describe('getCondominioById — isolamento por condomínio', () => {
  function build() {
    const tenant = {
      assertCondominio: jest.fn(async (id: number, payload: any) => {
        // Espelha o comportamento real: síndico só passa no condomínio que administra.
        if (!payload) return;
        if (payload.condominioPermitido !== id) {
          throw new ForbiddenException('Acesso negado: você não administra este condomínio.');
        }
      }),
    };
    const financeiro = { getAll: jest.fn(async () => ({ saldo: 'R$ 1.000,00' })) };
    const prisma: any = {
      isConnected: true,
      condominios: {
        findUnique: jest.fn(async () => ({
          id: 2,
          nome: 'Condomínio do Vizinho',
          identificacao: '99.999.999/0001-99',
          apartamentos: [],
          enderecoRel: { cidade: 'São Paulo', uf: 'SP' },
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
      financeiro as any,
    );
    return { service, tenant, financeiro, prisma };
  }

  const forasteiro: any = { sub: 42, nome: 'Síndico do cond 1', typeAccess: 'Sindico', condominioPermitido: 1 };
  const dono: any = { sub: 7, nome: 'Síndico do cond 2', typeAccess: 'Sindico', condominioPermitido: 2 };

  it('NEGA usuário de outro condomínio', async () => {
    const { service } = build();
    await expect(service.getCondominioById(2, forasteiro)).rejects.toThrow(ForbiddenException);
  });

  /**
   * O catch do método devolve um condomínio fictício em qualquer erro. Se o
   * assert ficasse DENTRO do try, o 403 virava 200 com dado falso — o app
   * mostraria um card inventado em vez do bloqueio.
   */
  it('não transforma o bloqueio em resposta de sucesso', async () => {
    const { service, financeiro } = build();
    await expect(service.getCondominioById(2, forasteiro)).rejects.toBeInstanceOf(ForbiddenException);
    // E não chega a consultar o financeiro do condomínio alheio.
    expect(financeiro.getAll).not.toHaveBeenCalled();
  });

  it('PERMITE o síndico do próprio condomínio', async () => {
    const { service, financeiro } = build();
    const r = await service.getCondominioById(2, dono);
    expect(r.nome).toBe('Condomínio do Vizinho');
    expect(financeiro.getAll).toHaveBeenCalled();
  });

  it('repassa o usuário ao financeiro (revalidação do saldo)', async () => {
    const { service, financeiro } = build();
    await service.getCondominioById(2, dono);
    // getAll(id, mes, ano, isSindico, user) — o user precisa chegar no 5º argumento.
    expect(financeiro.getAll).toHaveBeenCalledWith(2, undefined, undefined, true, dono);
  });
});
