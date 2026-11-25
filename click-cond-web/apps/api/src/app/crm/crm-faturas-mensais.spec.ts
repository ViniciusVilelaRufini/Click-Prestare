import { CrmFaturasService, cicloFaturasDoMes } from './crm-faturas.service';

/**
 * J2 + J22: a geração mensal só tentava no dia 1 (UTC do servidor), com tick de
 * 24 h — uma falha ou um deploy no dia 1 perdia o mês. Agora a porta aceita do
 * dia 1 ao 5 (janela de recuperação, como o faturamento recorrente) e o dia/mês
 * vem do fuso de Brasília. A geração é idempotente (findFirst + unique
 * id_condominio+referencia), então repetir na janela não duplica.
 */
describe('CRM: geração mensal de faturas — janela e fuso', () => {
  afterEach(() => jest.useRealTimers());

  function svcCom(clientes: any[] = [], existente: any = null) {
    const create = jest.fn().mockResolvedValue({});
    const prisma: any = {
      isConnected: true,
      crm_Faturas: { findFirst: jest.fn().mockResolvedValue(existente), create },
      assinaturas_Condominios: { findFirst: jest.fn().mockResolvedValue({ valor: 300 }) },
    };
    const svc = Object.create(CrmFaturasService.prototype) as any;
    svc.prisma = prisma;
    svc.logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    svc.auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
    svc.crm = { clientes: jest.fn().mockResolvedValue(clientes) };
    svc.gerarJobRunning = false;
    return { svc, prisma, create };
  }

  it('ciclo aberto do dia 1 ao 5 de Brasília e fechado no dia 6', () => {
    expect(cicloFaturasDoMes(new Date('2026-12-01T12:00:00Z'))).toBe('2026-12');
    expect(cicloFaturasDoMes(new Date('2026-12-03T12:00:00Z'))).toBe('2026-12');
    expect(cicloFaturasDoMes(new Date('2026-12-05T23:00:00Z'))).toBe('2026-12'); // 20:00 BRT do dia 5
    expect(cicloFaturasDoMes(new Date('2026-12-06T12:00:00Z'))).toBeNull();
    expect(cicloFaturasDoMes(new Date('2026-12-20T12:00:00Z'))).toBeNull();
  });

  it('usa o dia de Brasília: 30/11 22:00 BRT (01/12 01:00Z) ainda é novembro, fora da janela', () => {
    expect(cicloFaturasDoMes(new Date('2026-12-01T01:00:00Z'))).toBeNull();
    // 01/12 00:30 BRT = 03:30Z: já é dezembro
    expect(cicloFaturasDoMes(new Date('2026-12-01T03:30:00Z'))).toBe('2026-12');
  });

  it('tick no dia 3 (falhou no dia 1) gera a referência do mês', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-12-03T14:00:00Z'));
    const { svc, create } = svcCom([{ id: 9, ativo: true, mrr: 300, vencimento: null }]);
    await expect(svc.tickGeracaoMensal()).resolves.toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.referencia).toBe('12/2026');
  });

  it('tick fora da janela (dia 6) não gera', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-12-06T14:00:00Z'));
    const { svc, create } = svcCom([{ id: 9, ativo: true, mrr: 300, vencimento: null }]);
    await expect(svc.tickGeracaoMensal()).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('referência pelo mês de Brasília: 01/01 00:30 BRT = 03:30Z', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2027-01-01T03:30:00Z'));
    const { svc, create } = svcCom([{ id: 9, ativo: true, mrr: 300, vencimento: null }]);
    await svc.tickGeracaoMensal();
    expect(create.mock.calls[0][0].data.referencia).toBe('01/2027');
  });

  it('idempotente: fatura já existente da referência não é recriada', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-12-02T14:00:00Z'));
    const { svc, create } = svcCom([{ id: 9, ativo: true, mrr: 300, vencimento: null }], { id: 77 });
    await expect(svc.tickGeracaoMensal()).resolves.toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it('corrida com geração manual (P2002 no create) conta como já existente', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-12-02T14:00:00Z'));
    const { svc, create } = svcCom([{ id: 9, ativo: true, mrr: 300, vencimento: null }]);
    create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(svc.tickGeracaoMensal()).resolves.toBe(true);
  });

  it('falha da geração devolve false (o ciclo do mês não é marcado)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-12-01T14:00:00Z'));
    const { svc } = svcCom();
    svc.crm.clientes.mockRejectedValue(new Error('banco fora'));
    await expect(svc.tickGeracaoMensal()).resolves.toBe(false);
  });
});
