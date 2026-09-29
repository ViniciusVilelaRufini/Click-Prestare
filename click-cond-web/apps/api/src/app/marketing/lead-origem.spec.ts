import { BadRequestException } from '@nestjs/common';
import { derivarOrigem, validarLead, leadDeClique } from './lead-origem';

describe('derivarOrigem', () => {
  it('gclid vence tudo', () => {
    expect(derivarOrigem({ gclid: 'x', oppref: 'y', utm_source: 'instagram' })).toBe('google');
  });
  it('oppref vira openai', () => expect(derivarOrigem({ oppref: 'y' })).toBe('openai'));
  it('utm instagram, sem diferenciar maiúsculas', () =>
    expect(derivarOrigem({ utm_source: 'Instagram' })).toBe('instagram'));
  it('sem nada é orgânico', () => expect(derivarOrigem({})).toBe('organico'));
  it('string vazia não conta', () => expect(derivarOrigem({ gclid: '  ' })).toBe('organico'));
});

describe('validarLead', () => {
  const ok = { nome: 'Ana', condominio: 'Ed. Sol', unidades: '40', whatsapp: '(17) 99999-0000' };

  it('normaliza whatsapp para dígitos e apara textos', () => {
    const r = validarLead({ ...ok, nome: '  Ana  ' });
    expect(r.whatsapp).toBe('17999990000');
    expect(r.nome).toBe('Ana');
  });
  it('rejeita whatsapp curto', () =>
    expect(() => validarLead({ ...ok, whatsapp: '123' })).toThrow(BadRequestException));
  it('rejeita campo obrigatório vazio', () =>
    expect(() => validarLead({ ...ok, condominio: '' })).toThrow(BadRequestException));
  it('corta campos longos em vez de falhar', () => {
    const r = validarLead({ ...ok, nome: 'a'.repeat(300), gclid: 'g'.repeat(400) });
    expect(r.nome.length).toBe(120);
    expect(r.gclid!.length).toBe(255);
  });
  it('preserva os identificadores de campanha e anúncio para atribuição no CRM', () => {
    const r = validarLead({
      ...ok,
      campaign_id: 'cmpn_a9183a2556f481a285ed3928e2020d43',
      ad_group_id: 'adg_condominios_sp',
      ad_id: 'ad_simulador_01',
    });
    expect(r).toMatchObject({
      campaign_id: 'cmpn_a9183a2556f481a285ed3928e2020d43',
      ad_group_id: 'adg_condominios_sp',
      ad_id: 'ad_simulador_01',
    });
  });
  it('rejeita corpo que não é objeto', () =>
    expect(() => validarLead(null)).toThrow(BadRequestException));
});

describe('leadDeClique', () => {
  it('clique direto no WhatsApp vira lead sem dados, com canal no nome', () => {
    const r = leadDeClique({ clique: 'whatsapp', gclid: 'g1', pagina: '/sobre' })!;
    expect(r.nome).toBe('Clique no WhatsApp (sem dados)');
    expect(r.whatsapp).toBe('');
    expect(derivarOrigem(r)).toBe('google');
  });
  it('clique no Instagram sem anúncio é orgânico', () => {
    const r = leadDeClique({ clique: 'instagram' })!;
    expect(r.nome).toBe('Clique no Instagram (sem dados)');
    expect(derivarOrigem(r)).toBe('organico');
  });
  it('clique do simulador guarda a simulação nas unidades', () => {
    const r = leadDeClique({ clique: 'whatsapp', unidades: '80 unidades · Plus · R$ 773,00/mês' })!;
    expect(r.unidades).toBe('80 unidades · Plus · R$ 773,00/mês');
    expect(leadDeClique({ clique: 'whatsapp' })!.unidades).toBe('—');
  });
  it('clique direto preserva os identificadores de atribuição', () => {
    const r = leadDeClique({ clique: 'whatsapp', campaign_id: 'cmpn_1', ad_group_id: 'adg_1', ad_id: 'ad_1' })!;
    expect(r).toMatchObject({ campaign_id: 'cmpn_1', ad_group_id: 'adg_1', ad_id: 'ad_1' });
  });
  it('corpo sem clique conhecido não é clique', () => {
    expect(leadDeClique({ clique: 'telefone' })).toBeNull();
    expect(leadDeClique({ nome: 'Ana' })).toBeNull();
  });
});
