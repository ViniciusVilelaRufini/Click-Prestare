import { FinanceiroService } from './financeiro.service';
import { TenantAccessService } from '../auth/tenant-access.service';

/**
 * Condomínio espelhado da Superlógica não pode entrar no faturamento
 * recorrente do Clique.
 *
 * Quem emite a taxa dele é o ERP, e o sync traz a cobrança pronta. Se o job
 * gerar também, o morador recebe DUAS cobranças do mesmo mês — a do ERP e a
 * do Clique — e paga a errada, ou paga duas vezes.
 *
 * O risco virou concreto quando o financeiro passou a ser somente leitura: o
 * interruptor da recorrência (`POST config-auto`) responde 403 e sumiu da
 * portaria-web, então um condomínio que migrasse para o ERP com
 * `recorrencia_ativa = true` não teria como ser desligado a não ser por SQL
 * direto no banco de produção.
 *
 * O mock devolve DE PROPÓSITO os dois condomínios, inclusive o vinculado ao
 * ERP: a separação é feita pelo service, em memória, e um mock que já
 * filtrasse faria o trabalho que está sendo testado — o teste passaria mesmo
 * com a trava removida.
 */
describe('FinanceiroService — recorrência pula condomínio da Superlógica', () => {
  const CONDOMINIOS = [
    { id: 1, nome: 'Edifício Demo', dia_geracao: 1, id_superlogica_cond: null, recorrencia_ativa: true },
    { id: 2, nome: 'Teste Prestare Api', dia_geracao: 1, id_superlogica_cond: 43, recorrencia_ativa: true },
  ];

  function build() {
    const criados: any[] = [];

    // Devolve os dois condomínios COM o vínculo preenchido: quem separa é
    // o service, em memória. O mock não pode fazer o trabalho que está
    // sendo testado.
    const filtrar = (where: any) =>
      CONDOMINIOS.filter((c) => !(where?.recorrencia_ativa === true && !c.recorrencia_ativa));

    const prisma: any = {
      isConnected: true,
      condominios: {
        findMany: jest.fn(async ({ where }: any) => filtrar(where)),
        findUnique: jest.fn(async ({ where }: any) => ({
          ...CONDOMINIOS.find((c) => c.id === where.id),
          valor_condominio: 650,
          dia_vencimento: 10,
          categoria_padrao: 'Condomínio',
          mes_inicio_recorrencia: null,
          ano_inicio_recorrencia: null,
        })),
      },
      apartamentos: { findMany: jest.fn(async () => [{ id: 1, apto: '101', bloco: 'A' }]) },
      users: { findMany: jest.fn(async () => []) },
      financeiro: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: 100 + criados.length, ...data };
          criados.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
    };
    const noop: any = { registrar: jest.fn(), sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const fechamento: any = { assertPodeAlterar: jest.fn(async () => undefined) };
    const openPix: any = { generateCharge: jest.fn(async () => null) };
    const tenant = new TenantAccessService(prisma);
    const svc = new FinanceiroService(prisma, storage, noop, noop, noop, fechamento, openPix, tenant);
    return { svc, prisma, criados };
  }

  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-09-01T12:00:00')));
  afterEach(() => jest.useRealTimers());

  it('não gera fatura para condomínio vinculado ao ERP', async () => {
    const { svc, criados } = build();
    await svc.runRecurringBillingJob();

    const doErp = criados.filter((f) => f.id_condominio === 2);
    expect(doErp).toHaveLength(0);
  });

  it('continua gerando para condomínio que NÃO usa a Superlógica', async () => {
    const { svc, criados } = build();
    await svc.runRecurringBillingJob();

    // A trava não pode ser um desligamento geral da recorrência: prédio que
    // não migrou para o ERP depende dela para faturar.
    expect(criados.filter((f) => f.id_condominio === 1).length).toBeGreaterThan(0);
  });

  it('registra no log quantos condomínios foram pulados', async () => {
    const { svc } = build();
    const log = jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);

    await svc.runRecurringBillingJob();

    // Sem esta linha, um condomínio deixar de faturar vira mistério na
    // operação — o silêncio é indistinguível de defeito.
    expect(log.mock.calls.flat().join(' ')).toMatch(/vinculados à Superlógica/);
  });
});
