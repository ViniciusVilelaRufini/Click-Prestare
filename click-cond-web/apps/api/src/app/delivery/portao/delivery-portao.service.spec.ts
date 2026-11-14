import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { DeliveryService } from '../delivery.service';
import { DeliveryPortaoService } from './delivery-portao.service';
import { criarBancoFalso } from './banco-falso.spec';
import { hashToken } from './portao-regras';

/** Pedido de portão: presença, abertura única e saída (spec 2026-11-13-entregador-autoatendimento-portao). */
export const T0 = new Date('2026-11-14T15:00:00Z').getTime();
export const TOKEN_PORTAO = 'a'.repeat(48);
export const TOKEN_OUTRO_PORTAO = 'b'.repeat(48);
export const FOTO = `data:image/jpeg;base64,${'A'.repeat(4000)}`;

export function montarPortao(
  opts: {
    condominio?: Record<string, unknown>;
    dispositivos?: any[];
    atendimentos?: any[];
    pedidos?: any[];
    vinculos?: any[];
  } = {},
) {
  let agora = T0;
  const banco = criarBancoFalso(
    {
      condominios: [
        { id: 1, nome: 'Residencial Teste', ativo: 1, delivery_autoatendimento: true, delivery_auto_inicio: null, delivery_auto_fim: null, ...(opts.condominio ?? {}) },
        { id: 2, nome: 'Outro', ativo: 1, delivery_autoatendimento: true, delivery_auto_inicio: null, delivery_auto_fim: null },
      ],
      apartamentos: [
        { id: 102, id_condominio: 1, bloco: 'A', apto: '102' },
        { id: 101, id_condominio: 1, bloco: 'A', apto: '101' },
        { id: 110, id_condominio: 1, bloco: 'A', apto: '20' },
        { id: 201, id_condominio: 1, bloco: 'B', apto: '1' },
        { id: 900, id_condominio: 2, bloco: 'Z', apto: '1' },
      ],
      users: [
        { id: 7, name: 'Ana Lima', fcm_token: 'fcm-7', phone: '11999990000' },
        { id: 9, name: 'Bruno Reis', fcm_token: 'fcm-9', phone: '11999990001' },
      ],
      apartamentos_Users: opts.vinculos ?? [
        { id: 1, id_apto: 101, id_user: 7 },
        { id: 2, id_apto: 101, id_user: 9 },
      ],
      facial_Devices: opts.dispositivos ?? [
        { id: 30, id_condominio: 1, nome: 'Portão social', tipo: 'botoeira', ativo: 1, token_entrega: TOKEN_PORTAO },
        { id: 31, id_condominio: 1, nome: 'Portão de serviço', tipo: 'catraca', ativo: 1, token_entrega: TOKEN_OUTRO_PORTAO },
      ],
      deliveryAtendimentos: opts.atendimentos ?? [],
      deliveryPedidosPortao: opts.pedidos ?? [],
      deliveryEventos: [],
      deliveryEntregadores: [],
    },
    () => new Date(agora),
  );
  const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
  const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
  let fotos = 0;
  const storage: any = {
    uploadDataUrl: jest.fn(async () => `https://bucket.s3.amazonaws.com/delivery-portao/${++fotos}.jpg`),
    deleteUrl: jest.fn(async () => true),
    exigirArquivoDoRegistro: jest.fn(async () => undefined),
  };
  const card: any = {
    abrirDelivery: jest.fn(async () => undefined),
    atualizarDelivery: jest.fn(async () => ({ cobertos: new Set<string>() })),
    encerrarDeOutros: jest.fn(async () => undefined),
    encerrar: jest.fn(async () => undefined),
  };
  const facial: any = { abrirDispositivoInterno: jest.fn(async () => ({ ok: true })) };
  const delivery = new DeliveryService(banco.prisma, notifications, tenant, storage, card);
  (delivery as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const svc = new DeliveryPortaoService(banco.prisma, delivery, facial, storage);
  (svc as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() };
  svc.agora = () => agora;
  const avancar = (ms: number) => {
    agora += ms;
  };
  return { svc, delivery, banco, tabela: banco.tabela, storage, card, facial, notifications, avancar };
}

const morador7 = { sub: 7, typeAccess: 'Morador', nome: 'Ana Lima' } as any;
const porteiro = { sub: 20, id_condominio: 1, nome: 'Portaria' } as any;
const entrada = { id_apartamento: 101, nome: 'Carlos', plataforma: 'iFood', foto: FOTO };

describe('DeliveryPortaoService', () => {
  it('lerPortao devolve só id, bloco e apto das unidades, e nenhuma outra chave', async () => {
    const { svc } = montarPortao();
    const p = await svc.lerPortao(TOKEN_PORTAO);
    expect(Object.keys(p).sort()).toEqual(['condominio', 'disponivel', 'portao', 'unidades']);
    expect(p).toMatchObject({ condominio: 'Residencial Teste', portao: 'Portão social', disponivel: true });
    // Ordem numérica por bloco e apto; só o condomínio do aparelho.
    expect(p.unidades).toEqual([
      { id: 110, bloco: 'A', apto: '20' },
      { id: 101, bloco: 'A', apto: '101' },
      { id: 102, bloco: 'A', apto: '102' },
      { id: 201, bloco: 'B', apto: '1' },
    ]);
    for (const u of p.unidades) expect(Object.keys(u).sort()).toEqual(['apto', 'bloco', 'id']);
    expect(JSON.stringify(p)).not.toMatch(/Ana|Bruno|fcm|1199999/);
  });

  it('lerPortao com a opção desligada: disponivel false, motivo "desligado", unidades vazias', async () => {
    const { svc } = montarPortao({ condominio: { delivery_autoatendimento: false } });
    expect(await svc.lerPortao(TOKEN_PORTAO)).toEqual({
      condominio: 'Residencial Teste',
      portao: 'Portão social',
      disponivel: false,
      motivo: 'desligado',
      unidades: [],
    });
  });

  it('lerPortao fora do horário: motivo "fora_horario" e o horário configurado', async () => {
    // T0 = 12:00 em Brasília.
    const { svc } = montarPortao({ condominio: { delivery_auto_inicio: '18:00', delivery_auto_fim: '23:00' } });
    expect(await svc.lerPortao(TOKEN_PORTAO)).toEqual({
      condominio: 'Residencial Teste',
      portao: 'Portão social',
      disponivel: false,
      motivo: 'fora_horario',
      horario: { inicio: '18:00', fim: '23:00' },
      unidades: [],
    });
    const dentro = montarPortao({ condominio: { delivery_auto_inicio: '07:00', delivery_auto_fim: '23:00' } });
    expect(await dentro.svc.lerPortao(TOKEN_PORTAO)).toMatchObject({ disponivel: true, horario: { inicio: '07:00', fim: '23:00' } });
  });

  it('token de portão desconhecido, aparelho inativo ou condomínio inativo: 404', async () => {
    const msg = new NotFoundException('QR de entregas indisponível.');
    await expect(montarPortao().svc.lerPortao('c'.repeat(48))).rejects.toThrow(msg);
    await expect(montarPortao().svc.lerPortao('../x')).rejects.toThrow(msg);
    const inativo = montarPortao({ dispositivos: [{ id: 30, id_condominio: 1, nome: 'P', tipo: 'botoeira', ativo: 0, token_entrega: TOKEN_PORTAO }] });
    await expect(inativo.svc.lerPortao(TOKEN_PORTAO)).rejects.toThrow(msg);
    const condInativo = montarPortao({ condominio: { ativo: 0 } });
    await expect(condInativo.svc.lerPortao(TOKEN_PORTAO)).rejects.toThrow(msg);
  });

  it('criarPedido grava pedido pendente, sobe a foto em delivery-portao e devolve o token (64 hex) uma vez', async () => {
    const { svc, tabela, storage, card } = montarPortao();
    const r = await svc.criarPedido(TOKEN_PORTAO, entrada);
    expect(r.pedido).toMatch(/^[0-9a-f]{64}$/);
    expect(r).toMatchObject({ situacao: 'aguardando', pode_abrir: false, pode_sair: false, liberado_ate: null });
    expect(storage.uploadDataUrl).toHaveBeenCalledWith(FOTO, 'delivery-portao');
    const [p] = tabela('deliveryPedidosPortao');
    expect(p).toMatchObject({
      id_device: 30,
      nome: 'Carlos',
      plataforma: 'iFood',
      foto: 'https://bucket.s3.amazonaws.com/delivery-portao/1.jpg',
      status: 'pendente',
      token_hash: hashToken(r.pedido),
    });
    expect(p.expira_em.getTime() - T0).toBe(5 * 60_000);
    expect(p.visto_em.getTime()).toBe(T0);
    // O token em claro nunca é gravado.
    expect(JSON.stringify(tabela('deliveryPedidosPortao'))).not.toContain(r.pedido);
    const [a] = tabela('deliveryAtendimentos');
    expect(a).toMatchObject({ origem: 'autoatendimento', id_pedido_portao: p.id, status: 'AGUARDANDO_AUTORIZACAO' });
    expect(card.abrirDelivery).toHaveBeenCalledTimes(1);
  });

  it('criarPedido: a resposta não contém foto, nome de morador nem id de usuário', async () => {
    const { svc } = montarPortao();
    const r = await svc.criarPedido(TOKEN_PORTAO, entrada);
    expect(Object.keys(r).sort()).toEqual(['liberado_ate', 'pedido', 'pode_abrir', 'pode_sair', 'situacao']);
    expect(JSON.stringify(r)).not.toMatch(/Ana|Bruno|foto|id_/);
  });

  it('opção desligada ou fora do horário em criarPedido: 403 e nada gravado', async () => {
    const msg = new ForbiddenException('Autoatendimento de entregas indisponível agora.');
    const deslig = montarPortao({ condominio: { delivery_autoatendimento: false } });
    await expect(deslig.svc.criarPedido(TOKEN_PORTAO, entrada)).rejects.toThrow(msg);
    const fora = montarPortao({ condominio: { delivery_auto_inicio: '18:00', delivery_auto_fim: '23:00' } });
    await expect(fora.svc.criarPedido(TOKEN_PORTAO, entrada)).rejects.toThrow(msg);
    for (const k of [deslig, fora]) {
      expect(k.tabela('deliveryPedidosPortao')).toHaveLength(0);
      expect(k.storage.uploadDataUrl).not.toHaveBeenCalled();
    }
  });

  it('segundo pedido para a mesma unidade com um pendente: 409 e nada gravado', async () => {
    const { svc, tabela, storage } = montarPortao();
    await svc.criarPedido(TOKEN_PORTAO, entrada);
    // Outra pessoa, e por outro portão.
    await expect(svc.criarPedido(TOKEN_OUTRO_PORTAO, { ...entrada, nome: 'Duda' })).rejects.toThrow(
      new ConflictException('Já há uma entrega aguardando esta unidade. Tente em alguns minutos.'),
    );
    expect(tabela('deliveryPedidosPortao')).toHaveLength(1);
    expect(storage.uploadDataUrl).toHaveBeenCalledTimes(1);
  });

  it('[RF 1] dois criarPedido simultâneos para a mesma unidade: um 200 e um 409', async () => {
    const { svc, tabela } = montarPortao();
    const r = await Promise.allSettled([
      svc.criarPedido(TOKEN_PORTAO, entrada),
      svc.criarPedido(TOKEN_OUTRO_PORTAO, { ...entrada, nome: 'Duda' }),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    const erro = (r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason;
    expect(erro).toBeInstanceOf(ConflictException);
    expect(tabela('deliveryPedidosPortao')).toHaveLength(1);
    expect(tabela('deliveryAtendimentos')).toHaveLength(1);
  });

  it('pedido pendente vencido não bloqueia: o novo entra no mesmo atendimento e o card reabre', async () => {
    const { svc, tabela, card, avancar } = montarPortao();
    await svc.criarPedido(TOKEN_PORTAO, entrada);
    avancar(5 * 60_000 + 1000);
    const r = await svc.criarPedido(TOKEN_OUTRO_PORTAO, { ...entrada, nome: 'Duda' });
    expect(r.situacao).toBe('aguardando');
    const [velho, novo] = tabela('deliveryPedidosPortao');
    expect(velho.status).toBe('expirado');
    expect(novo).toMatchObject({ status: 'pendente', id_device: 31, nome: 'Duda' });
    expect(tabela('deliveryAtendimentos')).toHaveLength(1);
    expect(tabela('deliveryAtendimentos')[0].id_pedido_portao).toBe(novo.id);
    expect(card.abrirDelivery).toHaveBeenCalledTimes(2);
    expect(card.abrirDelivery.mock.calls[1][0]).toMatchObject({ entregadorNome: 'Duda', portao: true });
  });

  it('[RF 5] unidade de outro condomínio, nome vazio, foto vazia, foto text/html, foto de 3 MB: 400 e nada gravado', async () => {
    const casos: [any, string][] = [
      [{ ...entrada, id_apartamento: 900 }, 'Unidade inválida.'],
      [{ ...entrada, id_apartamento: 99999 }, 'Unidade inválida.'],
      [{ ...entrada, id_apartamento: 'abc' }, 'Unidade inválida.'],
      [{ ...entrada, nome: ' ' }, 'Informe seu nome.'],
      [{ ...entrada, nome: 'C' }, 'Informe seu nome.'],
      [{ ...entrada, nome: 'x'.repeat(81) }, 'Informe seu nome.'],
      [{ ...entrada, foto: '' }, 'Envie uma foto do seu rosto.'],
      [{ ...entrada, foto: undefined }, 'Envie uma foto do seu rosto.'],
      [{ ...entrada, foto: 'data:image/jpeg;base64,' }, 'Envie uma foto do seu rosto.'],
      [{ ...entrada, foto: 'data:text/html;base64,PHNjcmlwdD4=' }, 'Envie uma foto em JPEG, PNG ou WebP.'],
      [{ ...entrada, foto: 'https://evil.example/x.jpg' }, 'Envie uma foto em JPEG, PNG ou WebP.'],
      [{ ...entrada, foto: `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}` }, 'Foto muito grande. Tente novamente.'],
    ];
    for (const [d, msg] of casos) {
      const { svc, tabela, storage } = montarPortao();
      await expect(svc.criarPedido(TOKEN_PORTAO, d)).rejects.toThrow(new BadRequestException(msg));
      expect(tabela('deliveryPedidosPortao')).toHaveLength(0);
      expect(tabela('deliveryAtendimentos')).toHaveLength(0);
      expect(storage.uploadDataUrl).not.toHaveBeenCalled();
    }
  });

  it('upload recusado (null): 400 de formato e nada gravado; storage fora (data URL de volta): 503', async () => {
    const recusado = montarPortao();
    recusado.storage.uploadDataUrl.mockResolvedValueOnce(null);
    await expect(recusado.svc.criarPedido(TOKEN_PORTAO, entrada)).rejects.toThrow(new BadRequestException('Envie uma foto em JPEG, PNG ou WebP.'));
    expect(recusado.tabela('deliveryAtendimentos')).toHaveLength(0);

    const fora = montarPortao();
    fora.storage.uploadDataUrl.mockResolvedValueOnce(FOTO);
    await expect(fora.svc.criarPedido(TOKEN_PORTAO, entrada)).rejects.toMatchObject({ status: 503 });
    expect(fora.tabela('deliveryPedidosPortao')).toHaveLength(0);
    expect(fora.tabela('deliveryAtendimentos')).toHaveLength(0);
  });

  it('21º pedido no mesmo portão em 10 min: 429', async () => {
    const antigos = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1, id_atendimento: 999, id_device: 30, nome: 'X', token_hash: `${i}`.padStart(64, '0'),
      status: 'expirado', criado_em: new Date(T0 - 9 * 60_000), expira_em: new Date(T0 - 4 * 60_000),
    }));
    const { svc, storage } = montarPortao({ pedidos: antigos });
    const e = await svc.criarPedido(TOKEN_PORTAO, entrada).catch((x) => x);
    expect(e).toBeInstanceOf(HttpException);
    expect(e.getStatus()).toBe(429);
    expect(e.message).toBe('Muitos pedidos neste portão. Aguarde alguns minutos.');
    expect(storage.uploadDataUrl).not.toHaveBeenCalled();

    // Os de 11 min atrás não contam.
    const velhos = montarPortao({ pedidos: antigos.map((p) => ({ ...p, criado_em: new Date(T0 - 11 * 60_000) })) });
    await expect(velhos.svc.criarPedido(TOKEN_PORTAO, entrada)).resolves.toMatchObject({ situacao: 'aguardando' });
  });

  async function comPedido(k = montarPortao()) {
    const r = await k.svc.criarPedido(TOKEN_PORTAO, entrada);
    const idAtendimento = k.tabela('deliveryAtendimentos')[0].id;
    return { ...k, tokenPedido: r.pedido, idAtendimento };
  }

  it('morador libera com a página presente (visto há 3 s): abre o id_device do pedido uma vez', async () => {
    const k = await comPedido();
    k.avancar(3000);
    await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
    expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledWith(30, {
      origem: 'delivery_portao',
      tipoPessoa: 'entregador',
      idPessoa: null,
      nomePessoa: 'Carlos',
      credencial: `delivery:${k.idAtendimento}`,
    });
    const [p] = k.tabela('deliveryPedidosPortao');
    expect(p.status).toBe('liberado');
    expect(p.aberto_em.getTime()).toBe(T0 + 3000);
    expect(p.liberado_ate.getTime()).toBe(T0 + 3000 + 3 * 60_000);
    const c = await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido);
    expect(c).toMatchObject({ situacao: 'aberto', pode_sair: true, falha_abertura: false });
    // Abrir de novo não aciona.
    expect((await k.svc.abrir(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(false);
    expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
  });

  it('morador libera com a página ausente (visto há 40 s): não abre; consultar devolve pode_abrir true', async () => {
    const k = await comPedido();
    k.avancar(40_000);
    await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
    const c = await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido);
    expect(c).toEqual({
      situacao: 'liberado',
      pode_abrir: true,
      pode_sair: false,
      liberado_ate: new Date(T0 + 40_000 + 3 * 60_000).toISOString(),
      falha_abertura: false,
    });
    expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('abrir dentro da janela abre uma vez; a segunda chamada devolve abriu:false', async () => {
    const k = await comPedido();
    k.avancar(40_000);
    await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    k.avancar(60_000);
    const [a, b] = await Promise.all([k.svc.abrir(TOKEN_PORTAO, k.tokenPedido), k.svc.abrir(TOKEN_PORTAO, k.tokenPedido)]);
    expect([a.abriu, b.abriu].sort()).toEqual([false, true]);
    expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
    expect((await k.svc.abrir(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(false);
    expect(a.situacao).toBe('aberto');
  });

  it('abrir depois de liberado_ate: abriu false, situacao "expirado"', async () => {
    const k = await comPedido();
    k.avancar(40_000);
    await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    k.avancar(3 * 60_000 + 1000);
    const r = await k.svc.abrir(TOKEN_PORTAO, k.tokenPedido);
    expect(r).toMatchObject({ abriu: false, situacao: 'expirado', pode_abrir: false });
    expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('[RF 3] abertura falha: abriu false, falha_abertura true, e nova tentativa dentro da janela abre', async () => {
    const k = await comPedido();
    k.facial.abrirDispositivoInterno.mockResolvedValueOnce({ ok: false, erro: 'Agente offline' });
    k.avancar(2000);
    await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    let c = await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido);
    expect(c).toMatchObject({ situacao: 'liberado', pode_abrir: true, falha_abertura: true });

    k.facial.abrirDispositivoInterno.mockResolvedValueOnce({ ok: false, erro: 'Agente offline' });
    const r1 = await k.svc.abrir(TOKEN_PORTAO, k.tokenPedido);
    expect(r1).toMatchObject({ abriu: false, situacao: 'liberado', pode_abrir: true });

    k.avancar(30_000);
    const r2 = await k.svc.abrir(TOKEN_PORTAO, k.tokenPedido);
    expect(r2).toMatchObject({ abriu: true, situacao: 'aberto' });
    c = await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido);
    expect(c.falha_abertura).toBe(false);
    expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(3);

    // Depois da janela, falha não dá nova chance.
    const j = await comPedido();
    j.avancar(40_000);
    await j.delivery.atualizarStatus(j.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    j.facial.abrirDispositivoInterno.mockResolvedValueOnce({ ok: false });
    expect((await j.svc.abrir(TOKEN_PORTAO, j.tokenPedido)).abriu).toBe(false);
    j.avancar(3 * 60_000 + 1000);
    expect((await j.svc.abrir(TOKEN_PORTAO, j.tokenPedido)).abriu).toBe(false);
    expect(j.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
  });

  it('[RF 2] morador libera pedido já vencido: nada abre e liberado_ate continua nulo', async () => {
    const k = await comPedido();
    k.avancar(5 * 60_000 + 1000);
    // A página ainda está aberta, mas o pedido venceu.
    await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido);
    const r = await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    expect(r.status).toBe('AUTORIZADA');
    const [p] = k.tabela('deliveryPedidosPortao');
    expect(p.status).toBe('expirado');
    expect(p.liberado_ate).toBeNull();
    expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
    expect((await k.svc.abrir(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(false);

    // Vencido mas ainda marcado como pendente (sem consulta nem rotina).
    const s = await comPedido();
    s.avancar(5 * 60_000 + 1000);
    await s.delivery.atualizarStatus(s.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    expect(s.tabela('deliveryPedidosPortao')[0]).toMatchObject({ status: 'expirado', liberado_ate: null });
    expect(s.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('operador autoriza: situacao "liberado_portaria" e a nuvem não abre', async () => {
    const k = await comPedido();
    k.avancar(2000);
    await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, porteiro);
    expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
    const c = await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido);
    expect(c).toMatchObject({ situacao: 'liberado_portaria', pode_abrir: false });
    expect((await k.svc.abrir(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(false);
    expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('vou buscar: situacao "vou_buscar"; recusa: "recusado"', async () => {
    const k = await comPedido();
    await k.delivery.atualizarStatus(k.idAtendimento, { status: 'RETIRADA_NA_PORTARIA' } as any, morador7);
    expect((await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido)).situacao).toBe('vou_buscar');

    const r = await comPedido();
    await r.delivery.atualizarStatus(r.idAtendimento, { status: 'RECUSADA', motivo: 'Recusado pelo morador' } as any, morador7);
    expect((await r.svc.consultar(TOKEN_PORTAO, r.tokenPedido)).situacao).toBe('recusado');
    expect(r.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('sair abre o mesmo aparelho uma vez, até 30 min após a entrada, e conclui o atendimento', async () => {
    const k = await comPedido();
    k.avancar(2000);
    await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    k.avancar(10 * 60_000);
    const s = await k.svc.sair(TOKEN_PORTAO, k.tokenPedido);
    expect(s).toMatchObject({ abriu: true, situacao: 'aberto', pode_sair: false });
    expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(2);
    expect(k.facial.abrirDispositivoInterno.mock.calls[1][0]).toBe(30);
    expect(k.tabela('deliveryAtendimentos')[0].status).toBe('CONCLUIDA');
    expect(k.tabela('deliveryEventos').at(-1)).toMatchObject({ status_novo: 'CONCLUIDA', autor_nome: 'Sistema', mensagem: 'Concluído na saída do entregador' });
    expect((await k.svc.sair(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(false);
    expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(2);

    // Depois de 30 min, não.
    const t = await comPedido();
    t.avancar(2000);
    await t.delivery.atualizarStatus(t.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    t.avancar(30 * 60_000 + 1000);
    expect((await t.svc.sair(TOKEN_PORTAO, t.tokenPedido)).abriu).toBe(false);
    expect(t.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);

    // Antes de entrar, não.
    const n = await comPedido();
    expect((await n.svc.sair(TOKEN_PORTAO, n.tokenPedido)).abriu).toBe(false);
    expect(n.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('saída que falha não conclui e deixa tentar de novo', async () => {
    const k = await comPedido();
    k.avancar(2000);
    await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    k.facial.abrirDispositivoInterno.mockResolvedValueOnce({ ok: false });
    expect(await k.svc.sair(TOKEN_PORTAO, k.tokenPedido)).toMatchObject({ abriu: false, pode_sair: true });
    expect(k.tabela('deliveryAtendimentos')[0].status).toBe('AUTORIZADA');
    expect((await k.svc.sair(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(true);
  });

  it('token de pedido de outro portão, ou inexistente: 404', async () => {
    const k = await comPedido();
    const msg = new NotFoundException('Pedido não encontrado.');
    await expect(k.svc.consultar(TOKEN_OUTRO_PORTAO, k.tokenPedido)).rejects.toThrow(msg);
    await expect(k.svc.consultar(TOKEN_PORTAO, 'f'.repeat(64))).rejects.toThrow(msg);
    await expect(k.svc.consultar(TOKEN_PORTAO, 'curto')).rejects.toThrow(msg);
    await expect(k.svc.abrir(TOKEN_OUTRO_PORTAO, k.tokenPedido)).rejects.toThrow(msg);
    await expect(k.svc.sair(TOKEN_OUTRO_PORTAO, k.tokenPedido)).rejects.toThrow(msg);
  });

  it('a abertura sempre usa o id_device do pedido, mesmo com outro portão no token da URL', async () => {
    const k = await comPedido();
    k.avancar(40_000);
    await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    await expect(k.svc.abrir(TOKEN_OUTRO_PORTAO, k.tokenPedido)).rejects.toBeInstanceOf(NotFoundException);
    expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
    await k.svc.abrir(TOKEN_PORTAO, k.tokenPedido);
    expect(k.facial.abrirDispositivoInterno.mock.calls.map((c: any[]) => c[0])).toEqual([30]);
  });

  it('consultar com a opção desligada no meio do pedido continua respondendo', async () => {
    const k = await comPedido();
    k.tabela('condominios')[0].delivery_autoatendimento = false;
    await expect(k.svc.consultar(TOKEN_PORTAO, k.tokenPedido)).resolves.toMatchObject({ situacao: 'aguardando' });
  });

  it('respostas públicas não têm foto, nome de morador nem ids', async () => {
    const k = await comPedido();
    k.avancar(40_000);
    await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
    for (const r of [
      await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido),
      await k.svc.abrir(TOKEN_PORTAO, k.tokenPedido),
      await k.svc.sair(TOKEN_PORTAO, k.tokenPedido),
    ]) {
      expect(JSON.stringify(r)).not.toMatch(/foto|Ana|Bruno|id_|Carlos/);
    }
  });
});
