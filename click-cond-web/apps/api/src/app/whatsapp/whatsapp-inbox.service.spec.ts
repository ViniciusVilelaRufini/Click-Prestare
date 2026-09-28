import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WhatsappInboxService } from './whatsapp-inbox.service';

function montar() {
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
      findMany: jest.fn(async () => conversas),
      aggregate: jest.fn(async () => ({ _sum: { nao_lidas: conversas.reduce((s, c) => s + c.nao_lidas, 0) } })),
    },
    crm_WhatsApp_Mensagens: {
      findUnique: jest.fn(async ({ where }: any) => msgs.find((m) => m.wamid === where.wamid) ?? null),
      create: jest.fn(async ({ data }: any) => { const m = { id: msgs.length + 1, criado_em: new Date(), erro: null, ...data }; msgs.push(m); return m; }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(msgs.find((m) => m.wamid === where.wamid), data)),
      findMany: jest.fn(async ({ where }: any) => msgs.filter((m) => m.conversa_id === where.conversa_id)),
      findFirst: jest.fn(async ({ where }: any) => msgs.filter((m) => m.conversa_id === where.conversa_id && m.direcao === 'entrada').pop() ?? null),
    },
    crm_Leads: {
      findFirst: jest.fn(async () => leads.find((l) => l.nome.startsWith('Clique no WhatsApp') && l.whatsapp === '') ?? null),
      findUnique: jest.fn(async ({ where }: any) => leads.find((l) => l.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => Object.assign(leads.find((l) => l.id === where.id), data)),
      create: jest.fn(async ({ data }: any) => { const l = { id: leads.length + 1, ...data }; leads.push(l); return l; }),
    },
  };
  const graph = { enviarTexto: jest.fn(async () => 'wamid.saida'), enviarModelo: jest.fn(async () => 'wamid.modelo'), marcarLida: jest.fn(async () => undefined) };
  return { conversas, msgs, leads, prisma, graph, svc: new WhatsappInboxService(prisma, graph as any) };
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

  it('sem clique cria lead orgânico', async () => {
    const t = montar();
    await t.svc.registrarEntrada(entrada());
    expect(t.leads[0]).toMatchObject({ nome: 'Ana', whatsapp: '5521999369814', origem: 'organico' });
    expect(t.conversas[0].lead_id).toBe(1);
  });

  it('wamid repetido não duplica', async () => {
    const t = montar();
    await t.svc.registrarEntrada(entrada());
    await t.svc.registrarEntrada(entrada());
    expect(t.msgs).toHaveLength(1);
    expect(t.conversas[0].nao_lidas).toBe(1);
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
});
