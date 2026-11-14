import { BadRequestException, ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import { FOTO, GIF_B64, PNG_B64, T0, TOKEN_OUTRO_PORTAO, TOKEN_PORTAO, WEBP_B64, montarPortao } from './montar-portao.spec';

/**
 * Achados da revisão de segurança do autoatendimento no portão
 * (spec 2026-11-13-entregador-autoatendimento-portao). Cada bloco reproduz
 * um defeito; a correção está no serviço.
 */

const morador7 = { sub: 7, typeAccess: 'Morador', nome: 'Ana Lima' } as any;
const entrada = { id_apartamento: 101, nome: 'Carlos', plataforma: 'iFood', foto: FOTO };
const M = 60_000;

describe('autoatendimento no portão — revisão de segurança', () => {
  describe('[1] a liberação fica presa ao pedido que o morador viu', () => {
    it('responder o card antigo depois de um pedido novo não abre o portão do pedido novo', async () => {
      const k = montarPortao();
      await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      const idAntigo = k.tabela('deliveryAtendimentos')[0].id;
      k.avancar(5 * M + 1000);
      // Outra pessoa, pelo outro portão (31), para a mesma unidade.
      await k.svc.criarPedido(TOKEN_OUTRO_PORTAO, { ...entrada, nome: 'Duda' });
      // O morador responde o card antigo (foto do Carlos, portão 30).
      await expect(k.delivery.atualizarStatus(idAntigo, { status: 'AUTORIZADA' } as any, morador7)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
    });

    it('um atendimento que já teve pedido de portão nunca recebe outro', async () => {
      const k = montarPortao();
      await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      const [a] = k.tabela('deliveryAtendimentos');
      const original = a.id_pedido_portao;
      await expect(k.delivery.vincularPedidoPortao(a.id, original + 99)).rejects.toBeInstanceOf(ConflictException);
      expect(k.tabela('deliveryAtendimentos')[0].id_pedido_portao).toBe(original);
    });

    it('a ligação pedido↔atendimento já está gravada quando o lock da unidade é solto', async () => {
      const k = montarPortao();
      const raw = k.banco.prisma.$queryRaw;
      const original = raw.getMockImplementation();
      const vistos: (number | null)[] = [];
      raw.mockImplementation(async (partes: TemplateStringsArray, ...valores: any[]) => {
        if (partes.join('?').includes('RELEASE_LOCK') && String(valores[0]).includes(':apto:')) {
          vistos.push(k.tabela('deliveryAtendimentos')[0]?.id_pedido_portao ?? null);
        }
        return original(partes, ...valores);
      });
      await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      const [p] = k.tabela('deliveryPedidosPortao');
      expect(vistos).toEqual([p.id]);
    });

    it('pedido que não é do atendimento não abre nada', async () => {
      const k = montarPortao({
        atendimentos: [
          { id: 1, id_condominio: 1, id_apartamento: 101, origem: 'autoatendimento', status: 'AGUARDANDO_AUTORIZACAO', id_pedido_portao: 50, chegou_em: new Date(T0) },
          { id: 2, id_condominio: 1, id_apartamento: 102, origem: 'autoatendimento', status: 'AGUARDANDO_AUTORIZACAO', id_pedido_portao: null, chegou_em: new Date(T0) },
        ],
        pedidos: [
          {
            id: 50, id_atendimento: 2, id_device: 31, nome: 'X', token_hash: 'f'.repeat(64), status: 'pendente',
            criado_em: new Date(T0), expira_em: new Date(T0 + 5 * M), visto_em: new Date(T0),
          },
        ],
      });
      await k.delivery.atualizarStatus(1, { status: 'AUTORIZADA' } as any, morador7);
      expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
      expect(k.tabela('deliveryPedidosPortao')[0].status).toBe('pendente');
    });
  });

  describe('[2] não reaproveita o atendimento que a portaria está atendendo', () => {
    it('unidade com atendimento CHEGOU/AGUARDANDO_AUTORIZACAO da portaria: 409, sem foto, sem pedido, sem card', async () => {
      for (const status of ['CHEGOU', 'AGUARDANDO_AUTORIZACAO']) {
        const k = montarPortao({
          atendimentos: [
            { id: 4, id_condominio: 1, id_apartamento: 101, id_morador_user: 7, origem: 'portaria', status, nome_entregador: 'Joao', id_pedido_portao: null, chegou_em: new Date(T0 - M) },
          ],
        });
        await expect(k.svc.criarPedido(TOKEN_PORTAO, entrada)).rejects.toThrow(
          new ConflictException('A portaria já está atendendo uma entrega para esta unidade. Procure a portaria.'),
        );
        expect(k.storage.uploadDataUrl).not.toHaveBeenCalled();
        expect(k.tabela('deliveryPedidosPortao')).toHaveLength(0);
        expect(k.tabela('deliveryAtendimentos')).toEqual([expect.objectContaining({ id: 4, status, id_pedido_portao: null })]);
        expect(k.card.abrirDelivery).not.toHaveBeenCalled();
      }
    });

    it('aviso AGENDADA do morador sem pedido anterior é reaproveitado', async () => {
      const k = montarPortao({
        atendimentos: [{ id: 4, id_condominio: 1, id_apartamento: 101, id_morador_user: 7, origem: 'portaria', status: 'AGENDADA', id_pedido_portao: null }],
      });
      await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      expect(k.tabela('deliveryAtendimentos')).toEqual([expect.objectContaining({ id: 4, status: 'AGUARDANDO_AUTORIZACAO', id_pedido_portao: 1 })]);
    });
  });

  describe('[3] trégua e teto por unidade; limite do portão atômico', () => {
    const MSG_TREGUA = 'Esta unidade já recusou uma entrega há pouco. Procure a portaria.';
    const status429 = async (p: Promise<unknown>) => {
      const e: any = await p.then(
        () => null,
        (x) => x,
      );
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(429);
      return e.message as string;
    };

    it.each([
      ['recusou', { status: 'RECUSADA', motivo: 'Não pedi' }],
      ['vai buscar', { status: 'RETIRADA_NA_PORTARIA' }],
    ])('morador %s: a unidade recusa pedidos novos por 10 min (429) e depois aceita', async (_nome, resposta) => {
      const k = montarPortao();
      await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      await k.delivery.atualizarStatus(k.tabela('deliveryAtendimentos')[0].id, resposta as any, morador7);
      k.avancar(9 * M);
      expect(await status429(k.svc.criarPedido(TOKEN_OUTRO_PORTAO, { ...entrada, nome: 'Duda' }))).toBe(MSG_TREGUA);
      expect(k.tabela('deliveryPedidosPortao')).toHaveLength(1);
      // Outra unidade não é afetada.
      await expect(k.svc.criarPedido(TOKEN_PORTAO, { ...entrada, id_apartamento: 102 })).resolves.toMatchObject({ situacao: 'aguardando' });
      k.avancar(M + 1000);
      await expect(k.svc.criarPedido(TOKEN_OUTRO_PORTAO, { ...entrada, nome: 'Duda' })).resolves.toMatchObject({ situacao: 'aguardando' });
    });

    it('pedido vencido sem resposta não dá trégua', async () => {
      const k = montarPortao();
      await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      k.avancar(5 * M + 1000);
      await expect(k.svc.criarPedido(TOKEN_PORTAO, entrada)).resolves.toMatchObject({ situacao: 'aguardando' });
    });

    it('7º pedido da unidade em 1 hora: 429; os de mais de 1 hora não contam', async () => {
      const antigos = (minutosAtras: number) =>
        Array.from({ length: 6 }, (_, i) => ({
          id: i + 1, id_atendimento: 500, id_device: 31, nome: 'X', token_hash: `${i}`.padStart(64, '0'),
          status: 'expirado', criado_em: new Date(T0 - minutosAtras * M), expira_em: new Date(T0 - (minutosAtras - 5) * M),
        }));
      const atendimentoVelho = { id: 500, id_condominio: 1, id_apartamento: 101, origem: 'autoatendimento', status: 'CANCELADA', id_pedido_portao: 6 };
      const k = montarPortao({ atendimentos: [atendimentoVelho], pedidos: antigos(50) });
      const msg = await status429(k.svc.criarPedido(TOKEN_PORTAO, entrada));
      expect(msg).toBe('Muitas entregas para esta unidade agora. Procure a portaria.');
      expect(k.storage.uploadDataUrl).not.toHaveBeenCalled();

      const v = montarPortao({ atendimentos: [atendimentoVelho], pedidos: antigos(61) });
      await expect(v.svc.criarPedido(TOKEN_PORTAO, entrada)).resolves.toMatchObject({ situacao: 'aguardando' });
    });

    it('limite de 20 por portão em 10 min vale com pedidos simultâneos (contagem atômica)', async () => {
      const antigos = Array.from({ length: 19 }, (_, i) => ({
        id: i + 1, id_atendimento: 999, id_device: 30, nome: 'X', token_hash: `${i}`.padStart(64, '0'),
        status: 'expirado', criado_em: new Date(T0 - 5 * M), expira_em: new Date(T0),
      }));
      const k = montarPortao({ pedidos: antigos });
      const r = await Promise.allSettled([
        k.svc.criarPedido(TOKEN_PORTAO, entrada),
        k.svc.criarPedido(TOKEN_PORTAO, { ...entrada, id_apartamento: 102 }),
      ]);
      expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
      const erro = (r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason;
      expect(erro.getStatus()).toBe(429);
      expect(k.tabela('deliveryPedidosPortao')).toHaveLength(20);
    });
  });

  describe('[4] saída só depois da entrada confirmada e 60 s depois dela', () => {
    async function liberadoSemPresenca() {
      const k = montarPortao();
      const r = await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      k.avancar(40_000);
      await k.delivery.atualizarStatus(k.tabela('deliveryAtendimentos')[0].id, { status: 'AUTORIZADA' } as any, morador7);
      return { ...k, tokenPedido: r.pedido };
    }

    it('com a entrada ainda abrindo (aparelho sem resposta): aberto_em vazio, pode_sair false e sair não abre', async () => {
      const k = await liberadoSemPresenca();
      let responder!: (v: { ok: boolean }) => void;
      k.facial.abrirDispositivoInterno.mockImplementationOnce(() => new Promise((res) => (responder = res)));
      const abrindo = k.svc.abrir(TOKEN_PORTAO, k.tokenPedido);
      await new Promise((res) => setImmediate(res));
      expect(k.tabela('deliveryPedidosPortao')[0].aberto_em).toBeNull();
      k.avancar(2 * M);
      expect(await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido)).toMatchObject({ pode_sair: false, pode_abrir: false });
      expect((await k.svc.sair(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(false);
      expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
      // Uma segunda abertura de entrada também não passa enquanto a primeira está em curso.
      expect((await k.svc.abrir(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(false);
      expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
      responder({ ok: true });
      expect((await abrindo).abriu).toBe(true);
      expect(k.tabela('deliveryPedidosPortao')[0].aberto_em).toEqual(expect.any(Date));
    });

    it('entrada que falha volta ao estado anterior: nem aberta nem abrindo; nova tentativa abre uma vez só', async () => {
      const k = await liberadoSemPresenca();
      k.facial.abrirDispositivoInterno.mockResolvedValueOnce({ ok: false });
      expect((await k.svc.abrir(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(false);
      expect(k.tabela('deliveryPedidosPortao')[0]).toMatchObject({ status: 'liberado', aberto_em: null, abrindo_em: null });
      expect(await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido)).toMatchObject({ pode_abrir: true, pode_sair: false });
      expect((await k.svc.sair(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(false);
      const [a, b] = await Promise.all([k.svc.abrir(TOKEN_PORTAO, k.tokenPedido), k.svc.abrir(TOKEN_PORTAO, k.tokenPedido)]);
      expect([a.abriu, b.abriu].sort()).toEqual([false, true]);
      expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(2);
    });

    it('saída antes de 60 s da entrada: recusada; depois de 60 s: abre', async () => {
      const k = await liberadoSemPresenca();
      expect((await k.svc.abrir(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(true);
      k.avancar(59_000);
      expect(await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido)).toMatchObject({ situacao: 'aberto', pode_sair: false });
      expect((await k.svc.sair(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(false);
      k.avancar(1000);
      expect(await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido)).toMatchObject({ pode_sair: true });
      expect((await k.svc.sair(TOKEN_PORTAO, k.tokenPedido)).abriu).toBe(true);
      expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(2);
    });
  });

  describe('[6] quem tem vínculo com a unidade e responde pelo app é morador', () => {
    async function pedidoPresente(vinculos?: any[]) {
      const k = montarPortao(vinculos ? { vinculos } : {});
      const r = await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      k.avancar(3000);
      return { ...k, tokenPedido: r.pedido, idAtendimento: k.tabela('deliveryAtendimentos')[0].id };
    }

    it.each([
      ['síndico', { sub: 9, typeAccess: 'Sindico', nome: 'Bruno Reis' }],
      ['funcionário', { sub: 9, typeAccess: 'Funcionario', nome: 'Bruno Reis' }],
    ])('%s morador da unidade libera pelo app: a nuvem abre e ele vira o dono', async (_n, user) => {
      const k = await pedidoPresente();
      await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, user as any);
      expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
      expect(k.tabela('deliveryPedidosPortao')[0]).toMatchObject({ status: 'liberado', liberado_ate: expect.any(Date) });
      expect(k.tabela('deliveryAtendimentos')[0].id_morador_user).toBe(9);
    });

    it('síndico morador da unidade pode responder "vou buscar" pelo app', async () => {
      const k = await pedidoPresente();
      await k.delivery.atualizarStatus(k.idAtendimento, { status: 'RETIRADA_NA_PORTARIA' } as any, { sub: 9, typeAccess: 'Sindico', nome: 'Bruno' } as any);
      expect(k.tabela('deliveryPedidosPortao')[0].status).toBe('vou_buscar');
    });

    it('síndico sem vínculo com a unidade (app) ou no console: liberação de portaria, a nuvem não abre', async () => {
      for (const user of [
        { sub: 50, typeAccess: 'Sindico', nome: 'Síndica' },
        { sub: 9, typeAccess: 'Sindico', nome: 'Bruno Reis', id_condominio: 1 },
      ]) {
        const k = await pedidoPresente();
        await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, user as any);
        expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
        expect(k.tabela('deliveryPedidosPortao')[0]).toMatchObject({ status: 'liberado', liberado_ate: null });
      }
    });
  });

  describe('[8] a selfie é decodificada: só JPEG, PNG ou WebP de verdade', () => {
    const MSG = 'Envie uma foto em JPEG, PNG ou WebP.';
    const jpegCortado = FOTO.slice(0, 'data:image/jpeg;base64,'.length + 200);

    it.each([
      ['bytes que não são imagem', `data:image/jpeg;base64,${'A'.repeat(4000)}`],
      ['GIF declarado como PNG', `data:image/png;base64,${GIF_B64}`],
      ['PNG declarado como JPEG', `data:image/jpeg;base64,${PNG_B64}`],
      ['JPEG cortado no meio', jpegCortado],
    ])('%s: 400 e nada gravado', async (_n, foto) => {
      const k = montarPortao();
      await expect(k.svc.criarPedido(TOKEN_PORTAO, { ...entrada, foto })).rejects.toThrow(new BadRequestException(MSG));
      expect(k.storage.uploadDataUrl).not.toHaveBeenCalled();
      expect(k.tabela('deliveryPedidosPortao')).toHaveLength(0);
      expect(k.tabela('deliveryAtendimentos')).toHaveLength(0);
    });

    it.each([
      ['JPEG', FOTO],
      ['PNG', `data:image/png;base64,${PNG_B64}`],
      ['WebP', `data:image/webp;base64,${WEBP_B64}`],
    ])('%s válido é aceito', async (_n, foto) => {
      const k = montarPortao();
      await expect(k.svc.criarPedido(TOKEN_PORTAO, { ...entrada, foto })).resolves.toMatchObject({ situacao: 'aguardando' });
    });
  });

  describe('[10] opção desligada ou fora do horário: liberar, abrir e sair recusam dali em diante', () => {
    const MSG = new ForbiddenException('Autoatendimento de entregas indisponível agora.');
    const desligar = (k: ReturnType<typeof montarPortao>) => (k.tabela('condominios')[0].delivery_autoatendimento = false);

    async function comPedido(condominio?: Record<string, unknown>) {
      const k = montarPortao(condominio ? { condominio } : {});
      const r = await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      return { ...k, tokenPedido: r.pedido, idAtendimento: k.tabela('deliveryAtendimentos')[0].id };
    }

    it('morador libera com a página presente depois de desligada: nada abre e não há janela', async () => {
      const k = await comPedido();
      desligar(k);
      k.avancar(3000);
      await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
      expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
      expect(k.tabela('deliveryPedidosPortao')[0].liberado_ate).toBeNull();
      expect(await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido)).toMatchObject({ pode_abrir: false, pode_sair: false });
    });

    it('liberado e depois desligado: consultar não oferece abrir e abrir recusa (403) sem acionar', async () => {
      const k = await comPedido();
      k.avancar(40_000);
      await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
      desligar(k);
      expect(await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido)).toMatchObject({ situacao: 'liberado', pode_abrir: false });
      await expect(k.svc.abrir(TOKEN_PORTAO, k.tokenPedido)).rejects.toThrow(MSG);
      expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
    });

    it('entrou e depois saiu do horário: consultar não oferece sair e sair recusa (403)', async () => {
      // T0 = 12:00 em Brasília; o horário acaba às 12:30.
      const k = await comPedido({ delivery_auto_inicio: '07:00', delivery_auto_fim: '12:30' });
      k.avancar(3000);
      await k.delivery.atualizarStatus(k.idAtendimento, { status: 'AUTORIZADA' } as any, morador7);
      expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
      k.avancar(31 * M);
      expect(await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido)).toMatchObject({ situacao: 'aberto', pode_sair: false });
      await expect(k.svc.sair(TOKEN_PORTAO, k.tokenPedido)).rejects.toThrow(MSG);
      expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
    });
  });
});
