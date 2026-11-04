import { Logger } from '@nestjs/common';

/**
 * Estado efêmero compartilhado entre as instâncias da API (tabela
 * `estado_compartilhado`, chave → JSON com prazo de validade).
 *
 * Existe porque a API passou a rodar em 2 instâncias atrás do ALB: o que vivia
 * num Map do processo (sessão do QR de login, MFA pendente do console, ação
 * proposta pelo assistente, captura de crachá, pedido de descoberta...) era
 * criado numa instância e consultado na outra — e "sumia". Aqui tudo passa pelo
 * banco, com o mesmo TTL que o Map tinha.
 *
 * `consumido_em` é a marca atômica de "já usei": `reivindicar` só devolve true
 * para UM chamador, mesmo com as duas instâncias disputando (UPDATE condicional).
 *
 * Sem banco (modo offline / testes com Prisma falso) cai num Map do processo —
 * o comportamento de uma instância só, igual a antes. Se a tabela ainda não
 * existir (SQL não aplicado), também cai no Map e loga erro uma vez.
 */

export interface EntradaEstado<T> {
  valor: T;
  expiraEm: Date;
  consumidoEm: Date | null;
}

interface LinhaMemoria {
  valor: string;
  expiraEm: number;
  consumidoEm: number | null;
}

/** O mínimo do PrismaService usado aqui (facilita mock nos testes). */
export interface PrismaParaEstado {
  isConnected?: boolean;
  estado_Compartilhado?: any;
}

const logger = new Logger('EstadoCompartilhado');
let tabelaAusente = false;
let ultimaPurgaEm = 0;
const PURGA_A_CADA_MS = 10 * 60 * 1000;

/** Só para testes: volta a tentar o banco e a purgar. */
export function limparEstadoEmMemoria() {
  tabelaAusente = false;
  ultimaPurgaEm = 0;
}

function codigoPrisma(err: any): string | undefined {
  return typeof err?.code === 'string' ? err.code : undefined;
}

export class EstadoCompartilhado {
  /**
   * Fallback em memória, por objeto: cada namespace de chave pertence a um
   * serviço singleton, então não há o que dividir entre objetos — e cada teste
   * que cria o serviço começa limpo.
   */
  private readonly memoria = new Map<string, LinhaMemoria>();

  constructor(private readonly prisma?: PrismaParaEstado | null) {}

  private get db(): any | null {
    if (tabelaAusente) return null;
    const p = this.prisma;
    if (!p || p.isConnected === false || !p.estado_Compartilhado) return null;
    return p.estado_Compartilhado;
  }

  /** Executa no banco; se a tabela não existir, desliga o banco e usa memória. */
  private async noBanco<T>(op: (db: any) => Promise<T>, emMemoria: () => T | Promise<T>): Promise<T> {
    const db = this.db;
    if (!db) return emMemoria();
    try {
      return await op(db);
    } catch (err: any) {
      if (codigoPrisma(err) === 'P2021') {
        tabelaAusente = true;
        logger.error(
          'Tabela estado_compartilhado não existe — aplicar prisma/sql/2026-11-04-multi-instancia.sql. ' +
            'Usando memória do processo (NÃO é seguro com mais de uma instância).',
        );
        return emMemoria();
      }
      throw err;
    }
  }

  private purgarDeVezEmQuando() {
    const agora = Date.now();
    if (agora - ultimaPurgaEm < PURGA_A_CADA_MS) return;
    ultimaPurgaEm = agora;
    void this.purgarExpirados().catch((err: any) => logger.warn(`Purga do estado compartilhado falhou: ${err?.message ?? err}`));
  }

  /** Grava (ou substitui) `chave` com validade de `ttlMs`. Zera `consumido_em`. */
  async definir<T>(chave: string, valor: T, ttlMs: number): Promise<void> {
    const json = JSON.stringify(valor);
    const expira_em = new Date(Date.now() + ttlMs);
    await this.noBanco(
      (db) =>
        db.upsert({
          where: { chave },
          create: { chave, valor: json, expira_em, consumido_em: null },
          update: { valor: json, expira_em, consumido_em: null },
        }),
      () => {
        this.memoria.set(chave, { valor: json, expiraEm: expira_em.getTime(), consumidoEm: null });
      },
    );
    this.purgarDeVezEmQuando();
  }

  /** Lê `chave` (null se não existe ou venceu). */
  async obter<T>(chave: string): Promise<EntradaEstado<T> | null> {
    return this.noBanco(
      async (db) => {
        const linha = await db.findUnique({ where: { chave } });
        if (!linha || new Date(linha.expira_em).getTime() <= Date.now()) return null;
        return {
          valor: JSON.parse(linha.valor) as T,
          expiraEm: new Date(linha.expira_em),
          consumidoEm: linha.consumido_em ? new Date(linha.consumido_em) : null,
        };
      },
      () => {
        const l = this.memoria.get(chave);
        if (!l) return null;
        if (l.expiraEm <= Date.now()) {
          this.memoria.delete(chave);
          return null;
        }
        return {
          valor: JSON.parse(l.valor) as T,
          expiraEm: new Date(l.expiraEm),
          consumidoEm: l.consumidoEm ? new Date(l.consumidoEm) : null,
        };
      },
    );
  }

  /**
   * Cria `chave` só se ela não existir (ou já tiver vencido). true = criou.
   * Serve de "marca de exclusividade" com prazo (ex.: bulk sync em andamento).
   */
  async criarSeAusente<T>(chave: string, valor: T, ttlMs: number): Promise<boolean> {
    const json = JSON.stringify(valor);
    const agora = new Date();
    const expira_em = new Date(agora.getTime() + ttlMs);
    return this.noBanco(
      async (db) => {
        await db.deleteMany({ where: { chave, expira_em: { lte: agora } } });
        try {
          await db.create({ data: { chave, valor: json, expira_em, consumido_em: null } });
          return true;
        } catch (err: any) {
          if (codigoPrisma(err) === 'P2002') return false;
          throw err;
        }
      },
      () => {
        const l = this.memoria.get(chave);
        if (l && l.expiraEm > agora.getTime()) return false;
        this.memoria.set(chave, { valor: json, expiraEm: expira_em.getTime(), consumidoEm: null });
        return true;
      },
    );
  }

  /**
   * Marca `chave` como consumida — só UM chamador recebe true (UPDATE
   * condicional). Se `novoValor` vier, grava junto, no mesmo UPDATE.
   */
  async reivindicar<T>(chave: string, novoValor?: T): Promise<boolean> {
    const agora = new Date();
    const json = novoValor === undefined ? undefined : JSON.stringify(novoValor);
    return this.noBanco(
      async (db) => {
        const r = await db.updateMany({
          where: { chave, consumido_em: null, expira_em: { gt: agora } },
          data: { consumido_em: agora, ...(json !== undefined ? { valor: json } : {}) },
        });
        return Number(r?.count ?? 0) === 1;
      },
      () => {
        const l = this.memoria.get(chave);
        if (!l || l.consumidoEm || l.expiraEm <= agora.getTime()) return false;
        l.consumidoEm = agora.getTime();
        if (json !== undefined) l.valor = json;
        return true;
      },
    );
  }

  /** Desfaz `reivindicar` (ex.: a execução falhou e o usuário pode tentar de novo). */
  async liberar(chave: string): Promise<void> {
    await this.noBanco(
      (db) => db.updateMany({ where: { chave }, data: { consumido_em: null } }),
      () => {
        const l = this.memoria.get(chave);
        if (l) l.consumidoEm = null;
      },
    );
  }

  async remover(chave: string): Promise<void> {
    await this.noBanco(
      (db) => db.deleteMany({ where: { chave } }),
      () => {
        this.memoria.delete(chave);
      },
    );
  }

  /** Remove todas as chaves que começam com `prefixo`. */
  async removerPorPrefixo(prefixo: string): Promise<void> {
    await this.noBanco(
      (db) => db.deleteMany({ where: { chave: { startsWith: prefixo } } }),
      () => {
        for (const k of [...this.memoria.keys()]) if (k.startsWith(prefixo)) this.memoria.delete(k);
      },
    );
  }

  /** Remove e devolve `chave` (null se não havia ou venceu). Só um chamador recebe a entrada. */
  async consumirUmaVez<T>(chave: string): Promise<T | null> {
    const entrada = await this.obter<T>(chave);
    if (!entrada) return null;
    const removidas = await this.noBanco(
      async (db) => Number((await db.deleteMany({ where: { chave } }))?.count ?? 0),
      () => (this.memoria.delete(chave) ? 1 : 0),
    );
    return removidas > 0 ? entrada.valor : null;
  }

  /** Entradas válidas cujo nome começa com `prefixo`. */
  async listarPorPrefixo<T>(prefixo: string): Promise<Array<{ chave: string } & EntradaEstado<T>>> {
    const agora = Date.now();
    return this.noBanco(
      async (db) => {
        const linhas: any[] = await db.findMany({
          where: { chave: { startsWith: prefixo }, expira_em: { gt: new Date(agora) } },
        });
        return linhas.map((l) => ({
          chave: l.chave,
          valor: JSON.parse(l.valor) as T,
          expiraEm: new Date(l.expira_em),
          consumidoEm: l.consumido_em ? new Date(l.consumido_em) : null,
        }));
      },
      () =>
        [...this.memoria.entries()]
          .filter(([k, l]) => k.startsWith(prefixo) && l.expiraEm > agora)
          .map(([chave, l]) => ({
            chave,
            valor: JSON.parse(l.valor) as T,
            expiraEm: new Date(l.expiraEm),
            consumidoEm: l.consumidoEm ? new Date(l.consumidoEm) : null,
          })),
    );
  }

  async purgarExpirados(): Promise<number> {
    const agora = new Date();
    return this.noBanco(
      async (db) => Number((await db.deleteMany({ where: { expira_em: { lte: agora } } }))?.count ?? 0),
      () => {
        let n = 0;
        for (const [k, l] of this.memoria) {
          if (l.expiraEm <= agora.getTime()) {
            this.memoria.delete(k);
            n++;
          }
        }
        return n;
      },
    );
  }
}
