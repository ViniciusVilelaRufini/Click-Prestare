import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException, RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import { SKIP_AUDIT_KEY } from '../../common/interceptors/skip-audit.decorator';
import { faixaDoCorpo, LIMITE_PUBLICO_FOTO } from '../../common/limite-corpo';
import { EntregaConfigController } from './entrega-config.controller';
import { EntregaPublicoController } from './entrega-publico.controller';
import { FOTO, TOKEN_PORTAO, montarPortao } from './montar-portao.spec';

/** Rotas públicas do portão e configuração do síndico (spec 2026-11-13-entregador-autoatendimento-portao). */
describe('rotas do autoatendimento no portão', () => {
  const sindico = { sub: 30, id_condominio: 1, typeAccess: 'Sindico', nome: 'Síndico' } as any;
  // Turno é texto livre: não prova síndico.
  const porteiro = { sub: 20, id_condominio: 1, nome: 'Portaria', turno: 'Síndico' } as any;
  const sindicoOutro = { sub: 31, id_condominio: 2, typeAccess: 'Sindico', nome: 'Outro' } as any;
  const morador = { sub: 7, typeAccess: 'Morador' } as any;
  const morador7 = { sub: 7, typeAccess: 'Morador', nome: 'Ana Lima' } as any;
  const dispositivos = [
    { id: 30, id_condominio: 1, nome: 'Portão social', tipo: 'botoeira', ativo: 1, token_entrega: TOKEN_PORTAO },
    { id: 32, id_condominio: 1, nome: 'Leitor de tag', tipo: 'tag_reader', ativo: 1, token_entrega: null },
    { id: 33, id_condominio: 1, nome: 'Facial da entrada', tipo: 'facial', ativo: 1, token_entrega: null },
    { id: 40, id_condominio: 2, nome: 'Portão do outro', tipo: 'botoeira', ativo: 1, token_entrega: null },
  ];

  function montar() {
    const k = montarPortao({ dispositivos });
    return { ...k, publico: new EntregaPublicoController(k.svc), config: new EntregaConfigController(k.svc) };
  }

  const meta = (key: string, alvo: any) => Reflect.getMetadata(key, alvo);

  it('as cinco rotas públicas têm @Public, @SkipAudit e os POST respondem 200', () => {
    expect(meta(PATH_METADATA, EntregaPublicoController)).toBe('entrega/publico');
    const p = EntregaPublicoController.prototype;
    const rotas: [any, RequestMethod, string][] = [
      [p.ler, RequestMethod.GET, ':token'],
      [p.criar, RequestMethod.POST, ':token'],
      [p.consultar, RequestMethod.POST, ':token/pedido'],
      [p.abrir, RequestMethod.POST, ':token/pedido/abrir'],
      [p.sair, RequestMethod.POST, ':token/pedido/sair'],
    ];
    for (const [fn, metodo, caminho] of rotas) {
      expect(meta(IS_PUBLIC_KEY, fn)).toBe(true);
      expect(meta(SKIP_AUDIT_KEY, fn)).toBe(true);
      expect(meta(METHOD_METADATA, fn)).toBe(metodo);
      expect(meta(PATH_METADATA, fn)).toBe(caminho);
      if (metodo === RequestMethod.POST) expect(meta(HTTP_CODE_METADATA, fn)).toBe(200);
    }
    // 5 pedidos por IP a cada 10 min; 10 aberturas por IP por minuto.
    expect(meta('THROTTLER:LIMITmedium', p.criar)).toBe(5);
    expect(meta('THROTTLER:TTLmedium', p.criar)).toBe(600_000);
    for (const fn of [p.abrir, p.sair]) {
      expect(meta('THROTTLER:LIMITmedium', fn)).toBe(10);
      expect(meta('THROTTLER:TTLmedium', fn)).toBe(60_000);
    }
  });

  it('o token do pedido vai no corpo, nunca no caminho', () => {
    const p = EntregaPublicoController.prototype;
    for (const fn of [p.consultar, p.abrir, p.sair]) expect(meta(PATH_METADATA, fn)).not.toMatch(/:pedido/);
  });

  it('rotas de configuração exigem sessão (não são públicas)', () => {
    const c = EntregaConfigController.prototype;
    expect(meta(PATH_METADATA, EntregaConfigController)).toBe('entrega');
    for (const fn of [c.lerConfig, c.salvarConfig, c.gerarToken, c.removerToken]) expect(meta(IS_PUBLIC_KEY, fn)).toBeUndefined();
    expect(meta(METHOD_METADATA, c.salvarConfig)).toBe(RequestMethod.PUT);
    expect(meta(METHOD_METADATA, c.removerToken)).toBe(RequestMethod.DELETE);
    expect(meta(HTTP_CODE_METADATA, c.gerarToken)).toBe(200);
  });

  it('a página pública cabe no teto de corpo das rotas públicas com foto', () => {
    expect(faixaDoCorpo({ method: 'POST', originalUrl: `/api/entrega/publico/${TOKEN_PORTAO}`, headers: {} }, 's')).toBe(LIMITE_PUBLICO_FOTO);
    expect(LIMITE_PUBLICO_FOTO).toBeGreaterThan(2 * 1024 * 1024);
  });

  it('POST do pedido ignora campos extras do corpo (id_condominio, status)', async () => {
    const { publico, svc, tabela } = montar();
    const espiao = jest.spyOn(svc, 'criarPedido');
    await publico.criar(TOKEN_PORTAO, {
      id_apartamento: 101, nome: 'Carlos', plataforma: 'iFood', foto: FOTO,
      id_condominio: 2, status: 'liberado', id_device: 40, liberado_ate: '2099-01-01',
    } as any);
    expect(espiao).toHaveBeenCalledWith(TOKEN_PORTAO, { id_apartamento: 101, nome: 'Carlos', plataforma: 'iFood', foto: FOTO });
    expect(tabela('deliveryPedidosPortao')[0]).toMatchObject({ id_device: 30, status: 'pendente', liberado_ate: null });
    expect(tabela('deliveryAtendimentos')[0].id_condominio).toBe(1);
  });

  it('nenhuma resposta pública contém as chaves foto, id_morador_user, nome_morador, telefone', async () => {
    const { publico, delivery, tabela, avancar } = montar();
    const respostas: any[] = [];
    respostas.push(await publico.ler(TOKEN_PORTAO));
    const criado = await publico.criar(TOKEN_PORTAO, { id_apartamento: 101, nome: 'Carlos', plataforma: 'iFood', foto: FOTO });
    respostas.push(criado);
    avancar(40_000);
    await delivery.atualizarStatus(tabela('deliveryAtendimentos')[0].id, { status: 'AUTORIZADA' } as any, morador7);
    respostas.push(await publico.consultar(TOKEN_PORTAO, { pedido: criado.pedido }));
    respostas.push(await publico.abrir(TOKEN_PORTAO, { pedido: criado.pedido }));
    respostas.push(await publico.sair(TOKEN_PORTAO, { pedido: criado.pedido }));
    const proibidas = new Set(['foto', 'id_morador_user', 'nome_morador', 'telefone', 'phone', 'fcm_token', 'token_hash', 'name']);
    const varrer = (v: any, caminho: string) => {
      if (Array.isArray(v)) return v.forEach((x, i) => varrer(x, `${caminho}[${i}]`));
      if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          expect(proibidas.has(k) ? `${caminho}.${k}` : null).toBeNull();
          varrer(x, `${caminho}.${k}`);
        }
      }
    };
    respostas.forEach((r, i) => varrer(r, `resposta${i}`));
    expect(JSON.stringify(respostas)).not.toMatch(/Ana|Bruno|1199999|delivery-portao\//);
  });

  it('pedido sem token no corpo, ou com token de outro tipo: 404', async () => {
    const { publico } = montar();
    await expect(publico.consultar(TOKEN_PORTAO, {} as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(publico.abrir(TOKEN_PORTAO, { pedido: 123 } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(publico.sair(TOKEN_PORTAO, undefined as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('GET config: operador lê; morador recebe 403', async () => {
    const { config } = montar();
    expect(await config.lerConfig(1, porteiro)).toEqual({ habilitado: true, inicio: null, fim: null });
    await expect(config.lerConfig(1, morador)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('PUT config exige síndico; porteiro recebe 403', async () => {
    const { config, tabela } = montar();
    await expect(config.salvarConfig({ id_condominio: 1, habilitado: false, inicio: null, fim: null }, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tabela('condominios')[0].delivery_autoatendimento).toBe(true);
    expect(await config.salvarConfig({ id_condominio: 1, habilitado: false, inicio: '07:00', fim: '22:00' }, sindico)).toEqual({
      habilitado: false, inicio: '07:00', fim: '22:00',
    });
    expect(tabela('condominios')[0]).toMatchObject({ delivery_autoatendimento: false, delivery_auto_inicio: '07:00', delivery_auto_fim: '22:00' });
    expect(await config.salvarConfig({ id_condominio: 1, habilitado: true, inicio: null, fim: null }, sindico)).toEqual({ habilitado: true, inicio: null, fim: null });
  });

  it('PUT config com inicio sem fim, ou "25:00": 400 "Horário inválido. Use HH:MM."', async () => {
    const { config, tabela } = montar();
    const msg = new BadRequestException('Horário inválido. Use HH:MM.');
    for (const [inicio, fim] of [['07:00', null], [null, '22:00'], ['25:00', '22:00'], ['07:00', '7:30'], ['', '']] as any[]) {
      await expect(config.salvarConfig({ id_condominio: 1, habilitado: true, inicio, fim }, sindico)).rejects.toThrow(msg);
    }
    await expect(config.salvarConfig({ id_condominio: 1, habilitado: 'sim', inicio: null, fim: null } as any, sindico)).rejects.toBeInstanceOf(BadRequestException);
    expect(tabela('condominios')[0]).toMatchObject({ delivery_auto_inicio: null, delivery_auto_fim: null });
  });

  it('gerar token em leitor de tag: 400; em botoeira: token de 48 hex e url na raiz com ?entrega=<token>', async () => {
    const { config, tabela } = montar();
    await expect(config.gerarToken(32, sindico)).rejects.toThrow(new BadRequestException('Este tipo de aparelho não abre portão.'));
    const r = await config.gerarToken(30, sindico);
    expect(r.token).toMatch(/^[0-9a-f]{48}$/);
    // A hospedagem (Amplify) não serve caminho profundo para o SPA: link na raiz, como convite e passe.
    expect(r.url.endsWith(`/?entrega=${r.token}`)).toBe(true);
    expect(r.url).toMatch(/^https:\/\//);
    expect(tabela('facial_Devices').find((d) => d.id === 30).token_entrega).toBe(r.token);
    // O terminal facial também abre a própria porta.
    expect((await config.gerarToken(33, sindico)).token).toMatch(/^[0-9a-f]{48}$/);
    await expect(config.gerarToken(999, sindico)).rejects.toBeInstanceOf(NotFoundException);
    await expect(config.gerarToken(30, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gerar de novo troca o token; o antigo passa a dar 404 em GET entrega/publico/:token', async () => {
    const { config, publico } = montar();
    const primeiro = await config.gerarToken(30, sindico);
    expect((await publico.ler(primeiro.token)).portao).toBe('Portão social');
    const segundo = await config.gerarToken(30, sindico);
    expect(segundo.token).not.toBe(primeiro.token);
    await expect(publico.ler(primeiro.token)).rejects.toThrow(new NotFoundException('QR de entregas indisponível.'));
    await expect(publico.ler(TOKEN_PORTAO)).rejects.toBeInstanceOf(NotFoundException);
    expect((await publico.ler(segundo.token)).portao).toBe('Portão social');

    expect(await config.removerToken(30, sindico)).toEqual({ ok: true });
    await expect(publico.ler(segundo.token)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('síndico de outro condomínio não gera token nem altera config', async () => {
    const { config, tabela } = montar();
    await expect(config.gerarToken(30, sindicoOutro)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(config.removerToken(30, sindicoOutro)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(config.salvarConfig({ id_condominio: 1, habilitado: false, inicio: null, fim: null }, sindicoOutro)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(config.lerConfig(1, sindicoOutro)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tabela('facial_Devices').find((d) => d.id === 30).token_entrega).toBe(TOKEN_PORTAO);
    expect(tabela('condominios')[0].delivery_autoatendimento).toBe(true);
  });
});
