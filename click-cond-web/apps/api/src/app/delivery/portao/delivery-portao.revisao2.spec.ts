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
});
