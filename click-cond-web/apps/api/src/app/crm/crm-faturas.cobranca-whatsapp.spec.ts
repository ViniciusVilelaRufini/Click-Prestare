import { CrmFaturasService, fraseVencimentoCobranca } from './crm-faturas.service';

describe('cobrança de fatura por WhatsApp — frase do vencimento', () => {
  const hoje = new Date(Date.UTC(2026, 10, 26));

  it('fatura vencida diz "venceu em", a de hoje ou futura "vence em"', () => {
    expect(fraseVencimentoCobranca(new Date(Date.UTC(2026, 9, 5)), hoje)).toBe(' venceu em 05/10/2026');
    expect(fraseVencimentoCobranca(new Date(Date.UTC(2026, 10, 26)), hoje)).toBe(' vence em 26/11/2026');
    expect(fraseVencimentoCobranca(new Date(Date.UTC(2026, 11, 10)), hoje)).toBe(' vence em 10/12/2026');
  });

  it('sem vencimento omite a frase (nunca "vence em em aberto")', () => {
    expect(fraseVencimentoCobranca(null, hoje)).toBe('');
  });

  it('a mensagem padrão sai gramatical nos dois casos', async () => {
    const montar = (vencimento: Date | null) => {
      const enviar = jest.fn(async () => ({ ok: true }));
      const prisma: any = {
        isConnected: true,
        crm_Faturas: { findUnique: jest.fn(async () => ({ id: 1, id_condominio: 3, referencia: '2026-10', valor: 490, vencimento })) },
        crm_Config: { findMany: jest.fn(async () => []) },
        crm_Disparos: { create: jest.fn(async () => ({})) },
      };
      const crm: any = { cliente: jest.fn(async () => ({ nome: 'Ed. Sol', contatoPrincipal: { nome: 'Ana', telefone: '17996608148' } })) };
      const svc = new CrmFaturasService(prisma, { registrar: jest.fn() } as any, { sendWhatsApp: enviar } as any, crm);
      return { svc, enviar };
    };
    const a = montar(null);
    await a.svc.cobrarWhatsApp(1, 'op');
    const texto = (a.enviar.mock.calls[0] as any[])[1] as string;
    expect(texto).toContain('no valor de R$');
    expect(texto).not.toMatch(/em aberto|vence em\s*\./);
    expect(texto).toMatch(/490,00\. Qualquer/);
    const b = montar(new Date(Date.UTC(2020, 0, 5)));
    await b.svc.cobrarWhatsApp(1, 'op');
    expect((b.enviar.mock.calls[0] as any[])[1]).toContain('venceu em 05/01/2020. Qualquer');
  });
});
