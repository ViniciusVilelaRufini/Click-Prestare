import { ForbiddenException } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';
import { FinanceiroService } from './financeiro.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * As MUTAÇÕES do financeiro passaram pela auditoria de julho/2026 e ganharam
 * `assertStaff`. As LEITURAS ficaram de fora — e `assertCondominio` (única
 * checagem que restava nelas) só confirma vínculo com o condomínio, que
 * morador tem. Na prática, qualquer morador autenticado do prédio baixava o
 * livro caixa completo em CSV, abria o relatório gráfico e lia a chave PIX e a
 * régua de cobrança.
 *
 * Nenhuma dessas rotas é consumida por tela de morador: no app,
 * `getUserType() == 'morador'` manda para o MoradorFinanceiroView, que só
 * chama `get-all` — a única leitura que segue aberta ao morador, com recorte.
 */
describe('FinanceiroController — leituras administrativas exigem staff', () => {
  function buildController() {
    const service: any = {
      exportLivroCaixaCsv: jest.fn(),
      getGrafico: jest.fn(),
      getConfigAuto: jest.fn(),
      getApartamentosConfig: jest.fn(),
    };
    const fechamento: any = { listar: jest.fn() };
    return { controller: new FinanceiroController(service, fechamento), service, fechamento };
  }

  const morador: JwtPayload = { sub: 5, nome: 'Morador X', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico' };

  it('export-csv: bloqueia morador antes de tocar no service', async () => {
    const { controller, service } = buildController();
    await expect(
      controller.exportCsv('1', {} as any, morador, '8', '2026', 'true'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.exportLivroCaixaCsv).not.toHaveBeenCalled();
  });

  it('grafico: bloqueia morador', () => {
    const { controller, service } = buildController();
    expect(() => controller.getGrafico('1', '8', '2026', morador)).toThrow(ForbiddenException);
    expect(service.getGrafico).not.toHaveBeenCalled();
  });

  it('config-auto: bloqueia morador (chave PIX e régua de cobrança)', () => {
    const { controller, service } = buildController();
    expect(() => controller.getConfigAuto('1', morador)).toThrow(ForbiddenException);
    expect(service.getConfigAuto).not.toHaveBeenCalled();
  });

  it('apartamentos-config: bloqueia morador', () => {
    const { controller, service } = buildController();
    expect(() => controller.getApartamentosConfig('1', morador)).toThrow(ForbiddenException);
    expect(service.getApartamentosConfig).not.toHaveBeenCalled();
  });

  it('fechamentos: bloqueia morador', () => {
    const { controller, fechamento } = buildController();
    expect(() => controller.listarFechamentos('1', morador)).toThrow(ForbiddenException);
    expect(fechamento.listar).not.toHaveBeenCalled();
  });

  it('síndico continua passando em todas', () => {
    const { controller } = buildController();
    expect(() => controller.getGrafico('1', '8', '2026', sindico)).not.toThrow();
    expect(() => controller.getConfigAuto('1', sindico)).not.toThrow();
    expect(() => controller.getApartamentosConfig('1', sindico)).not.toThrow();
    expect(() => controller.listarFechamentos('1', sindico)).not.toThrow();
  });
});

/**
 * `get-all` é a exceção: morador consome de verdade (livro caixa do prédio no
 * app, recortado em `pago = 1`). O buraco era `incluirTaxasCondominiais`
 * chegar pela query string — ligando a flag, o morador reincluía as cobranças
 * apto a apto e via quanto cada vizinho pagou e quando.
 */
describe('FinanceiroService.getAll — a query não amplia o que o papel permite', () => {
  const taxaDoVizinho = {
    id: 1, id_condominio: 1, nome: 'Apto 101 Bloco A - Taxa Condominial Ref. 08/2026',
    tipo: 'C', valor: 732.6, pago: 1, status: '1', id_usuario: null,
    data: new Date(2026, 7, 5), data_vencimento: new Date(2026, 7, 10),
    categoria: 'Taxa Condominial', nome_operador: 'Síndico', created_at: new Date(2026, 7, 5),
  };
  const despesaDoPredio = {
    ...taxaDoVizinho, id: 2, nome: 'Conta de luz da portaria', tipo: 'D', valor: 220,
  };

  function buildService() {
    const prisma: any = {
      isConnected: true,
      financeiro: { findMany: jest.fn(async () => [taxaDoVizinho, despesaDoPredio]) },
      condominios: { findUnique: jest.fn(async () => ({ chave_pix: 'x', categoria_padrao: 'Taxa Condominial' })) },
      apartamentos: { findMany: jest.fn(async () => [{ apto: '101', bloco: 'A' }]) },
      $queryRaw: jest.fn(async () => []),
    };
    const noop: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: () => false };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const svc = new FinanceiroService(
      prisma, storage, noop, noop, noop,
      { assertPodeAlterar: jest.fn() } as any, { generateCharge: jest.fn() } as any, tenant,
    );
    return { svc };
  }

  const nomes = (res: any) =>
    Object.values(res.lancamentos as Record<string, any[]>).flat().map((l: any) => l.nome);

  it('morador NÃO reinclui a taxa dos vizinhos mesmo pedindo a flag', async () => {
    const { svc } = buildService();
    const morador: JwtPayload = { sub: 5, nome: 'Morador', typeAccess: 'Morador' };

    const res: any = await svc.getAll(1, '8', '2026', false, morador, true);
    expect(nomes(res)).toEqual(['Conta de luz da portaria']);
  });

  it('síndico continua conseguindo o livro caixa completo', async () => {
    const { svc } = buildService();
    const sindico: JwtPayload = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico' };

    const res: any = await svc.getAll(1, '8', '2026', true, sindico, true);
    expect(nomes(res)).toContain('Apto 101 Bloco A - Taxa Condominial Ref. 08/2026');
  });

  it('operador do console (token com id_condominio) também consegue', async () => {
    const { svc } = buildService();
    const console: JwtPayload = { sub: 3, nome: 'Porteiro', id_condominio: 1 };

    const res: any = await svc.getAll(1, '8', '2026', false, console, true);
    expect(nomes(res)).toContain('Apto 101 Bloco A - Taxa Condominial Ref. 08/2026');
  });
});
