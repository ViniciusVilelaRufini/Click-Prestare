import { proximoVencimento } from './crm-assinatura.util';

describe('proximoVencimento', () => {
  it('antes do dia: neste mês; no dia ou depois: no mês seguinte', () => {
    expect(proximoVencimento(10, new Date('2026-11-05T15:00:00Z')).getMonth()).toBe(10);
    expect(proximoVencimento(10, new Date('2026-11-10T15:00:00Z')).getMonth()).toBe(11);
    expect(proximoVencimento(10, new Date('2026-11-20T15:00:00Z')).getMonth()).toBe(11);
  });

  it('usa o dia de Brasília: 01:00Z do dia do vencimento ainda é o dia anterior em BRT', () => {
    const r = proximoVencimento(10, new Date('2026-11-10T01:00:00Z')); // 09/11 22:00 em Brasília
    expect(r.getMonth()).toBe(10);
    expect(r.getDate()).toBe(10);
  });

  it('dezembro vira janeiro do ano seguinte', () => {
    const r = proximoVencimento(5, new Date('2026-12-20T15:00:00Z'));
    expect(r.getFullYear()).toBe(2027);
    expect(r.getMonth()).toBe(0);
  });
});
