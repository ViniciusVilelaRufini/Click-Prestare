import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { limparEstadoEmMemoria } from '../common/estado-compartilhado';

/**
 * Lockout por conta com 2 instâncias atrás do ALB (WAFR task 1, concern 2).
 * O contador vivia num Map do processo: cada instância contava sozinha e o
 * limite efetivo dobrava (16 tentativas por janela em vez de 8). Agora as
 * falhas ficam em `estado_compartilhado`, uma linha por falha (insert, sem
 * ler-e-regravar: requisições simultâneas não perdem contagem).
 */

/** Delegate Prisma falso de `estado_Compartilhado`, compartilhado pelas duas "instâncias". */
function tabelaCompartilhada() {
  const linhas = new Map<string, any>();
  const casa = (l: any, where: any) => {
    if (typeof where.chave === 'string' && l.chave !== where.chave) return false;
    if (typeof where.chave === 'object' && where.chave?.startsWith !== undefined && !l.chave.startsWith(where.chave.startsWith)) return false;
    if (where.consumido_em === null && l.consumido_em !== null) return false;
    if (where.expira_em?.lte && !(l.expira_em <= where.expira_em.lte)) return false;
    if (where.expira_em?.gt && !(l.expira_em > where.expira_em.gt)) return false;
    return true;
  };
  return {
    linhas,
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const atual = linhas.get(where.chave);
      linhas.set(where.chave, atual ? { ...atual, ...update } : { ...create });
    }),
    findUnique: jest.fn(async ({ where }: any) => linhas.get(where.chave) ?? null),
    findMany: jest.fn(async ({ where }: any) => [...linhas.values()].filter((l) => casa(l, where))),
    create: jest.fn(async ({ data }: any) => {
      if (linhas.has(data.chave)) throw Object.assign(new Error('dup'), { code: 'P2002' });
      linhas.set(data.chave, { ...data });
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (const l of [...linhas.values()]) if (casa(l, where)) (linhas.delete(l.chave), count++);
      return { count };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const l of linhas.values()) if (casa(l, where)) (Object.assign(l, data), count++);
      return { count };
    }),
  };
}

describe('AuthService.loginPortaria — lockout compartilhado entre instâncias', () => {
  beforeEach(() => limparEstadoEmMemoria());

  function instancias() {
    const tabela = tabelaCompartilhada();
    const nova = () => {
      const prisma: any = {
        isConnected: true,
        funcionarios_Portaria: { findFirst: jest.fn(async () => null) },
        users: { findFirst: jest.fn(async () => null) },
        estado_Compartilhado: tabela,
      };
      return { svc: new AuthService(prisma, { sign: jest.fn(() => 't') } as any, {} as any), prisma };
    };
    return { a: nova(), b: nova(), tabela };
  }

  it('8 falhas alternando entre as 2 instâncias travam a conta nas duas', async () => {
    const { a, b } = instancias();
    for (let i = 0; i < 8; i++) {
      const alvo = i % 2 === 0 ? a : b;
      await expect(alvo.svc.loginPortaria(i % 3 === 0 ? 'JOAO ' : 'joao', 'errada')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    a.prisma.funcionarios_Portaria.findFirst.mockClear();
    b.prisma.funcionarios_Portaria.findFirst.mockClear();
    await expect(a.svc.loginPortaria('joao', 'errada')).rejects.toThrow(/Muitas tentativas/);
    await expect(b.svc.loginPortaria('Joao', 'errada')).rejects.toThrow(/Muitas tentativas/);
    expect(a.prisma.funcionarios_Portaria.findFirst).not.toHaveBeenCalled();
    expect(b.prisma.funcionarios_Portaria.findFirst).not.toHaveBeenCalled();
  });

  it('falhas simultâneas não se perdem (uma linha por falha, sem ler-e-regravar)', async () => {
    const { a, b } = instancias();
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).svc.loginPortaria('maria', 'x').catch(() => undefined)),
    );
    await expect(a.svc.loginPortaria('maria', 'x')).rejects.toThrow(/Muitas tentativas/);
  });

  it('não guarda o login em claro na tabela', async () => {
    const { a, tabela } = instancias();
    await a.svc.loginPortaria('segredo@exemplo.com', 'x').catch(() => undefined);
    const chaves = [...tabela.linhas.keys()].join(' ');
    expect(chaves).not.toContain('segredo');
    expect(chaves).toMatch(/^login-falha:/);
  });

  it('login certo numa instância zera as falhas para a outra também', async () => {
    const { a, b, tabela } = instancias();
    for (let i = 0; i < 7; i++) await a.svc.loginPortaria('ana', 'x').catch(() => undefined);
    // Sucesso: limparFalhas é chamado pelo fluxo; aqui exercitamos direto.
    await (b.svc as any).limparFalhas('ANA');
    expect([...tabela.linhas.keys()].filter((k) => k.startsWith('login-falha:'))).toHaveLength(0);
    await expect(a.svc.loginPortaria('ana', 'x')).rejects.toThrow(/Credenciais inválidas/);
  });
});
