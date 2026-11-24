import { HttpException } from '@nestjs/common';
import { consumirCotaDiaria, verificarCotaDiaria } from './cota-ia';
import { EstadoCompartilhado, limparEstadoEmMemoria } from './estado-compartilhado';

describe('cota-ia', () => {
  beforeEach(() => limparEstadoEmMemoria());
  const novo = () => new EstadoCompartilhado({ isConnected: false });

  it('rajada simultânea não passa do limite do condomínio', async () => {
    const estado = novo();
    const itens = [{ prefixo: 'chat-ia:cota:condominio:1', limite: 3 }];
    const r = await Promise.allSettled(Array.from({ length: 10 }, () => consumirCotaDiaria(estado, itens)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(3);
    const negados = r.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(negados).toHaveLength(7);
    expect((negados[0].reason as HttpException).getStatus()).toBe(429);
  });

  it('negar por um item devolve o que já foi consumido do outro', async () => {
    const estado = novo();
    const usuario = { prefixo: 'chat-ia:cota:usuario:7', limite: 10 };
    const condo = { prefixo: 'chat-ia:cota:condominio:1', limite: 1 };
    await consumirCotaDiaria(estado, [usuario, condo]);
    await expect(consumirCotaDiaria(estado, [usuario, condo])).rejects.toBeInstanceOf(HttpException);
    // o usuário gastou só 1: o segundo pedido foi negado e devolvido
    await consumirCotaDiaria(estado, [usuario]);
    await expect(verificarCotaDiaria(estado, [{ ...condo }])).rejects.toBeInstanceOf(HttpException);
  });
});
