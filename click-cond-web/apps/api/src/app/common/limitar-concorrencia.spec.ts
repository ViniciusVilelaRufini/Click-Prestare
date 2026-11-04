import { ServiceUnavailableException } from '@nestjs/common';
import { ConcorrenciaEsgotadaError, estadoDosLimites, limitarConcorrencia } from './limitar-concorrencia';

function adiado<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));

let seq = 0;
const nomeUnico = (base: string) => `${base}-${++seq}`;

describe('limitarConcorrencia (bulkhead por dependência)', () => {
  it('nunca passa de `max` chamadas simultâneas', async () => {
    const limitar = limitarConcorrencia(nomeUnico('ia'), 2, { filaMaxima: 10 });
    let emVoo = 0;
    let pico = 0;
    const travas = Array.from({ length: 5 }, () => adiado());
    const chamadas = travas.map((t) =>
      limitar(async () => {
        emVoo++;
        pico = Math.max(pico, emVoo);
        await t.promise;
        emVoo--;
        return 'ok';
      }),
    );
    await tick();
    expect(emVoo).toBe(2);
    for (const t of travas) {
      t.resolve();
      await tick();
    }
    await expect(Promise.all(chamadas)).resolves.toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(pico).toBe(2);
  });

  it('com a fila cheia, falha na hora com erro claro (503)', async () => {
    const nome = nomeUnico('superlogica');
    const limitar = limitarConcorrencia(nome, 1, { filaMaxima: 1 });
    const trava = adiado();
    const p1 = limitar(() => trava.promise); // em voo
    const p2 = limitar(async () => 'fila'); // na fila
    const p3 = limitar(async () => 'rejeitada'); // estoura

    await expect(p3).rejects.toBeInstanceOf(ConcorrenciaEsgotadaError);
    await expect(p3).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(p3).rejects.toThrow(nome);

    trava.resolve();
    await p1;
    await expect(p2).resolves.toBe('fila');
  });

  it('quem espera demais na fila desiste com erro (sem ficar pendurado)', async () => {
    jest.useFakeTimers();
    try {
      const limitar = limitarConcorrencia(nomeUnico('smtp'), 1, { filaMaxima: 5, esperaMaximaMs: 1000 });
      const trava = adiado();
      const p1 = limitar(() => trava.promise);
      const p2 = limitar(async () => 'tarde');
      const verificacao = expect(p2).rejects.toBeInstanceOf(ConcorrenciaEsgotadaError);
      jest.advanceTimersByTime(1001);
      await verificacao;
      trava.resolve();
      await p1;
    } finally {
      jest.useRealTimers();
    }
  });

  it('erro da chamada libera a vaga e é repassado', async () => {
    const limitar = limitarConcorrencia(nomeUnico('wa'), 1, { filaMaxima: 1 });
    await expect(
      limitar(async () => {
        throw new Error('graph 500');
      }),
    ).rejects.toThrow('graph 500');
    await expect(limitar(async () => 1)).resolves.toBe(1);
  });

  it('mesmo nome = mesmo semáforo (a dependência é uma só no processo)', async () => {
    const nome = nomeUnico('compartilhado');
    const a = limitarConcorrencia(nome, 1, { filaMaxima: 0 });
    const b = limitarConcorrencia(nome, 1, { filaMaxima: 0 });
    const trava = adiado();
    const p1 = a(() => trava.promise);
    await expect(b(async () => 'x')).rejects.toBeInstanceOf(ConcorrenciaEsgotadaError);
    expect(estadoDosLimites()[nome]).toEqual({ max: 1, emVoo: 1, naFila: 0 });
    trava.resolve();
    await p1;
  });
});
