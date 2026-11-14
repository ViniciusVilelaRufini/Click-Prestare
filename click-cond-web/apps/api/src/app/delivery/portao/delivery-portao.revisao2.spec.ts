import { HttpException } from '@nestjs/common';
import { FOTO, T0, TOKEN_PORTAO, montarPortao } from './montar-portao.spec';

/**
 * Segunda revisão do autoatendimento no portão
 * (spec 2026-11-13-entregador-autoatendimento-portao). Cada bloco reproduz
 * um achado; a correção está nos serviços.
 */

const entrada = { id_apartamento: 101, nome: 'Carlos', plataforma: 'iFood', foto: FOTO };
const M = 60_000;
const MSG_LIMITE_PORTAO = 'Muitos pedidos neste portão. Aguarde alguns minutos.';
const LOCK_PORTAO_30 = 'prestare:delivery-portao:portao:30';

async function erroDe(p: Promise<unknown>): Promise<any> {
  return p.then(
    () => null,
    (e) => e,
  );
}

const getLocks = (k: ReturnType<typeof montarPortao>) =>
  (k.banco.prisma.$queryRaw.mock.calls as any[]).filter((c) => (c[0] as string[]).join('?').includes('GET_LOCK'));

describe('autoatendimento no portão — segunda revisão', () => {
  describe('[1] pedidos simultâneos não esgotam o pool de conexões', () => {
    it('portão acima do limite: 429 sem pegar lock nenhum', async () => {
      const antigos = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1, id_atendimento: 999, id_device: 30, nome: 'X', token_hash: `${i}`.padStart(64, '0'),
        status: 'expirado', criado_em: new Date(T0 - 5 * M), expira_em: new Date(T0),
      }));
      const k = montarPortao({ pedidos: antigos });
      const e = await erroDe(k.svc.criarPedido(TOKEN_PORTAO, entrada));
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(429);
      expect(e.message).toBe(MSG_LIMITE_PORTAO);
      expect(getLocks(k)).toHaveLength(0);
    });

    it('lock do portão preso em outra instância: 429 em até ~2 s, sem GET_LOCK parado segurando transação', async () => {
      const k = montarPortao();
      const soltar = k.banco.segurarLock(LOCK_PORTAO_30);
      let maxEsperando = 0;
      const amostra = setInterval(() => (maxEsperando = Math.max(maxEsperando, k.banco.estado.esperandoGetLock)), 20);
      const inicio = Date.now();
      const e = await erroDe(k.svc.criarPedido(TOKEN_PORTAO, entrada));
      const levou = Date.now() - inicio;
      clearInterval(amostra);
      soltar();
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(429);
      expect(e.message).toBe(MSG_LIMITE_PORTAO);
      expect(levou).toBeLessThan(3000);
      // A espera é feita fora da transação: tentativas sem espera no GET_LOCK.
      expect(maxEsperando).toBe(0);
      expect(getLocks(k).every((c) => Number(c[2]) === 0)).toBe(true);
      expect(k.tabela('deliveryPedidosPortao')).toHaveLength(0);
    }, 15_000);

    it('no máximo 3 pedidos em andamento por portão nesta instância: o 4º recebe 429 na hora', async () => {
      const k = montarPortao();
      const presos: (() => void)[] = [];
      let n = 0;
      k.storage.uploadDataUrl.mockImplementation(
        () => new Promise((res) => presos.push(() => res(`https://bucket.s3.amazonaws.com/delivery-portao/${++n}.jpg`))),
      );
      const unidades = [101, 102, 110, 201];
      const chamadas = unidades.map((id) => k.svc.criarPedido(TOKEN_PORTAO, { ...entrada, id_apartamento: id }));
      const estados = chamadas.map((p) => {
        const s = { feito: false, erro: null as any };
        p.then(
          () => (s.feito = true),
          (e) => ((s.feito = true), (s.erro = e)),
        );
        return s;
      });
      // Tempo de os quatro chegarem (selfie decodificada, contagem).
      for (let i = 0; i < 50 && !estados.some((s) => s.feito); i++) await new Promise((r) => setTimeout(r, 10));
      const recusados = estados.filter((s) => s.feito && s.erro);
      expect(recusados).toHaveLength(1);
      expect(recusados[0].erro.getStatus()).toBe(429);
      expect(recusados[0].erro.message).toBe(MSG_LIMITE_PORTAO);
      // Os outros três terminam quando o upload anda.
      for (let i = 0; i < 300 && estados.filter((s) => s.feito).length < 4; i++) {
        presos.splice(0).forEach((f) => f());
        await new Promise((r) => setTimeout(r, 10));
      }
      const r = await Promise.allSettled(chamadas);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(3);
      expect(k.tabela('deliveryPedidosPortao')).toHaveLength(3);
    }, 15_000);
  });

  describe('[2] aviso AGENDADA antigo não é reaproveitado; a nuvem só abre para vínculo atual', () => {
    const H = 3_600_000;
    const aviso = (extra: Record<string, unknown> = {}) => ({
      id: 4, id_condominio: 1, id_apartamento: 101, id_morador_user: 7, origem: 'portaria', status: 'AGENDADA',
      id_pedido_portao: null, created_at: new Date(T0 - H), previsao_em: null, ...extra,
    });
    const reaproveitou = (k: ReturnType<typeof montarPortao>) =>
      k.tabela('deliveryAtendimentos').find((a: any) => a.id === 4).status === 'AGUARDANDO_AUTORIZACAO';

    it('aviso criado há mais de 24 h fica como está: o portão cria outro atendimento', async () => {
      const k = montarPortao({ atendimentos: [aviso({ created_at: new Date(T0 - 25 * H) })] });
      await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      expect(reaproveitou(k)).toBe(false);
      expect(k.tabela('deliveryAtendimentos')).toHaveLength(2);
      const novo = k.tabela('deliveryAtendimentos').find((a: any) => a.id !== 4);
      expect(novo).toMatchObject({ origem: 'autoatendimento', id_morador_user: null, id_pedido_portao: 1 });
    });

    it('com previsão de chegada: só reaproveita dentro de ±6 h dela', async () => {
      const longe = montarPortao({ atendimentos: [aviso({ previsao_em: new Date(T0 + 7 * H) })] });
      await longe.svc.criarPedido(TOKEN_PORTAO, entrada);
      expect(reaproveitou(longe)).toBe(false);
      const passou = montarPortao({ atendimentos: [aviso({ created_at: new Date(T0 - 20 * H), previsao_em: new Date(T0 - 7 * H) })] });
      await passou.svc.criarPedido(TOKEN_PORTAO, entrada);
      expect(reaproveitou(passou)).toBe(false);
      const perto = montarPortao({ atendimentos: [aviso({ previsao_em: new Date(T0 + 5 * H) })] });
      await perto.svc.criarPedido(TOKEN_PORTAO, entrada);
      expect(reaproveitou(perto)).toBe(true);
    });

    it('dono do aviso sem vínculo atual com a unidade libera: a nuvem não abre', async () => {
      const k = montarPortao({ atendimentos: [aviso({ id_morador_user: 50 })] });
      await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      expect(reaproveitou(k)).toBe(true);
      k.avancar(3000);
      await k.delivery.atualizarStatus(4, { status: 'AUTORIZADA' } as any, { sub: 50, typeAccess: 'Morador', nome: 'Ex' } as any);
      expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
      expect(k.tabela('deliveryPedidosPortao')[0]).toMatchObject({ status: 'liberado', liberado_ate: null });
    });

    it('morador com vínculo atual libera o aviso reaproveitado: a nuvem abre', async () => {
      const k = montarPortao({ atendimentos: [aviso()] });
      await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      k.avancar(3000);
      await k.delivery.atualizarStatus(4, { status: 'AUTORIZADA' } as any, { sub: 9, typeAccess: 'Morador', nome: 'Bruno' } as any);
      expect(k.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(1);
    });

    it('aviso reaproveitado: o card com a selfie vai a todos os vínculos atuais (e não ao dono desvinculado)', async () => {
      for (const [dono, esperados] of [
        [7, [7, 9]],
        [50, [7, 9]],
      ] as const) {
        const k = montarPortao({ atendimentos: [aviso({ id_morador_user: dono })] });
        await k.svc.criarPedido(TOKEN_PORTAO, entrada);
        expect(k.card.abrirDelivery).toHaveBeenCalledTimes(1);
        const [a, ids] = k.card.abrirDelivery.mock.calls[0];
        expect([...ids].sort()).toEqual(esperados);
        expect(a).toMatchObject({ portao: true, fotoEntregador: expect.stringContaining('delivery-portao/') });
        // O card já avisa quem não tem card: nenhuma notificação a mais.
        expect(k.notifications.sendPushNotification).not.toHaveBeenCalled();
      }
    });
  });

  describe('[3] pedido vencido: card final "Entregador não esperou" e resposta 409', () => {
    const morador7 = { sub: 7, typeAccess: 'Morador', nome: 'Ana Lima' } as any;
    const MSG = 'O entregador não está mais no portão.';

    async function vencido() {
      const k = montarPortao();
      const r = await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      k.avancar(5 * M + 1000);
      return { ...k, tokenPedido: r.pedido, id: k.tabela('deliveryAtendimentos')[0].id };
    }

    it('rotina vence o pedido e leva o card ao estado final', async () => {
      const k = await vencido();
      await k.svc.tick();
      expect(k.tabela('deliveryPedidosPortao')[0].status).toBe('expirado');
      expect(k.card.entregadorNaoEsperou).toHaveBeenCalledTimes(1);
      expect(k.card.entregadorNaoEsperou).toHaveBeenCalledWith(expect.objectContaining({ id: k.id, status: 'AGUARDANDO_AUTORIZACAO' }));
      await k.svc.tick();
      expect(k.card.entregadorNaoEsperou).toHaveBeenCalledTimes(1);
    });

    it('consulta da página que encontra o pedido vencido também leva o card ao estado final (uma vez)', async () => {
      const k = await vencido();
      expect(await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido)).toMatchObject({ situacao: 'expirado' });
      await k.svc.consultar(TOKEN_PORTAO, k.tokenPedido);
      expect(k.card.entregadorNaoEsperou).toHaveBeenCalledTimes(1);
    });

    it.each([['AUTORIZADA'], ['RETIRADA_NA_PORTARIA']])(
      'morador responde %s ao pedido vencido: 409 "O entregador não está mais no portão." e nada muda',
      async (status) => {
        for (const rotinaAntes of [false, true]) {
          const k = await vencido();
          if (rotinaAntes) await k.svc.tick();
          const e = await erroDe(k.delivery.atualizarStatus(k.id, { status } as any, morador7));
          expect(e?.getStatus?.()).toBe(409);
          expect(e.message).toBe(MSG);
          expect(k.tabela('deliveryAtendimentos')[0]).toMatchObject({ status: 'AGUARDANDO_AUTORIZACAO', autorizado_em: null });
          expect(k.tabela('deliveryPedidosPortao')[0]).toMatchObject({ status: 'expirado', liberado_ate: null, respondido_em: null });
          expect(k.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
          expect(k.card.entregadorNaoEsperou).toHaveBeenCalled();
        }
      },
    );

    it('recusar o pedido vencido continua valendo', async () => {
      const k = await vencido();
      await k.delivery.atualizarStatus(k.id, { status: 'RECUSADA', motivo: 'Não pedi' } as any, morador7);
      expect(k.tabela('deliveryAtendimentos')[0].status).toBe('RECUSADA');
    });
  });

  describe('[4] a foto sobe antes dos locks; dentro deles só banco', () => {
    it('upload sem nenhum lock preso', async () => {
      const k = montarPortao();
      const durante: string[][] = [];
      k.storage.uploadDataUrl.mockImplementation(async () => {
        durante.push(k.banco.locksPresos());
        return 'https://bucket.s3.amazonaws.com/delivery-portao/1.jpg';
      });
      await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      expect(durante).toEqual([[]]);
    });

    it('perdeu a corrida dentro do lock (outro pedido pendente): a foto já subida é apagada', async () => {
      const k = montarPortao();
      const r = await Promise.allSettled([k.svc.criarPedido(TOKEN_PORTAO, entrada), k.svc.criarPedido(TOKEN_PORTAO, entrada)]);
      expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(k.tabela('deliveryPedidosPortao')).toHaveLength(1);
      const gravada = k.tabela('deliveryPedidosPortao')[0].foto;
      const subidas = (k.storage.uploadDataUrl.mock.results as any[]).length;
      const apagadas = (k.storage.deleteUrl.mock.calls as any[]).map((c) => c[0]);
      expect(apagadas).toHaveLength(subidas - 1);
      expect(apagadas).not.toContain(gravada);
    });
  });

  describe('[9] card e notificação dos cancelamentos fora do lock da unidade', () => {
    it('pedido novo cancela o atendimento vencido sem resposta depois de soltar os locks', async () => {
      const k = montarPortao();
      await k.svc.criarPedido(TOKEN_PORTAO, entrada);
      const idAntigo = k.tabela('deliveryAtendimentos')[0].id;
      k.avancar(5 * M + 1000);
      const durante: string[][] = [];
      k.card.atualizarDelivery.mockImplementation(async () => {
        durante.push(k.banco.locksPresos());
        return { cobertos: new Set<string>() };
      });
      await k.svc.criarPedido(TOKEN_PORTAO, { ...entrada, nome: 'Duda' });
      expect(k.tabela('deliveryAtendimentos').find((a: any) => a.id === idAntigo)).toMatchObject({
        status: 'CANCELADA',
        motivo: 'Sem resposta do morador',
      });
      expect(durante.length).toBeGreaterThan(0);
      expect(durante.every((l) => l.length === 0)).toBe(true);
    });
  });

  describe('[10] a selfie gravada é a recodificada pelo sharp (JPEG, sem EXIF/GPS)', () => {
    const bytesDe = (dataUrl: string) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

    it('JPEG com EXIF e GPS sobe como JPEG novo, sem metadados', async () => {
      const sharp = (await import('sharp')).default;
      const original = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 100, b: 50 } } })
        .jpeg()
        .withExif({ IFD0: { Copyright: 'Teste' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 32/1 0/1' } })
        .toBuffer();
      expect((await sharp(original).metadata()).exif).toBeDefined();
      const k = montarPortao();
      await k.svc.criarPedido(TOKEN_PORTAO, { ...entrada, foto: `data:image/jpeg;base64,${original.toString('base64')}` });
      const [[enviado]] = k.storage.uploadDataUrl.mock.calls as any[];
      expect(enviado.startsWith('data:image/jpeg;base64,')).toBe(true);
      const bytes = bytesDe(enviado);
      expect(bytes.equals(original)).toBe(false);
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.exif).toBeUndefined();
    });

    it('PNG sobe convertido para JPEG', async () => {
      const sharp = (await import('sharp')).default;
      const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer();
      const k = montarPortao();
      await k.svc.criarPedido(TOKEN_PORTAO, { ...entrada, foto: `data:image/png;base64,${png.toString('base64')}` });
      const [[enviado]] = k.storage.uploadDataUrl.mock.calls as any[];
      expect(enviado.startsWith('data:image/jpeg;base64,')).toBe(true);
      expect((await sharp(bytesDe(enviado)).metadata()).format).toBe('jpeg');
    });
  });
});
