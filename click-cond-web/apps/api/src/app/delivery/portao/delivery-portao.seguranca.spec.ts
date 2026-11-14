import { ConflictException } from '@nestjs/common';
import { FOTO, T0, TOKEN_OUTRO_PORTAO, TOKEN_PORTAO, montarPortao } from './montar-portao.spec';

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
});
