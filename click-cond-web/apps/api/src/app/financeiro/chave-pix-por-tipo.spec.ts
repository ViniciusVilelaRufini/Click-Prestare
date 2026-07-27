import { FinanceiroService } from './financeiro.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * A chave Pix do condomínio serve para o morador PAGAR o condomínio. Numa conta
 * pessoal (água, luz, internet) que ele mesmo lançou, ela não tem relação com o
 * pagamento — e o app oferecia "Copiar Pix" com a chave do prédio.
 */
describe('FinanceiroService — chave Pix só em cobrança do condomínio', () => {
  const CHAVE = '45346648852';

  // Conta pessoal do morador: tipo 'D' e id_usuario preenchido.
  const contaPessoal = {
    id: 900,
    id_condominio: 1,
    id_usuario: 7,
    nome: 'Conta de Água',
    tipo: 'D',
    valor: 140,
    pago: 0,
    status: '0',
    categoria: 'Água',
    data: new Date('2026-07-27'),
    data_vencimento: new Date('2026-07-27'),
    url_boleto: null,
    url_comprovante: null,
    photo: null,
    linha_digitavel: null,
    pix_copia_cola: null,
  };

  // Cobrança do condomínio: tipo 'C', sem id_usuario, casada pelo apartamento.
  const cobrancaCondominio = {
    ...contaPessoal,
    id: 901,
    id_usuario: null,
    tipo: 'C',
    nome: 'Apto 101 Bloco A - Ref. 07/2026',
    categoria: 'Condomínio',
  };

  function build(lancamentos: any[]) {
    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn(async () => ({ chave_pix: CHAVE })) },
      financeiro: { findMany: jest.fn(async () => lancamentos) },
      moradores: {
        findMany: jest.fn(async () => [
          { bloco: 'A', apartamento: '101', id_condominio: 1 },
        ]),
      },
      apartamentos_Users: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => ({ id_apto: 1 })),
      },
    };
    const noop: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const fechamento: any = { assertPodeAlterar: jest.fn(async () => undefined) };
    const tenant = new TenantAccessService(prisma);
    const svc = new FinanceiroService(
      prisma, storage, noop, noop, noop, fechamento, { generateCharge: jest.fn() } as any, tenant,
    );
    return svc;
  }

  const morador: JwtPayload = { sub: 7, nome: 'Vinicius', typeAccess: 'Morador' };

  it('NÃO envia a chave do condomínio em conta pessoal do morador', async () => {
    const svc = build([contaPessoal]);
    const [item] = await svc.getByUser(7, 1, morador);
    expect(item.nome).toBe('Conta de Água');
    expect(item.chave_pix).toBe('');
  });

  it('envia a chave do condomínio na cobrança do condomínio', async () => {
    const svc = build([cobrancaCondominio]);
    const [item] = await svc.getByUser(7, 1, morador);
    expect(item.tipo).toBe('C');
    expect(item.chave_pix).toBe(CHAVE);
  });

  // O código do boleto/Pix que o próprio morador anexou continua valendo — é
  // dele, diferente da chave do condomínio.
  it('preserva o código que o morador anexou à conta pessoal', async () => {
    const svc = build([
      { ...contaPessoal, pix_copia_cola: '00020126BR-COPIA-E-COLA' },
    ]);
    const [item] = await svc.getByUser(7, 1, morador);
    expect(item.pix_copia_cola).toBe('00020126BR-COPIA-E-COLA');
    expect(item.chave_pix).toBe('');
  });
});
