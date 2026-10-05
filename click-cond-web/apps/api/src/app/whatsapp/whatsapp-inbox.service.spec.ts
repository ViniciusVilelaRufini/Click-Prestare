import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RangeMidiaInvalido, WhatsappInboxService } from './whatsapp-inbox.service';
import { AUTOMACOES_PADRAO, normalizarConfig } from './whatsapp-automacao';

function montar(config?: any, conversions?: any, media?: any) {
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
      findUnique: jest.fn(async ({ where }: any) => msgs.find((m) => where.id ? m.id === where.id : m.wamid === where.wamid) ?? null),
      create: jest.fn(async ({ data }: any) => { const m = { id: msgs.length + 1, criado_em: new Date(), erro: null, ...data }; msgs.push(m); return m; }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(msgs.find((m) => m.wamid === where.wamid), data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const m = msgs.find((x) => x.wamid === where.wamid && (
          !where.media_status || where.media_status === x.media_status || where.media_status?.in?.includes(x.media_status)
        ));
        if (!m) return { count: 0 };
        Object.assign(m, data);
        return { count: 1 };
      }),
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
  const graph = { enviarTexto: jest.fn(async () => 'wamid.saida'), enviarModelo: jest.fn(async () => 'wamid.modelo'), enviarMidia: jest.fn(async () => 'wamid.midia'), marcarLida: jest.fn(async () => undefined) };
  return { conversas, msgs, leads, prisma, graph, svc: new (WhatsappInboxService as any)(prisma, graph, config, conversions, media) };
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

  it('persiste a mensagem inbound antes de guardar sua mídia privada', async () => {
    const media = { guardarEntrada: jest.fn(async () => ({
      chave: 'whatsapp/w-audio/00000000-0000-4000-8000-000000000001', mime: 'audio/ogg', nome: null, tamanho: 12, status: 'armazenada',
    })) };
    const t = montar(undefined, undefined, media);

    await t.svc.registrarEntrada(entrada({ wamid: 'w-audio', tipo: 'audio', mediaId: 'media-audio-1', mime: 'audio/ogg' }));

    expect(media.guardarEntrada).toHaveBeenCalledWith({ wamid: 'w-audio', tipo: 'audio', mediaId: 'media-audio-1' });
    expect(t.msgs[0]).toMatchObject({
      media_chave: 'whatsapp/w-audio/00000000-0000-4000-8000-000000000001', media_mime: 'audio/ogg',
      media_tamanho: 12, media_status: 'armazenada',
    });
  });

  it('mantém MIME e nome recebidos no webhook quando o armazenamento está indisponível', async () => {
    const media = { guardarEntrada: jest.fn(async () => ({
      chave: null, mime: null, nome: null, tamanho: null, status: 'indisponivel',
    })) };
    const t = montar(undefined, undefined, media);

    await t.svc.registrarEntrada(entrada({
      wamid: 'w-documento', tipo: 'document', mediaId: 'media-documento-1',
      mime: 'application/pdf', nome: 'proposta.pdf',
    }));

    expect(t.msgs[0]).toMatchObject({
      media_mime: 'application/pdf', media_nome: 'proposta.pdf', media_status: 'indisponivel',
    });
  });

  it('repete a importação de mídia falhada sem duplicar a mensagem', async () => {
    const media = { guardarEntrada: jest.fn()
      .mockRejectedValueOnce(new Error('S3 temporariamente indisponível'))
      .mockResolvedValueOnce({ chave: 'whatsapp/w-retry/00000000-0000-4000-8000-000000000001', mime: 'audio/ogg', nome: null, tamanho: 3, status: 'armazenada' }) };
    const t = montar(undefined, undefined, media);
    const recebida = entrada({ wamid: 'w-retry', tipo: 'audio', mediaId: 'media-retry', mime: 'audio/ogg' });

    await t.svc.registrarEntrada(recebida);
    await t.svc.registrarEntrada(recebida);

    expect(t.msgs).toHaveLength(1);
    expect(media.guardarEntrada).toHaveBeenCalledTimes(2);
    expect(t.msgs[0]).toMatchObject({ media_chave: 'whatsapp/w-retry/00000000-0000-4000-8000-000000000001', media_status: 'armazenada' });
  });

  it('retenta mídia indisponível quando o armazenamento volta', async () => {
    const media = { guardarEntrada: jest.fn()
      .mockResolvedValueOnce({ chave: null, mime: null, nome: null, tamanho: null, status: 'indisponivel' })
      .mockResolvedValueOnce({ chave: 'whatsapp/w-indisponivel/00000000-0000-4000-8000-000000000001', mime: 'audio/ogg', nome: null, tamanho: 3, status: 'armazenada' }) };
    const t = montar(undefined, undefined, media);
    const recebida = entrada({ wamid: 'w-indisponivel', tipo: 'audio', mediaId: 'media-indisponivel' });

    await t.svc.registrarEntrada(recebida);
    await t.svc.registrarEntrada(recebida);

    expect(t.msgs).toHaveLength(1);
    expect(media.guardarEntrada).toHaveBeenCalledTimes(2);
    expect(t.msgs[0]).toMatchObject({ media_status: 'armazenada', media_chave: 'whatsapp/w-indisponivel/00000000-0000-4000-8000-000000000001' });
  });

  it('recupera uma claim importando expirada', async () => {
    const media = { guardarEntrada: jest.fn(async () => ({ chave: 'whatsapp/w-stale/00000000-0000-4000-8000-000000000001', mime: 'audio/ogg', nome: null, tamanho: 3, status: 'armazenada' })) };
    const t = montar(undefined, undefined, media);
    t.msgs.push({ id: 9, wamid: 'w-stale', media_status: `importando-${Math.floor((Date.now() - 20 * 60_000) / 1000).toString(36)}` });

    await t.svc.registrarEntrada(entrada({ wamid: 'w-stale', tipo: 'audio', mediaId: 'media-stale' }));

    expect(media.guardarEntrada).toHaveBeenCalledWith({ wamid: 'w-stale', tipo: 'audio', mediaId: 'media-stale' });
    expect(t.msgs).toHaveLength(1);
  });

  it('reusa a única mensagem após falha de finalização da importação', async () => {
    const media = { guardarEntrada: jest.fn(async () => ({ chave: 'whatsapp/w-finalizar/00000000-0000-4000-8000-000000000001', mime: 'audio/ogg', nome: null, tamanho: 3, status: 'armazenada' })) };
    const t = montar(undefined, undefined, media);
    t.prisma.crm_WhatsApp_Mensagens.update.mockRejectedValueOnce(new Error('DB indisponível'));
    const recebida = entrada({ wamid: 'w-finalizar', tipo: 'audio', mediaId: 'media-finalizar' });

    await t.svc.registrarEntrada(recebida);
    await t.svc.registrarEntrada(recebida);

    expect(t.msgs).toHaveLength(1);
    expect(media.guardarEntrada).toHaveBeenCalledTimes(2);
    expect(t.msgs[0]).toMatchObject({ media_chave: 'whatsapp/w-finalizar/00000000-0000-4000-8000-000000000001', media_status: 'armazenada' });
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

  it('envia imagem pela Graph API e registra a saída', async () => {
    const t = montar(undefined, undefined, { guardarSaida: jest.fn(async () => ({ chave: 'whatsapp/saida-ok/00000000-0000-4000-8000-000000000001', mime: 'image/png', nome: 'portaria.png', tamanho: 8, status: 'armazenada' })) });
    await t.svc.registrarEntrada(entrada());

    const m = await t.svc.enviarMidia(1, {
      tipo: 'image', legenda: 'Portaria',
      arquivo: { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mimetype: 'image/png', originalname: 'portaria.png' },
    });

    expect(t.graph.enviarMidia).toHaveBeenCalledWith({
      para: '5521999369814', tipo: 'image', legenda: 'Portaria',
      arquivo: expect.objectContaining({ mimetype: 'image/png', originalname: 'portaria.png' }),
    });
    expect(m).toMatchObject({ direcao: 'saida', tipo: 'image', texto: 'Portaria', status: 'enviada' });
  });

  it.each([
    ['image', 'image/png', Buffer.from('MZ executável'), Buffer.alloc(6 * 1024 * 1024)],
    ['video', 'video/mp4', Buffer.from('MZ executável'), Buffer.alloc(17 * 1024 * 1024)],
    ['document', 'application/pdf', Buffer.from('MZ executável'), Buffer.alloc(101 * 1024 * 1024)],
  ] as const)('rejeita %s com assinatura falsa ou acima do limite antes do Graph', async (tipo, mimetype, assinaturaFalsa, grande) => {
    const t = montar();
    await t.svc.registrarEntrada(entrada());
    await expect(t.svc.enviarMidia(1, { tipo, arquivo: { buffer: assinaturaFalsa, mimetype, originalname: 'arquivo.bin' } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.svc.enviarMidia(1, { tipo, arquivo: { buffer: grande, mimetype, originalname: 'arquivo.bin' } })).rejects.toBeInstanceOf(BadRequestException);
    expect(t.graph.enviarMidia).not.toHaveBeenCalled();
  });

  it('rejeita MIME que não pertence à categoria antes de chamar o Graph', async () => {
    const t = montar();
    await t.svc.registrarEntrada(entrada());

    await expect(t.svc.enviarMidia(1, {
      tipo: 'image', arquivo: { buffer: Buffer.from('%PDF-1.7'), mimetype: 'application/pdf', originalname: 'falso.pdf' },
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(t.graph.enviarMidia).not.toHaveBeenCalled();
  });

  it('persiste a mídia de saída privada para reabertura após o envio', async () => {
    const media = {
      guardarSaida: jest.fn(async () => ({ chave: 'whatsapp/saida-1/00000000-0000-4000-8000-000000000001', mime: 'image/png', nome: 'portaria.png', tamanho: 8, status: 'armazenada' })),
      abrir: jest.fn(async () => ({ stream: {} })),
    };
    const t = montar(undefined, undefined, media);
    await t.svc.registrarEntrada(entrada());
    const enviada = await t.svc.enviarMidia(1, { tipo: 'image', arquivo: { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mimetype: 'image/png', originalname: 'portaria.png' } });

    await t.svc.abrirMidia(enviada.id);

    expect(media.guardarSaida).toHaveBeenCalled();
    expect(media.abrir).toHaveBeenCalledWith('whatsapp/saida-1/00000000-0000-4000-8000-000000000001', undefined);
  });

  it('remove o objeto de saída se a criação da mensagem falhar', async () => {
    const media = {
      guardarSaida: jest.fn(async () => ({ chave: 'whatsapp/saida-orfa/00000000-0000-4000-8000-000000000001', mime: 'image/png', nome: 'portaria.png', tamanho: 8, status: 'armazenada' })),
      apagar: jest.fn(async () => undefined),
    };
    const t = montar(undefined, undefined, media);
    await t.svc.registrarEntrada(entrada());
    t.prisma.crm_WhatsApp_Mensagens.create.mockRejectedValueOnce(new Error('DB indisponível'));

    await expect(t.svc.enviarMidia(1, { tipo: 'image', arquivo: { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mimetype: 'image/png', originalname: 'portaria.png' } })).rejects.toThrow('DB indisponível');

    expect(media.apagar).toHaveBeenCalledWith('whatsapp/saida-orfa/00000000-0000-4000-8000-000000000001');
  });

  it('registra mídia como falhou quando o upload ou envio Graph falha', async () => {
    const t = montar(undefined, undefined, { guardarSaida: jest.fn(async () => ({ chave: 'whatsapp/saida-falha/00000000-0000-4000-8000-000000000001', mime: 'application/pdf', nome: 'proposta.pdf', tamanho: 8, status: 'armazenada' })) });
    t.graph.enviarMidia.mockRejectedValueOnce(new Error('upload recusado'));
    await t.svc.registrarEntrada(entrada());

    const m = await t.svc.enviarMidia(1, {
      tipo: 'document', arquivo: { buffer: Buffer.from('%PDF-1.7'), mimetype: 'application/pdf', originalname: 'proposta.pdf' },
    });

    expect(m).toMatchObject({ direcao: 'saida', tipo: 'document', status: 'falhou', erro: 'upload recusado', mediaStatus: 'falhou', mediaChave: 'whatsapp/saida-falha/00000000-0000-4000-8000-000000000001' });
  });

  it('traduz intervalos suffix, aberto e inválido antes de consultar S3', async () => {
    const media = { abrir: jest.fn(async () => ({ stream: {}, mime: 'audio/ogg', nome: null, tamanho: 2, total: 6, inicio: 4, fim: 5 })) };
    const t = montar(undefined, undefined, media);
    t.msgs.push({ id: 9, wamid: 'w-range', media_chave: 'whatsapp/w-range/00000000-0000-4000-8000-000000000001', media_tamanho: 6 });

    await t.svc.abrirMidia(9, 'bytes=-2');
    await t.svc.abrirMidia(9, 'bytes=3-');
    await expect(t.svc.abrirMidia(9, 'bytes=9-')).rejects.toBeInstanceOf(RangeMidiaInvalido);

    expect(media.abrir).toHaveBeenNthCalledWith(1, expect.any(String), { inicio: 4, fim: 5 });
    expect(media.abrir).toHaveBeenNthCalledWith(2, expect.any(String), { inicio: 3, fim: 5 });
    expect(media.abrir).toHaveBeenCalledTimes(2);
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
    it('cria conversa ligada ao lead e envia a apresentação com o nome (com DDI 55)', async () => {
      const t = montar();
      t.leads.push({ id: 5, nome: 'Contato\n  Novo', whatsapp: '21999369814' });
      const r = await t.svc.iniciarConversa(5);
      expect(t.graph.enviarModelo).toHaveBeenCalledWith('5521999369814', 'apresentacao_controle_acesso', ['Contato Novo']);
      expect(t.msgs[0].texto).toMatch(/^Olá Contato Novo, tudo bem\?/);
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

    it('apresentação ainda não aprovada cai no modelo antigo', async () => {
      const t = montar();
      t.leads.push({ id: 5, nome: 'Contato', whatsapp: '5521999369814' });
      t.graph.enviarModelo.mockRejectedValueOnce(new Error('Template name does not exist'));
      const r = await t.svc.iniciarConversa(5);
      expect(t.graph.enviarModelo).toHaveBeenLastCalledWith('5521999369814', 'primeiro_contato_orcamento');
      expect(r.mensagem).toMatchObject({ status: 'enviada', texto: expect.stringContaining('Prestare Gestão') });
    });

    it('os dois modelos recusados viram mensagem com falha, sem exceção', async () => {
      const t = montar();
      t.leads.push({ id: 5, nome: 'Contato', whatsapp: '5521999369814' });
      t.graph.enviarModelo.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('Template not approved'));
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

  describe('novoContato', () => {
    it('cria lead e conversa com o nome digitado e envia o modelo', async () => {
      const t = montar();
      const r = await t.svc.novoContato({ nome: ' Síndico João ', telefone: '(17) 99660-8148', condominio: 'Res. Flores' });
      expect(t.leads[0]).toMatchObject({ nome: 'Síndico João', condominio: 'Res. Flores', whatsapp: '5517996608148', origem: 'organico' });
      expect(t.graph.enviarModelo).toHaveBeenCalledWith('5517996608148', 'apresentacao_controle_acesso', ['Síndico João']);
      expect(t.conversas[0]).toMatchObject({ wa_id: '5517996608148', nome_perfil: 'Síndico João', lead_id: 1 });
      expect(r.mensagem).toMatchObject({ tipo: 'template', status: 'enviada' });
    });

    it('número com conversa em janela aberta só devolve a conversa, sem modelo nem lead novo', async () => {
      const t = montar();
      t.conversas.push({ id: 3, wa_id: '5517996608148', lead_id: 9, nao_lidas: 0, ultima_do_cliente_em: new Date() });
      const r = await t.svc.novoContato({ nome: 'João', telefone: '17996608148' });
      expect(r).toEqual({ conversaId: 3, mensagem: null });
      expect(t.graph.enviarModelo).not.toHaveBeenCalled();
      expect(t.leads).toHaveLength(0);
    });

    it('conversa antiga com lead reaproveita o lead e reenvia o modelo', async () => {
      const t = montar();
      t.leads.push({ id: 9, nome: 'João', whatsapp: '5517996608148' });
      t.conversas.push({ id: 3, wa_id: '5517996608148', lead_id: 9, nao_lidas: 0, ultima_do_cliente_em: null });
      const r = await t.svc.novoContato({ nome: 'João', telefone: '+55 17 99660-8148' });
      expect(t.leads).toHaveLength(1);
      expect(r.conversaId).toBe(3);
      expect(t.graph.enviarModelo).toHaveBeenCalledTimes(1);
    });

    it('nome vazio ou telefone curto dá 400', async () => {
      const t = montar();
      await expect(t.svc.novoContato({ nome: '', telefone: '17996608148' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(t.svc.novoContato({ nome: 'João', telefone: '99660-8148' })).rejects.toBeInstanceOf(BadRequestException);
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

  describe('enviarMidia', () => {
    const arquivoValido: any = {
      fieldname: 'arquivo',
      originalname: 'teste.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      size: 4,
    };

    it('envia midia via Graph mesmo se o storage falhar, marcando mensagem como enviada e midia como indisponivel', async () => {
      const mediaMock = {
        guardarSaida: jest.fn().mockRejectedValue(new Error('Storage indisponivel')),
        apagar: jest.fn(),
      };
      const t = montar(undefined, undefined, mediaMock);
      t.conversas.push({
        id: 10,
        wa_id: '5517992559990',
        ultima_do_cliente_em: new Date(),
        nao_lidas: 0,
      });

      const res = await t.svc.enviarMidia(10, {
        tipo: 'image',
        arquivo: arquivoValido,
        legenda: 'Foto da proposta',
      });

      expect(t.graph.enviarMidia).toHaveBeenCalledWith(expect.objectContaining({
        para: '5517992559990',
        tipo: 'image',
        arquivo: arquivoValido,
        legenda: 'Foto da proposta',
      }));
      expect(res).toMatchObject({
        status: 'enviada',
        mediaStatus: 'indisponivel',
        tipo: 'image',
      });
      expect(t.msgs[0]).toMatchObject({
        conversa_id: 10,
        status: 'enviada',
        media_status: 'indisponivel',
        media_chave: null,
      });
    });

    it('armazena midia e envia via Graph quando storage esta disponivel', async () => {
      const mediaMock = {
        guardarSaida: jest.fn().mockResolvedValue({
          chave: 'whatsapp/saida-123/uuid',
          mime: 'image/jpeg',
          nome: 'teste.jpg',
          tamanho: 4,
          status: 'armazenada',
        }),
        apagar: jest.fn(),
      };
      const t = montar(undefined, undefined, mediaMock);
      t.conversas.push({
        id: 10,
        wa_id: '5517992559990',
        ultima_do_cliente_em: new Date(),
        nao_lidas: 0,
      });

      const res = await t.svc.enviarMidia(10, {
        tipo: 'image',
        arquivo: arquivoValido,
      });

      expect(mediaMock.guardarSaida).toHaveBeenCalled();
      expect(t.graph.enviarMidia).toHaveBeenCalled();
      expect(res).toMatchObject({
        status: 'enviada',
        mediaStatus: 'enviada',
        mediaChave: 'whatsapp/saida-123/uuid',
      });
      expect(t.msgs[0]).toMatchObject({
        media_chave: 'whatsapp/saida-123/uuid',
        media_status: 'enviada',
      });
    });
  });
});

