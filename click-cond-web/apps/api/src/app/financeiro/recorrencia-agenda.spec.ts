import { FinanceiroService } from './financeiro.service';
import { TenantAccessService } from '../auth/tenant-access.service';

/**
 * O faturamento recorrente é o motor que emite a receita do condomínio sem
 * ninguém olhando. Dois defeitos de calendário faziam ele falhar em silêncio:
 *
 *  1. `dia_geracao === diaAtual` — o job tenta uma vez por dia, na hora
 *     gatilho. Perder aquele tick (deploy no Railway, banco lento, exceção)
 *     custava o MÊS INTEIRO de faturamento, sem erro nenhum no log. E
 *     `dia_geracao = 31` nunca era igual ao dia atual em abril, junho,
 *     setembro e novembro.
 *  2. `new Date(ano, mes-1, 31)` transborda para o mês seguinte, então a
 *     fatura de setembro nascia vencendo em 1º de outubro.
 */
describe('FinanceiroService — calendário do faturamento recorrente', () => {
  function build(cond: any) {
    const criados: any[] = [];
    const prisma: any = {
      isConnected: true,
      condominios: {
        findMany: jest.fn(async () => [{ id: cond.id, dia_geracao: cond.dia_geracao }]),
        findUnique: jest.fn(async () => cond),
      },
      apartamentos: { findMany: jest.fn(async () => [{ id: 1, apto: '101', bloco: 'A' }]) },
      users: { findMany: jest.fn(async () => []) },
      financeiro: {
        // Dedup por nome: devolve o que já foi criado nesta execução.
        // Emula o filtro do Prisma (string exata ou startsWith/endsWith).
        findFirst: jest.fn(async ({ where }: any) => {
          const f = where.nome;
          const casa = (nome: string) =>
            typeof f === 'string'
              ? nome === f
              : (!f.startsWith || nome.startsWith(f.startsWith)) &&
                (!f.endsWith || nome.endsWith(f.endsWith));
          return criados.find((c) => casa(c.nome)) ?? null;
        }),
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
    const svc = new FinanceiroService(
      prisma, storage, noop, noop, noop, fechamento, openPix, tenant,
    );
    return { svc, prisma, criados };
  }

  const condBase = {
    id: 1,
    nome: 'Edifício Demo',
    recorrencia_ativa: true,
    valor_condominio: 650,
    dia_geracao: 1,
    dia_vencimento: 10,
    categoria_padrao: 'Condomínio',
    mes_inicio_recorrencia: null,
    ano_inicio_recorrencia: null,
  };

  function comHoje(iso: string) {
    jest.useFakeTimers().setSystemTime(new Date(iso));
  }
  afterEach(() => jest.useRealTimers());

  describe('janela de recuperação', () => {
    it('gera no próprio dia de geração', async () => {
      comHoje('2026-08-01T12:00:00');
      const { svc, criados } = build(condBase);
      await svc.runRecurringBillingJob();
      expect(criados).toHaveLength(1);
    });

    it('recupera quando o tick do dia certo foi perdido (deploy no Railway)', async () => {
      comHoje('2026-08-03T12:00:00'); // 2 dias depois do dia_geracao
      const { svc, criados } = build(condBase);
      await svc.runRecurringBillingJob();
      expect(criados).toHaveLength(1);
    });

    it('desiste depois da janela — fatura apagada pelo síndico não ressuscita', async () => {
      comHoje('2026-08-20T12:00:00');
      const { svc, criados } = build(condBase);
      await svc.runRecurringBillingJob();
      expect(criados).toHaveLength(0);
    });

    it('não gera antes do dia de geração', async () => {
      comHoje('2026-08-01T12:00:00');
      const { svc, criados } = build({ ...condBase, dia_geracao: 5 });
      await svc.runRecurringBillingJob();
      expect(criados).toHaveLength(0);
    });

    it('dia_geracao 31 funciona em mês de 30 dias (antes nunca rodava)', async () => {
      comHoje('2026-09-30T12:00:00'); // setembro tem 30 dias
      const { svc, criados } = build({ ...condBase, dia_geracao: 31 });
      await svc.runRecurringBillingJob();
      expect(criados).toHaveLength(1);
    });

    it('não duplica quando roda de novo no dia seguinte', async () => {
      comHoje('2026-08-01T12:00:00');
      const { svc, criados } = build(condBase);
      await svc.runRecurringBillingJob();
      comHoje('2026-08-02T12:00:00');
      await svc.runRecurringBillingJob();
      expect(criados).toHaveLength(1);
    });

    /**
     * A identidade da fatura recorrente é "esta unidade, esta competência".
     * A categoria entra no NOME, e salvar a tela de cobrança automática
     * dispara uma geração forçada — então trocar a categoria e salvar fazia o
     * dedup por nome exato não encontrar as faturas do mês e emitir tudo de
     * novo: o prédio inteiro devendo duas taxas da mesma competência.
     */
    it('trocar a categoria padrão NÃO reemite as faturas do mês', async () => {
      comHoje('2026-08-01T12:00:00');
      const cond = { ...condBase };
      const { svc, criados } = build(cond);
      await svc.runRecurringBillingJob();
      expect(criados).toHaveLength(1);

      // Síndico renomeia a categoria e salva; o job roda de novo na janela.
      cond.categoria_padrao = 'Taxa Condominial';
      comHoje('2026-08-02T12:00:00');
      await svc.runRecurringBillingJob();

      expect(criados).toHaveLength(1);
    });

    it('a competência seguinte continua sendo gerada normalmente', async () => {
      comHoje('2026-08-01T12:00:00');
      const { svc, criados } = build(condBase);
      await svc.runRecurringBillingJob();
      comHoje('2026-09-01T12:00:00');
      await svc.runRecurringBillingJob();
      expect(criados).toHaveLength(2);
    });
  });

  describe('data de vencimento', () => {
    it('dia_vencimento 31 não escorrega para o mês seguinte', async () => {
      comHoje('2026-09-01T12:00:00');
      const { svc, criados } = build({ ...condBase, dia_vencimento: 31 });
      await svc.runRecurringBillingJob();

      const venc: Date = criados[0].data_vencimento;
      expect(venc.getMonth()).toBe(8); // setembro (0-based)
      expect(venc.getDate()).toBe(30); // encolhido para o último dia
    });

    it('dia_vencimento 30 em fevereiro vira 28', async () => {
      comHoje('2026-02-01T12:00:00');
      const { svc, criados } = build({ ...condBase, dia_vencimento: 30 });
      await svc.runRecurringBillingJob();

      const venc: Date = criados[0].data_vencimento;
      expect(venc.getMonth()).toBe(1); // fevereiro
      expect(venc.getDate()).toBe(28);
    });

    it('vencimento anterior ao dia de geração cai no mês seguinte, como antes', async () => {
      comHoje('2026-08-20T12:00:00');
      const { svc, criados } = build({ ...condBase, dia_geracao: 20, dia_vencimento: 5 });
      await svc.runRecurringBillingJob();

      const venc: Date = criados[0].data_vencimento;
      expect(venc.getMonth()).toBe(8); // setembro
      expect(venc.getDate()).toBe(5);
    });
  });
});
