import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WhatsappInboxService } from './whatsapp-inbox.service';
import { AUTOMACOES_PADRAO, normalizarConfig } from './whatsapp-automacao';

function montar(config?: any, conversions?: any) {
  const conversas: any[] = [];
  const msgs: any[] = [];
  const leads: any[] = [];
  const prisma: any = {
    crm_WhatsApp_Conversas: {
      findUnique: jest.fn(async ({ where }: any) => conversas.find((c) => (where.id ? c.id === where.id : c.wa_id === where.wa_id)) ?? null),
      create: jest.fn(async ({ data }: any) => { const c = { id: conversas.length + 1, nao_lidas: 0, lead_id: null, ...data }; conversas.push(c); return c; }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = conversas.find((x) => x.id === where.id);
        for (const [k, v] of Object.entries(data)) c[k] = (v as any)?.increment !== undefined ? c[k] + (v as any).increment : v;
        return c;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const c = conversas.find((x) => x.id === where.id && x.conversao_lead_id !== data.conversao_lead_id);
        if (!c) return { count: 0 };
        Object.assign(c, data);
        return { count: 1 };
      }),
      findMany: jest.fn(async () => conversas),
      aggregate: jest.fn(async () => ({ _sum: { nao_lidas: conversas.reduce((s, c) => s + c.nao_lidas, 0) } })),
    },
    crm_WhatsApp_Mensagens: {
      findUnique: jest.fn(async ({ where }: any) => msgs.find((m) => m.wamid === where.wamid) ?? null),
      create: jest.fn(async ({ data }: any) => { const m = { id: msgs.length + 1, criado_em: new Date(), erro: null, ...data }; msgs.push(m); return m; }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(msgs.find((m) => m.wamid === where.wamid), data)),
      findMany: jest.fn(async ({ where }: any) => msgs.filter((m) => m.conversa_id === where.conversa_id)),
      findFirst: jest.fn(async ({ where }: any) => msgs.filter((m) => Object.entries(where).every(([k, v]) => {
        if (typeof v === 'object' && v && 'not' in v) return m[k] !== (v as any).not;
        return m[k] === v;
      })).pop() ?? null),
    },
    crm_Leads: {
      findFirst: jest.fn(async () => leads.find((l) => l.nome.startsWith('Clique no WhatsApp') && l.whatsapp === '') ?? null),
      findMany: jest.fn(async ({ where, orderBy }: any) => leads
        .filter((lead) => !where?.criado_em || (
          new Date(lead.criado_em).getTime() >= where.criado_em.gte.getTime()
          && new Date(lead.criado_em).getTime() <= where.criado_em.lte.getTime()
        ))
        .sort((a, b) => orderBy?.criado_em === 'desc'
          ? new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime()
          : 0)),
      findUnique: jest.fn(async ({ where }: any) => leads.find((l) => l.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => Object.assign(leads.find((l) => l.id === where.id), data)),
      create: jest.fn(async ({ data }: any) => { const l = { id: leads.length + 1, ...data }; leads.push(l); return l; }),
    },
  };
  const graph = { enviarTexto: jest.fn(async () => 'wamid.saida'), enviarModelo: jest.fn(async () => 'wamid.modelo'), marcarLida: jest.fn(async () => undefined) };
  return { conversas, msgs, leads, prisma, graph, svc: new (WhatsappInboxService as any)(prisma, graph, config, conversions) };
}

const entrada = (over: any = {}) => ({ wamid: 'w1', waId: '5521999369814', nomePerfil: 'Ana', tipo: 'text', texto: 'Oi', em: new Date(), ...over });

describe('WhatsappInboxService', () => {
  it('primeira mensagem cria conversa e liga ao clique recente', async () => {
    const t = montar();
    t.leads.push({ id: 7, nome: 'Clique no WhatsApp (sem dados)', whatsapp: '', origem: 'google' });
    await t.svc.registrarEntrada(entrada());
    expect(t.conversas[0]).toMatchObject({ wa_id: '5521999369814', lead_id: 7, nao_lidas: 1 });
    expect(t.leads[0]).toMatchObject({ whatsapp: '5521999369814', nome: 'Ana' });
  });

  it('links an inbound message to the newest recent lead with the same normalized WhatsApp number', async () => {
    const t = montar();
    const now = new Date('2026-09-30T12:00:00Z');
    t.leads.push(
      { id: 40, nome: 'Ana stale', whatsapp: '(17) 99660-8148', criado_em: new Date('2026-09-30T11:29:59Z') },
      { id: 41, nome: 'Ana antiga', whatsapp: '(17) 99660-8148', criado_em: new Date('2026-09-30T11:40:00Z') },
      { id: 42, nome: 'Ana recente', whatsapp: '17 99660-8148', criado_em: new Date('2026-09-30T11:55:00Z') },
    );

    await t.svc.registrarEntrada(entrada({ em: now, waId: '5517996608148' }));

    expect(t.conversas[0]).toMatchObject({ lead_id: 42 });
    expect(t.prisma.crm_Leads.findMany).toHaveBeenCalledWith({
      where: { criado_em: { gte: new Date('2026-09-30T11:30:00Z'), lte: now } },
      orderBy: { criado_em: 'desc' },
    });
  });

  it('rebinds an existing conversation to the newest matching recent submitted lead', async () => {
    const t = montar();
    const now = new Date('2026-09-30T12:00:00Z');
    t.conversas.push({ id: 1, wa_id: '5517996608148', lead_id: 7, nao_lidas: 0 });
    t.leads.push(
      { id: 7, nome: 'Lead anterior', whatsapp: '5517996608148', criado_em: new Date('2026-09-30T10:00:00Z') },
      { id: 42, nome: 'Novo envio', whatsapp: '(17) 99660-8148', criado_em: new Date('2026-09-30T11:55:00Z') },
    );

    await t.svc.registrarEntrada(entrada({ wamid: 'wamid-rebind', em: now, waId: '5517996608148' }));

    expect(t.conversas[0].lead_id).toBe(42);
    expect(t.prisma.crm_WhatsApp_Conversas.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 }, data: expect.objectContaining({ lead_id: 42 }),
    }));
  });

  it('dispatches the confirmed paid lead only after persisting the inbound message and conversation', async () => {
    const conversions = { confirmarLeadWhatsApp: jest.fn(async () => undefined) };
    const t = montar(undefined, conversions);
    const now = new Date('2026-09-30T12:00:00Z');
    t.leads.push({ id: 42, nome: 'Ana', whatsapp: '5517996608148', origem: 'openai', oppref: 'op-1', criado_em: now });

    await t.svc.registrarEntrada(entrada({ wamid: 'wamid-1', em: now, waId: '5517996608148' }));

    expect(conversions.confirmarLeadWhatsApp).toHaveBeenCalledWith(expect.objectContaining({
      wamid: 'wamid-1', em: now, lead: expect.objectContaining({ id: 42, origem: 'openai', oppref: 'op-1' }),
    }));
    expect(t.msgs).toHaveLength(1);
    expect(t.conversas[0].nao_lidas).toBe(1);
  });

  it('sem clique cria lead orgânico', async () => {
    const t = montar();
    await t.svc.registrarEntrada(entrada());
    expect(t.leads[0]).toMatchObject({ nome: 'Ana', whatsapp: '5521999369814', origem: 'organico' });
    expect(t.conversas[0].lead_id).toBe(1);
  });

  it('wamid repetido não duplica', async () => {
    const conversions = { confirmarLeadWhatsApp: jest.fn(async () => undefined) };
    const t = montar(undefined, conversions);
    t.leads.push({ id: 7, nome: 'Ana', whatsapp: '5521999369814', origem: 'openai', oppref: 'op-1', criado_em: new Date() });
    await t.svc.registrarEntrada(entrada());
    await t.svc.registrarEntrada(entrada());
    expect(t.msgs).toHaveLength(1);
    expect(t.conversas[0].nao_lidas).toBe(1);
    expect(conversions.confirmarLeadWhatsApp).toHaveBeenCalledTimes(1);
  });

  it('dispatches a paid conversation only for its first distinct inbound wamid', async () => {
    const conversions = { confirmarLeadWhatsApp: jest.fn(async () => undefined) };
    const t = montar(undefined, conversions);
    const now = new Date('2026-09-30T12:00:00Z');
    t.leads.push({ id: 7, nome: 'Ana', whatsapp: '5521999369814', origem: 'openai', oppref: 'op-1', criado_em: now });

    await t.svc.registrarEntrada(entrada({ wamid: 'wamid-1', em: now }));
    await t.svc.registrarEntrada(entrada({ wamid: 'wamid-2', em: new Date(now.getTime() + 1_000) }));

    expect(t.msgs.filter((m) => m.direcao === 'entrada')).toHaveLength(2);
    expect(conversions.confirmarLeadWhatsApp).toHaveBeenCalledTimes(1);
    expect(t.prisma.crm_WhatsApp_Conversas.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ conversao_lead_id: null }, { conversao_lead_id: { not: 7 } }] }),
      data: expect.objectContaining({ conversao_lead_id: 7 }),
    }));
  });

  it('status só avança', async () => {
    const t = montar();
    t.msgs.push({ id: 1, wamid: 'ws', status: 'lida' });
    await t.svc.atualizarStatus({ wamid: 'ws', status: 'entregue' });
    expect(t.msgs[0].status).toBe('lida');
  });

  it('envio com janela aberta grava saída', async () => {
    const t = montar();
    await t.svc.registrarEntrada(entrada());
    const m = await t.svc.enviar(1, 'Olá!');
    expect(t.graph.enviarTexto).toHaveBeenCalledWith('5521999369814', 'Olá!');
    expect(m).toMatchObject({ direcao: 'saida', texto: 'Olá!', status: 'enviada' });
  });

  it('envio com janela fechada dá 409 e não chama a API', async () => {
    const t = montar();
    await t.svc.registrarEntrada(entrada({ em: new Date(Date.now() - 25 * 3600 * 1000) }));
    await expect(t.svc.enviar(1, 'Oi')).rejects.toBeInstanceOf(ConflictException);
    expect(t.graph.enviarTexto).not.toHaveBeenCalled();
  });

  it('falha do Graph grava mensagem com status falhou', async () => {
    const t = montar();
    t.graph.enviarTexto.mockRejectedValueOnce(new Error('boom'));
    await t.svc.registrarEntrada(entrada());
    const m = await t.svc.enviar(1, 'Oi');
    expect(m).toMatchObject({ status: 'falhou', erro: 'boom' });
  });

  it('conversa inexistente dá 404', async () => {
    await expect(montar().svc.enviar(99, 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('abrir mensagens zera não lidas', async () => {
    const t = montar();
    await t.svc.registrarEntrada(entrada());
    await t.svc.mensagens(1);
    expect(t.conversas[0].nao_lidas).toBe(0);
    expect(t.graph.marcarLida).toHaveBeenCalledWith('w1');
  });

  describe('iniciarConversa', () => {
    it('cria conversa ligada ao lead e envia o modelo (com DDI 55)', async () => {
      const t = montar();
      t.leads.push({ id: 5, nome: 'Contato', whatsapp: '21999369814' });
      const r = await t.svc.iniciarConversa(5);
      expect(t.graph.enviarModelo).toHaveBeenCalledWith('5521999369814', 'primeiro_contato_orcamento');
      expect(t.conversas[0]).toMatchObject({ wa_id: '5521999369814', lead_id: 5 });
      expect(r).toMatchObject({ conversaId: 1, mensagem: { direcao: 'saida', status: 'enviada' } });
    });

    it('reaproveita a conversa existente', async () => {
      const t = montar();
      t.leads.push({ id: 5, nome: 'Contato', whatsapp: '5521999369814' });
      t.conversas.push({ id: 1, wa_id: '5521999369814', lead_id: null, nao_lidas: 0 });
      await t.svc.iniciarConversa(5);
      expect(t.conversas).toHaveLength(1);
      expect(t.conversas[0].lead_id).toBe(5);
    });

    it('modelo recusado vira mensagem com falha, sem exceção', async () => {
      const t = montar();
      t.leads.push({ id: 5, nome: 'Contato', whatsapp: '5521999369814' });
      t.graph.enviarModelo.mockRejectedValueOnce(new Error('Template not approved'));
      const r = await t.svc.iniciarConversa(5);
      expect(r.mensagem).toMatchObject({ status: 'falhou', erro: 'Template not approved' });
    });

    it('lead inexistente dá 404 e sem número dá 400', async () => {
      const t = montar();
      t.leads.push({ id: 6, nome: 'Clique', whatsapp: '' });
      await expect(t.svc.iniciarConversa(99)).rejects.toBeInstanceOf(NotFoundException);
      await expect(t.svc.iniciarConversa(6)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('respostas automáticas', () => {
    const seg10h = new Date('2026-09-28T13:00:00Z'); // segunda 10:00 em Brasília
    const cfg = (boasVindas: boolean, fora = false) => ({
      automacoes: jest.fn(async () => normalizarConfig({ boasVindas: { ativo: boasVindas }, foraHorario: { ativo: fora } })),
    });
    beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }); jest.setSystemTime(seg10h); });
    afterEach(() => jest.useRealTimers());

    it('primeira mensagem recebe boas-vindas marcada como automática', async () => {
      const t = montar(cfg(true));
      await t.svc.registrarEntrada(entrada({ em: seg10h }));
      expect(t.graph.enviarTexto).toHaveBeenCalledWith('5521999369814', AUTOMACOES_PADRAO.boasVindas.texto);
      expect(t.msgs.find((m) => m.direcao === 'saida')).toMatchObject({ tipo: 'auto_boas_vindas', status: 'enviada' });
    });

    it('segunda mensagem da mesma conversa não repete a boas-vindas', async () => {
      const t = montar(cfg(true));
      await t.svc.registrarEntrada(entrada({ em: seg10h }));
      await t.svc.registrarEntrada(entrada({ wamid: 'w2', em: seg10h }));
      expect(t.graph.enviarTexto).toHaveBeenCalledTimes(1);
    });

    it('mensagem antiga (webhook reenviado) não dispara automação', async () => {
      const t = montar(cfg(true));
      await t.svc.registrarEntrada(entrada({ em: new Date(seg10h.getTime() - 3600e3) }));
      expect(t.graph.enviarTexto).not.toHaveBeenCalled();
    });

    it('fora do horário manda uma vez e não repete na mensagem seguinte', async () => {
      jest.setSystemTime(new Date('2026-09-28T23:00:00Z')); // segunda 20:00
      const t = montar(cfg(true, true));
      await t.svc.registrarEntrada(entrada({ em: new Date() }));
      await t.svc.registrarEntrada(entrada({ wamid: 'w2', em: new Date() }));
      expect(t.graph.enviarTexto).toHaveBeenCalledTimes(1);
      expect(t.msgs.filter((m) => m.direcao === 'saida')[0].tipo).toBe('auto_fora_horario');
    });

    it('erro ao ler a configuração não impede gravar a mensagem', async () => {
      const t = montar({ automacoes: jest.fn(async () => { throw new Error('db'); }) });
      await t.svc.registrarEntrada(entrada({ em: seg10h }));
      expect(t.msgs).toHaveLength(1);
    });
  });
});
