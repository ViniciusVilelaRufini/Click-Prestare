import { MobileAuthService } from './mobile-auth.service';

/**
 * A lista de condomínios do morador não trazia `apto_tipo`: o app tratava
 * vazio como proprietário e mostrava "Você é o proprietário" + o botão de
 * cadastrar familiar para inquilinos e membros — que o backend recusava.
 */
describe('listCondominiosMorador — apto_tipo', () => {
  it('devolve o tipo do vínculo em Apartamentos_Users', async () => {
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: {
        findMany: jest.fn(async () => [
          {
            tipo: 'inquilino',
            vencimento: null,
            apartamento: {
              id: 7,
              apto: '106',
              bloco: 'A',
              condominio: { id: 1, nome: 'Boa vista', ativo: 1, financeiro: [], num_blocos: 1, num_aptos: 1 },
            },
          },
        ]),
      },
    };
    const svc = Object.create(MobileAuthService.prototype) as any;
    svc.prisma = prisma;
    const [item] = await svc.listCondominiosMorador(41);
    expect(item.apto_tipo).toBe('inquilino');
  });
});
