import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AssembleiasController } from './assembleias.controller';
import { AssembleiasService, hashMapas, textoCanonicoMapa } from './assembleias.service';

/**
 * Rodada 5 — assembleia robusta. Pedido do dono (15/11): "Hoje um inquilino
 * consegue trocar o voto do proprietário, o resultado parcial aparece durante
 * a votação e os votos são apagados no fim, o que traz risco jurídico."
 *
 * O prisma aqui é um banco em memória (where com igualdade, null, in, not,
 * gt, OR/AND e os filtros de relação que o serviço usa): os testes conferem o
 * que ficou gravado e o que a API devolve, não o formato das consultas.
 */

type Voto = {
  id: number;
  id_opcao: number;
  id_user: number | null;
  id_apto: number | null;
  created_at: Date;
  tipo_vinculo: string | null;
  nome_votante: string | null;
  rotulo_unidade: string | null;
  substituido_em: Date | null;
};

const COND = 1;
// Unidades do condomínio 1: 100 (Apto 11 Bloco A), 200 (Apto 21 Bloco A),
// 300 (Apto 31). 400 é do condomínio 2.
const APTOS_PADRAO = [
  { id: 100, id_condominio: 1, bloco: 'A', apto: '11' },
  { id: 200, id_condominio: 1, bloco: 'A', apto: '21' },
  { id: 300, id_condominio: 1, bloco: null, apto: '31' },
  { id: 400, id_condominio: 2, bloco: null, apto: '41' },
];
// Unidade 100: P=10 proprietário, I=11 inquilino, M=12 membro (dependente),
// P2=13 outro proprietário (cônjuge); 14 é membro E proprietário (vale o mais
// alto). Unidade 200: 20 proprietário (tipo nulo = legado), 21 inquilino.
const VINCULOS_PADRAO = [
  { id_user: 10, id_apto: 100, tipo: 'Proprietário' },
  { id_user: 11, id_apto: 100, tipo: 'inquilino' },
  { id_user: 12, id_apto: 100, tipo: 'dependente' },
  { id_user: 13, id_apto: 100, tipo: 'proprietario' },
  { id_user: 14, id_apto: 100, tipo: 'membro' },
  { id_user: 14, id_apto: 100, tipo: 'proprietario' },
  { id_user: 20, id_apto: 200, tipo: null },
  { id_user: 21, id_apto: 200, tipo: 'Inquilino' },
];
const MORADORES_PADRAO = [
  { id_user: 10, id_condominio: 1, nome: 'Paula Proprietária' },
  { id_user: 10, id_condominio: 2, nome: 'Paula em outro prédio' },
  { id_user: 11, id_condominio: 1, nome: 'Igor Inquilino' },
];
const USERS_PADRAO = [
  { id: 10, name: 'paula.conta' },
  { id: 11, name: 'igor.conta' },
  { id: 12, name: 'Marcos Membro' },
  { id: 13, name: 'Pedro Cônjuge' },
  { id: 14, name: 'Quatorze' },
  { id: 20, name: 'Vinte' },
  { id: 21, name: 'Vinte e Um' },
];

const ABERTA = { data_inicio: new Date('2020-01-01T00:00:00Z'), data_termino: new Date('2099-01-01T00:00:00Z'), encerrada_em: null };

/** Avalia um `where` do Prisma sobre um objeto (o subconjunto que o serviço usa). */
function casa(row: any, where: any, relacoes: Record<string, (row: any, sub: any) => boolean> = {}): boolean {
  if (!where) return true;
  return Object.entries(where).every(([campo, filtro]: [string, any]) => {
    if (filtro === undefined) return true;
    if (campo === 'OR') return (filtro as any[]).some((w) => casa(row, w, relacoes));
    if (campo === 'AND') return (filtro as any[]).every((w) => casa(row, w, relacoes));
    if (campo === 'NOT') return !casa(row, filtro, relacoes);
    if (relacoes[campo]) return relacoes[campo](row, filtro);
    const v = row[campo];
    if (filtro === null) return v === null || v === undefined;
    if (typeof filtro === 'object' && !(filtro instanceof Date)) {
      if ('in' in filtro) return filtro.in.includes(v);
      if ('equals' in filtro) return v === filtro.equals;
      if ('not' in filtro) return filtro.not === null ? v !== null && v !== undefined : v !== filtro.not;
      if ('gt' in filtro) return v != null && v > filtro.gt;
      throw new Error(`filtro não suportado no fake: ${campo} ${JSON.stringify(filtro)}`);
    }
    if (filtro instanceof Date) return v instanceof Date && v.getTime() === filtro.getTime();
    return v === filtro;
  });
}

function build(
  opts: {
    votacoes?: any[];
    votos?: Array<Partial<Voto> & { id: number; id_opcao: number }>;
    vinculos?: Array<{ id_user: number; id_apto: number; tipo: string | null }>;
    assembleias?: any[];
    aptos?: typeof APTOS_PADRAO;
  } = {},
) {
  const aptos = opts.aptos ?? APTOS_PADRAO;
  const vinculos = opts.vinculos ?? VINCULOS_PADRAO;
  // Votação 5: pauta da assembleia 3 (opções 51 e 52). Votação 6: enquete
  // avulsa (opções 61 e 62). Ambas abertas.
  const votacoes: any[] = (
    opts.votacoes ?? [
      { id: 5, id_assembleia: 3, is_enquete: 0, titulo: 'Contas 2025', opcoes: [{ id: 51, nome: 'Aprovar' }, { id: 52, nome: 'Rejeitar' }] },
      { id: 6, id_assembleia: null, is_enquete: 1, titulo: 'Cor da fachada', opcoes: [{ id: 61, nome: 'Azul' }, { id: 62, nome: 'Verde' }] },
    ]
  ).map((v) => ({ id_condominio: COND, descricao: '', somente_proprietarios: 0, created_at: new Date('2026-11-01T00:00:00Z'), ...ABERTA, ...v }));
  const assembleias: any[] = (opts.assembleias ?? [{ id: 3 }]).map((a) => ({
    id_condominio: COND, titulo: 'AGO 2026', descricao: '', data: new Date('2026-11-20T00:00:00Z'), hora: null,
    link: '', local: '', anexos: '', finalizada_em: null, finalizada_por: null, id_documento_ata: null, apuracao_hash: null, ...a,
  }));
  let seq = 1000;
  let relogio = Date.parse('2026-11-14T12:00:00Z');
  const votos: Voto[] = (opts.votos ?? []).map((v) => ({
    id_user: null, id_apto: null, created_at: new Date('2026-11-14T10:00:00Z'),
    tipo_vinculo: null, nome_votante: null, rotulo_unidade: null, substituido_em: null, ...v,
  }));
  const documentos: any[] = [];
  const ordem: string[] = [];

  const votacaoDaOpcao = (idOpcao: number) => votacoes.find((v) => v.opcoes.some((o: any) => o.id === idOpcao));
  const relVoto = {
    opcao: (row: Voto, sub: any) => {
      const vt = votacaoDaOpcao(row.id_opcao);
      if (!vt) return false;
      if (sub.id_votacao !== undefined && vt.id !== sub.id_votacao) return false;
      if (sub.votacao?.id_assembleia !== undefined && vt.id_assembleia !== sub.votacao.id_assembleia) return false;
      return true;
    },
  };
  const linhaVinculo = (v: { id_user: number; id_apto: number; tipo: string | null }) => ({
    ...v,
    apartamento: aptos.find((a) => a.id === v.id_apto),
  });
  const relVinculo = { apartamento: (row: any, sub: any) => !!row.apartamento && casa(row.apartamento, sub) };
  const ordenar = (lista: Voto[]) => [...lista].sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id - a.id);
  const assembleiaDe = (v: any) => assembleias.find((a) => a.id === v.id_assembleia) ?? null;

  const votacaoCompleta = (v: any, include: any) => {
    const filtroVotos = include?.opcoes?.include?.votos?.where;
    return {
      ...v,
      assembleia: assembleiaDe(v) ? { finalizada_em: assembleiaDe(v).finalizada_em } : null,
      condominio: { _count: { apartamentos: aptos.filter((a) => a.id_condominio === v.id_condominio).length } },
      opcoes: v.opcoes.map((o: any) => ({
        ...o,
        votos: votos.filter((x) => x.id_opcao === o.id && casa(x, filtroVotos)).map((x) => ({ ...x })),
      })),
    };
  };

  const prisma: any = {
    isConnected: true,
    votacoes: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const v = votacoes.find((x) => x.id === where.id);
        return v ? votacaoCompleta(v, include) : null;
      }),
      findMany: jest.fn(async ({ where, include }: any) =>
        votacoes.filter((v) => casa(v, where)).map((v) => votacaoCompleta(v, include)),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const v = votacoes.find((x) => x.id === where.id);
        Object.assign(v, data);
        return v;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const alvo = votacoes.filter((v) => casa(v, where));
        for (const v of alvo) Object.assign(v, data);
        return { count: alvo.length };
      }),
      delete: jest.fn(async ({ where }: any) => {
        ordem.push(`delete votacao ${where.id}`);
        return {};
      }),
      create: jest.fn(async ({ data }: any) => ({ id: 77, ...data })),
    },
    votacoes_Opcoes: { createMany: jest.fn(async () => ({ count: 2 })) },
    apartamentos: {
      findMany: jest.fn(async ({ where }: any) => aptos.filter((a) => casa(a, where))),
    },
    apartamentos_Users: {
      findMany: jest.fn(async ({ where }: any) => vinculos.map(linhaVinculo).filter((row) => casa(row, where, relVinculo))),
    },
    moradores: {
      findFirst: jest.fn(async ({ where }: any) => MORADORES_PADRAO.find((m) => casa(m, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => MORADORES_PADRAO.filter((m) => casa(m, where))),
    },
    users: {
      findUnique: jest.fn(async ({ where }: any) => USERS_PADRAO.find((u) => u.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) => USERS_PADRAO.filter((u) => casa(u, where))),
    },
    votacoes_Usuarios: {
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        const l = votos.filter((v) => casa(v, where, relVoto));
        return orderBy ? ordenar(l) : l;
      }),
      findFirst: jest.fn(async ({ where }: any) => ordenar(votos.filter((v) => casa(v, where, relVoto)))[0] ?? null),
      count: jest.fn(async ({ where }: any) => votos.filter((v) => casa(v, where, relVoto)).length),
      create: jest.fn(async ({ data }: any) => {
        ordem.push('create');
        relogio += 60_000;
        const novo: Voto = {
          id: ++seq, id_apto: null, created_at: new Date(relogio), tipo_vinculo: null, nome_votante: null,
          rotulo_unidade: null, substituido_em: null, ...data,
        };
        votos.push(novo);
        return novo;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        ordem.push('updateMany');
        const alvo = votos.filter((v) => casa(v, where, relVoto));
        for (const v of alvo) Object.assign(v, data);
        return { count: alvo.length };
      }),
      deleteMany: jest.fn(async () => {
        throw new Error('voto não se apaga');
      }),
    },
    assembleias: {
      findUnique: jest.fn(async ({ where }: any) => assembleias.find((a) => a.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => assembleias.find((a) => casa(a, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => assembleias.filter((a) => casa(a, where))),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const alvo = assembleias.filter((a) => casa(a, where));
        for (const a of alvo) Object.assign(a, data);
        return { count: alvo.length };
      }),
      delete: jest.fn(async () => {
        ordem.push('delete assembleia');
        return {};
      }),
    },
    documentos: {
      create: jest.fn(async ({ data }: any) => {
        const d = { id: 900 + documentos.length, ...data };
        documentos.push(d);
        return d;
      }),
      findUnique: jest.fn(async ({ where }: any) => documentos.find((d) => d.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => documentos.find((d) => casa(d, where)) ?? null),
    },
  };
  prisma.$queryRaw = jest.fn(async () => {
    ordem.push('lock');
    return [];
  });
  // Como o banco: erro dentro da transação desfaz o que ela gravou.
  prisma.$transaction = jest.fn(async (fn: any) => {
    const tabelas: any[][] = [votos, votacoes, assembleias, documentos];
    const copia = tabelas.map((tab) => structuredClone(tab));
    try {
      return await fn(prisma);
    } catch (e) {
      tabelas.forEach((tab, i) => tab.splice(0, tab.length, ...copia[i]));
      throw e;
    }
  });
  const tenant: any = { assertEntidade: jest.fn(async () => undefined), assertCondominio: jest.fn(async () => undefined) };
  const storage: any = {
    isDataUrl: (v: unknown) => typeof v === 'string' && v.startsWith('data:') && v.includes('base64,'),
    uploadDataUrl: jest.fn(async (_d: string, pasta: string) => `https://bucket.s3.amazonaws.com/${pasta}/${++seq}.bin`),
    exigirArquivoDoRegistro: jest.fn(async () => undefined),
    deleteUrl: jest.fn(async () => true),
    chaveDoArquivo: jest.fn(() => null),
  };
  const svc = new AssembleiasService(prisma, storage, tenant);
  return { svc, prisma, votos, votacoes, assembleias, documentos, storage, ordem };
}

const morador = (id: number) => ({ sub: id, nome: `U${id}`, typeAccess: 'Morador', user: { id } }) as any;
const sindico: any = { sub: 7, typeAccess: 'Sindico', user: { id: 7 } };
const votar = (svc: AssembleiasService, user: number, votacao: number, opcao: number, idApto?: number) =>
  svc.registerVoto(votacao, opcao, user, morador(user), idApto);
const vigentes = (votos: Voto[]) => votos.filter((v) => v.substituido_em == null);

describe('2.1 — quem vota e quem pode trocar o voto', () => {
  describe('hierarquia da unidade (pauta e enquete)', () => {
    it.each([5, 6])('votação %i: inquilino NÃO troca o voto do proprietário (409) e nada muda', async (vt) => {
      const { svc, votos } = build();
      const [sim, nao] = vt === 5 ? [51, 52] : [61, 62];
      await votar(svc, 10, vt, sim);
      await expect(votar(svc, 11, vt, nao)).rejects.toThrow(
        new ConflictException('O proprietário da unidade já votou; o voto dele não pode ser alterado por inquilino.'),
      );
      expect(votos.map((v) => [v.id_user, v.id_opcao, v.substituido_em])).toEqual([[10, sim, null]]);
    });

    it('membro não troca o voto do inquilino nem do proprietário na enquete (409, texto próprio)', async () => {
      const { svc } = build();
      await votar(svc, 11, 6, 61);
      await expect(votar(svc, 12, 6, 62)).rejects.toThrow(
        new ConflictException('O inquilino da unidade já votou; o voto dele não pode ser alterado por membro da unidade.'),
      );
      await votar(svc, 10, 6, 61);
      await expect(votar(svc, 12, 6, 62)).rejects.toThrow(
        new ConflictException('O proprietário da unidade já votou; o voto dele não pode ser alterado por membro da unidade.'),
      );
    });

    it('proprietário substitui o voto do inquilino: o antigo FICA, com substituido_em', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-15T13:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
      try {
        const { svc, votos } = build();
        await votar(svc, 11, 5, 52);
        await votar(svc, 10, 5, 51);
        expect(votos.map((v) => [v.id_user, v.id_opcao, v.tipo_vinculo])).toEqual([
          [11, 52, 'inquilino'],
          [10, 51, 'proprietario'],
        ]);
        expect(votos[0].substituido_em?.toISOString()).toBe('2026-11-15T13:00:00.000Z');
        expect(votos[1].substituido_em).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('outro proprietário (mesmo nível) substitui; membro substitui membro', async () => {
      const { svc, votos } = build();
      await votar(svc, 10, 6, 61);
      await votar(svc, 13, 6, 62);
      expect(vigentes(votos).map((v) => [v.id_user, v.id_opcao])).toEqual([[13, 62]]);
      const b = build();
      await votar(b.svc, 12, 6, 61);
      await votar(b.svc, 11, 6, 62); // inquilino > membro
      expect(vigentes(b.votos).map((v) => v.id_user)).toEqual([11]);
    });

    it('vários vínculos da mesma conta na unidade: vale o mais alto (membro + proprietário = proprietário)', async () => {
      const { svc, votos } = build();
      await votar(svc, 14, 5, 51);
      expect(votos[0].tipo_vinculo).toBe('proprietario');
      await expect(votar(svc, 11, 5, 52)).rejects.toBeInstanceOf(ConflictException);
    });

    it('tipo nulo (legado) é proprietário', async () => {
      const { svc, votos } = build();
      await votar(svc, 20, 5, 51);
      expect(votos[0].tipo_vinculo).toBe('proprietario');
      await expect(votar(svc, 21, 5, 52)).rejects.toBeInstanceOf(ConflictException);
    });

    it('votar de novo na MESMA opção pelo mesmo autor: sucesso, sem linha nova', async () => {
      const { svc, votos } = build();
      await votar(svc, 10, 5, 51);
      await expect(votar(svc, 10, 5, 51)).resolves.toEqual({ success: true });
      expect(votos).toHaveLength(1);
      expect(votos[0].substituido_em).toBeNull();
    });

    it('o mesmo autor trocando de opção: o voto anterior fica como substituído', async () => {
      const { svc, votos } = build();
      await votar(svc, 10, 5, 51);
      await votar(svc, 10, 5, 52);
      expect(votos.map((v) => [v.id_opcao, v.substituido_em == null])).toEqual([[51, false], [52, true]]);
    });

    it('voto de outra unidade não é tocado', async () => {
      const { svc, votos } = build();
      await votar(svc, 20, 5, 51);
      await votar(svc, 10, 5, 52);
      expect(vigentes(votos).map((v) => [v.id_apto, v.id_opcao])).toEqual([[200, 51], [100, 52]]);
    });
  });

  describe('voto vigente antigo (sem tipo_vinculo)', () => {
    it('nível do vínculo ATUAL do autor: voto antigo do proprietário não é trocado pelo inquilino', async () => {
      const { svc, votos } = build({ votos: [{ id: 1, id_opcao: 51, id_user: 10, id_apto: 100 }] });
      await expect(votar(svc, 11, 5, 52)).rejects.toBeInstanceOf(ConflictException);
      expect(votos).toHaveLength(1);
    });

    it('voto antigo sem id_apto (unidade atribuída) também conta como vigente da unidade', async () => {
      const { svc, votos } = build({ votos: [{ id: 1, id_opcao: 51, id_user: 10, id_apto: null }] });
      await expect(votar(svc, 11, 5, 52)).rejects.toBeInstanceOf(ConflictException);
      await votar(svc, 13, 5, 52);
      expect(votos.map((v) => [v.id, v.substituido_em == null])).toEqual([[1, false], [1001, true]]);
    });

    it('autor que saiu da unidade ou excluiu a conta conta como membro: qualquer um substitui', async () => {
      const saiu = build({ votos: [{ id: 1, id_opcao: 61, id_user: 99, id_apto: 100 }] });
      await votar(saiu.svc, 12, 6, 62);
      expect(vigentes(saiu.votos).map((v) => v.id_user)).toEqual([12]);
      const semConta = build({ votos: [{ id: 1, id_opcao: 61, id_user: null, id_apto: 100 }] });
      await votar(semConta.svc, 12, 6, 62);
      expect(vigentes(semConta.votos).map((v) => v.id_user)).toEqual([12]);
    });
  });

  describe('direito de voto', () => {
    it('membro NÃO vota em pauta de assembleia (403 com mensagem clara)', async () => {
      const { svc, votos } = build();
      await expect(votar(svc, 12, 5, 51)).rejects.toThrow(
        new ForbiddenException(
          'Membros da unidade não votam em pauta de assembleia: vota o proprietário (ou o inquilino, quando a pauta permite).',
        ),
      );
      expect(votos).toEqual([]);
    });

    it('membro vota em enquete', async () => {
      const { svc, votos } = build();
      await votar(svc, 12, 6, 61);
      expect(votos.map((v) => [v.id_user, v.tipo_vinculo])).toEqual([[12, 'membro']]);
    });

    it('inquilino vota em pauta quando ela não é "somente proprietários"', async () => {
      const { svc, votos } = build();
      await votar(svc, 11, 5, 51);
      expect(votos.map((v) => v.tipo_vinculo)).toEqual(['inquilino']);
    });

    it.each([
      [5, 'Somente proprietários votam nesta pauta.'],
      [6, 'Somente proprietários votam nesta enquete.'],
    ])('somente_proprietarios barra inquilino e membro na votação %i (403)', async (vt, msg) => {
      const { svc, votos, votacoes } = build();
      votacoes.find((v) => v.id === vt).somente_proprietarios = 1;
      const opcao = vt === 5 ? 51 : 61;
      await expect(votar(svc, 11, vt, opcao)).rejects.toThrow(new ForbiddenException(msg));
      if (vt === 6) await expect(votar(svc, 12, vt, opcao)).rejects.toThrow(new ForbiddenException(msg));
      await votar(svc, 10, vt, opcao);
      expect(votos.map((v) => v.id_user)).toEqual([10]);
    });
  });

  describe('retrato gravado no voto', () => {
    it('tipo, nome do morador NAQUELE condomínio, rótulo da unidade, id_apto e id_user', async () => {
      const { svc, votos } = build();
      await votar(svc, 10, 5, 51);
      expect(votos[0]).toMatchObject({
        id_user: 10, id_apto: 100, id_opcao: 51, tipo_vinculo: 'proprietario',
        nome_votante: 'Paula Proprietária', rotulo_unidade: 'Apto 11 Bloco A', substituido_em: null,
      });
    });

    it('sem cadastro de morador no condomínio: Users.name', async () => {
      const { svc, votos } = build();
      await votar(svc, 13, 5, 51);
      expect(votos[0].nome_votante).toBe('Pedro Cônjuge');
    });
  });

  describe('recusas (400)', () => {
    it('assembleia da pauta finalizada', async () => {
      const { svc, votos } = build({ assembleias: [{ id: 3, finalizada_em: new Date('2026-11-14T00:00:00Z') }] });
      await expect(votar(svc, 10, 5, 51)).rejects.toThrow(
        new BadRequestException('Esta assembleia já foi finalizada; a votação está encerrada.'),
      );
      expect(votos).toEqual([]);
    });

    it('votação encerrada (encerrada_em), mesmo dentro do período', async () => {
      const { svc, votacoes } = build();
      votacoes[1].encerrada_em = new Date('2026-11-14T00:00:00Z');
      await expect(votar(svc, 10, 6, 61)).rejects.toThrow(new BadRequestException('Votação já foi finalizada'));
    });

    it('fora do período', async () => {
      const { svc, votacoes } = build();
      votacoes[1].data_inicio = new Date('2099-01-01T00:00:00Z');
      await expect(votar(svc, 10, 6, 61)).rejects.toThrow(new BadRequestException('Votação ainda não foi iniciada'));
      votacoes[1].data_inicio = new Date('2020-01-01T00:00:00Z');
      votacoes[1].data_termino = new Date('2020-02-01T00:00:00Z');
      await expect(votar(svc, 10, 6, 61)).rejects.toThrow(new BadRequestException('Votação já foi finalizada'));
    });
  });

  describe('transação', () => {
    it('trava a unidade (FOR UPDATE) antes de ler o voto vigente e de gravar; nunca apaga voto', async () => {
      const { svc, prisma, ordem } = build();
      await votar(svc, 11, 5, 52);
      await votar(svc, 10, 5, 51);
      expect(ordem).toEqual(['lock', 'create', 'lock', 'updateMany', 'create']);
      expect(prisma.votacoes_Usuarios.deleteMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
    });
  });

  it('payload exato do app 1.2.48 ({ voto: { votacao_id, opcao_id, id_apto? } }) continua 200', async () => {
    const { svc, votos } = build();
    const ctrl = new AssembleiasController(svc);
    await expect(ctrl.registerVoto({ voto: { votacao_id: 5, opcao_id: 51 } }, morador(10))).resolves.toEqual({ success: true });
    await expect(ctrl.registerVoto({ voto: { votacao_id: 6, opcao_id: 61, id_apto: 200 } }, morador(20))).resolves.toEqual({ success: true });
    expect(votos.map((v) => [v.id_user, v.id_apto])).toEqual([[10, 100], [20, 200]]);
  });
});

describe('2.2 — apuração', () => {
  const ENCERRADA = { encerrada_em: new Date('2026-11-14T20:00:00Z') };
  const votacoesEncerradas = () => [
    { id: 5, id_assembleia: 3, is_enquete: 0, titulo: 'Contas 2025', opcoes: [{ id: 51, nome: 'Aprovar' }, { id: 52, nome: 'Rejeitar' }], ...ENCERRADA },
  ];
  const apurar = async (svc: AssembleiasService) =>
    (await (svc as any).getVotacoesFormatadas(undefined, false, undefined, 5))[0].opcoes;
  const t = (hhmm: string) => new Date(`2026-11-14T${hhmm}:00Z`);
  const novo = (v: Partial<Voto>) => ({ tipo_vinculo: 'proprietario', nome_votante: 'X', rotulo_unidade: 'Apto 11 Bloco A', ...v });

  it('conta só os vigentes (o substituído fica fora)', async () => {
    const { svc } = build({
      votacoes: votacoesEncerradas(),
      votos: [
        // Mesmo mais recente (relógio torto), o substituído não conta.
        novo({ id: 1, id_opcao: 52, id_user: 11, id_apto: 100, tipo_vinculo: 'inquilino', created_at: t('11:30'), substituido_em: t('11:30') }),
        novo({ id: 2, id_opcao: 51, id_user: 10, id_apto: 100, created_at: t('11:00') }),
      ] as any,
    });
    expect(await apurar(svc)).toEqual(['51;Aprovar;1', '52;Rejeitar;0']);
  });

  it('voto novo conta pela unidade gravada SEM reconsultar o vínculo: quem saiu da unidade ou excluiu a conta continua contando', async () => {
    const { svc } = build({
      votacoes: votacoesEncerradas(),
      vinculos: [], // ninguém mais tem vínculo
      votos: [
        novo({ id: 1, id_opcao: 51, id_user: 10, id_apto: 100, created_at: t('10:00') }),
        novo({ id: 2, id_opcao: 51, id_user: null, id_apto: 200, rotulo_unidade: 'Apto 21 Bloco A', created_at: t('10:00') }),
      ] as any,
    });
    expect(await apurar(svc)).toEqual(['51;Aprovar;2', '52;Rejeitar;0']);
  });

  it('apartamento apagado (id_apto nulo): conta como unidade própria pelo rótulo gravado', async () => {
    const { svc } = build({
      votacoes: votacoesEncerradas(),
      votos: [
        // Contas sem vínculo nenhum hoje (a regra antiga descartaria os três).
        novo({ id: 1, id_opcao: 51, id_user: 97, id_apto: null, rotulo_unidade: 'Apto 99', created_at: t('10:00') }),
        novo({ id: 2, id_opcao: 52, id_user: 98, id_apto: null, rotulo_unidade: 'Apto 99', created_at: t('10:05') }),
        novo({ id: 3, id_opcao: 52, id_user: null, id_apto: null, rotulo_unidade: 'Apto 98', created_at: t('10:00') }),
      ] as any,
    });
    // Apto 99: vale o mais recente (Rejeitar); Apto 98: Rejeitar.
    expect(await apurar(svc)).toEqual(['51;Aprovar;0', '52;Rejeitar;2']);
  });

  it('voto antigo (sem tipo_vinculo) segue a regra antiga: exige vínculo com a unidade', async () => {
    const { svc } = build({
      votacoes: votacoesEncerradas(),
      votos: [
        { id: 1, id_opcao: 51, id_user: 10, id_apto: 100, created_at: t('10:00') }, // conta
        { id: 2, id_opcao: 51, id_user: 99, id_apto: 200, created_at: t('10:00') }, // sem vínculo: não conta
        { id: 3, id_opcao: 52, id_user: 20, id_apto: null, created_at: t('10:00') }, // unidade atribuída 200
      ],
    });
    expect(await apurar(svc)).toEqual(['51;Aprovar;1', '52;Rejeitar;1']);
  });

  it('rede de segurança: dois vigentes da mesma unidade (novo e antigo) contam 1, o mais recente', async () => {
    const { svc } = build({
      votacoes: votacoesEncerradas(),
      votos: [
        { id: 1, id_opcao: 52, id_user: 10, id_apto: 100, created_at: t('10:00') },
        novo({ id: 2, id_opcao: 51, id_user: 13, id_apto: 100, created_at: t('10:01') }),
        novo({ id: 3, id_opcao: 51, id_user: 13, id_apto: 100, created_at: t('10:01') }),
      ] as any,
    });
    expect(await apurar(svc)).toEqual(['51;Aprovar;1', '52;Rejeitar;0']);
  });
});

describe('2.3 — resultado parcial oculto', () => {
  const t = (hhmm: string) => new Date(`2026-11-14T${hhmm}:00Z`);
  const novo = (v: Partial<Voto>) => ({ nome_votante: 'X', rotulo_unidade: 'Apto', ...v });
  // Votos vigentes: unidade 100 (inquilino 11 → Rejeitar, depois proprietário 10
  // → Aprovar, que vale) e unidade 200 (inquilino 21 → Rejeitar).
  const VOTOS = [
    novo({ id: 1, id_opcao: 52, id_user: 11, id_apto: 100, tipo_vinculo: 'inquilino', created_at: t('09:00'), substituido_em: t('10:00') }),
    novo({ id: 2, id_opcao: 51, id_user: 10, id_apto: 100, tipo_vinculo: 'proprietario', created_at: t('10:00') }),
    novo({ id: 3, id_opcao: 52, id_user: 21, id_apto: 200, tipo_vinculo: 'inquilino', created_at: t('10:00') }),
  ] as any;

  it('aberta: contagem zerada para TODOS (morador, síndico e porteiro), com participação e resultado_oculto', async () => {
    const { svc } = build({ votos: VOTOS });
    const porteiro: any = { sub: 3, nome: 'João', id_condominio: 1, tipo_sub: 'funcionario_portaria' };
    for (const [user, token] of [[10, morador(10)], [7, sindico], [null, porteiro]] as const) {
      const r: any = await svc.get(COND, 3, user, token);
      const pauta = r.votacoes.find((v: any) => v.id === 5);
      expect(pauta.opcoes).toEqual(['51;Aprovar;0', '52;Rejeitar;0']);
      expect(pauta).toMatchObject({
        status: 1, resultado_oculto: true, somente_proprietarios: 0, encerrada_em: null,
        participacao: { unidades_votaram: 2, unidades_total: 3 },
      });
    }
  });

  it('aberta: enqueteGetAll e enqueteGetDetails também escondem', async () => {
    const { svc } = build({
      votos: [novo({ id: 1, id_opcao: 61, id_user: 10, id_apto: 100, tipo_vinculo: 'proprietario', created_at: t('10:00') })] as any,
    });
    const lista: any[] = await svc.enqueteGetAll(COND, sindico);
    expect(lista.map((v) => v.id)).toEqual([6]);
    expect(lista[0]).toMatchObject({ opcoes: ['61;Azul;0', '62;Verde;0'], resultado_oculto: true, participacao: { unidades_votaram: 1, unidades_total: 3 } });
    const det: any = await svc.enqueteGetDetails(6, 10, morador(10));
    expect(det.votacao).toMatchObject({ opcoes: ['61;Azul;0', '62;Verde;0'], resultado_oculto: true });
    // O próprio voto continua visível.
    expect(det.meuVoto).toEqual(['61']);
    expect(det.votosPorUnidade[0]).toMatchObject({ id_apto: 100, opcao: '61' });
  });

  it('agendada também esconde', async () => {
    const { svc, votacoes } = build({ votos: VOTOS });
    votacoes[0].data_inicio = new Date('2099-01-01T00:00:00Z');
    const r: any = await svc.get(COND, 3, 10, morador(10));
    expect(r.votacoes.find((v: any) => v.id === 5)).toMatchObject({ status: 0, resultado_oculto: true, opcoes: ['51;Aprovar;0', '52;Rejeitar;0'] });
  });

  it('encerrada (encerrada_em ou assembleia finalizada): contagem real e resultado_oculto false', async () => {
    const enc = build({ votos: VOTOS });
    enc.votacoes[0].encerrada_em = new Date('2026-11-14T20:00:00Z');
    enc.votacoes[0].somente_proprietarios = 1;
    const r: any = await enc.svc.get(COND, 3, 10, morador(10));
    expect(r.votacoes.find((v: any) => v.id === 5)).toMatchObject({
      status: 2, resultado_oculto: false, opcoes: ['51;Aprovar;1', '52;Rejeitar;1'], somente_proprietarios: 1,
      encerrada_em: '2026-11-14T20:00:00.000Z', participacao: { unidades_votaram: 2, unidades_total: 3 },
    });
    const fin = build({ votos: VOTOS, assembleias: [{ id: 3, finalizada_em: new Date('2026-11-14T21:00:00Z') }] });
    const r2: any = await fin.svc.get(COND, 3, 10, morador(10));
    expect(r2.votacoes.find((v: any) => v.id === 5)).toMatchObject({ status: 2, resultado_oculto: false, opcoes: ['51;Aprovar;1', '52;Rejeitar;1'] });
  });

  describe('votosPorUnidade', () => {
    const daPauta = (r: any) => r.votosPorUnidade.find((v: any) => v.id_votacao === 5);

    it('o proprietário vê o voto vigente da unidade, mesmo dado pelo inquilino', async () => {
      const { svc } = build({ votos: [novo({ id: 1, id_opcao: 52, id_user: 11, id_apto: 100, tipo_vinculo: 'inquilino', created_at: t('09:00') })] as any });
      expect(daPauta(await svc.get(COND, 3, 10, morador(10)))).toEqual({
        id_votacao: 5, id_apto: 100, rotulo: 'Apto 11 Bloco A', opcao: '52',
        tipo_vinculo: 'proprietario', pode_votar: true, motivo: null, votado_por: 'inquilino', voto_proprio: false,
      });
    });

    it('o inquilino NÃO vê a opção do proprietário: sabe só que ele votou e por que não pode votar', async () => {
      const { svc } = build({ votos: VOTOS });
      const r: any = await svc.get(COND, 3, 11, morador(11));
      expect(daPauta(r)).toEqual({
        id_votacao: 5, id_apto: 100, rotulo: 'Apto 11 Bloco A', opcao: null,
        tipo_vinculo: 'inquilino', pode_votar: false, motivo: 'O proprietário já votou por esta unidade.', votado_por: 'proprietario',
        voto_proprio: false,
      });
      // meusVotos: só os vigentes da própria conta (o dele foi substituído).
      expect(r.meusVotos).toEqual([]);
    });

    it('o próprio voto aparece para quem votou', async () => {
      const { svc } = build({ votos: VOTOS });
      const r: any = await svc.get(COND, 3, 21, morador(21));
      expect(daPauta(r)).toMatchObject({ id_apto: 200, opcao: '52', tipo_vinculo: 'inquilino', pode_votar: true, votado_por: 'inquilino', voto_proprio: true });
      expect(r.meusVotos).toEqual(['52']);
    });

    it('membro em pauta, somente proprietários e votação encerrada: pode_votar false com o motivo pronto', async () => {
      const { svc, votacoes } = build();
      const membro: any = await svc.get(COND, 3, 12, morador(12));
      expect(daPauta(membro)).toMatchObject({
        tipo_vinculo: 'membro', pode_votar: false, votado_por: null, opcao: null,
        motivo: 'Membros da unidade não votam em pauta de assembleia: vota o proprietário (ou o inquilino, quando a pauta permite).',
      });
      votacoes[0].somente_proprietarios = 1;
      expect(daPauta(await svc.get(COND, 3, 11, morador(11)))).toMatchObject({ pode_votar: false, motivo: 'Somente proprietários votam nesta pauta.' });
      votacoes[0].encerrada_em = new Date();
      expect(daPauta(await svc.get(COND, 3, 10, morador(10)))).toMatchObject({ pode_votar: false, motivo: 'Votação encerrada.' });
      votacoes[0].encerrada_em = null;
      votacoes[0].data_inicio = new Date('2099-01-01T00:00:00Z');
      expect(daPauta(await svc.get(COND, 3, 10, morador(10)))).toMatchObject({ pode_votar: false, motivo: 'A votação ainda não começou.' });
    });

    it('voto_proprio: verdadeiro só quando o voto vigente da unidade é da própria conta (coproprietário vê false)', async () => {
      const { svc } = build({ votos: [novo({ id: 1, id_opcao: 61, id_user: 10, id_apto: 100, tipo_vinculo: 'proprietario', created_at: t('09:00') })] as any });
      const daEnquete = (r: any) => r.votosPorUnidade.find((v: any) => v.id_votacao === 6);
      expect(daEnquete(await svc.enqueteGetDetails(6, 10, morador(10)))).toMatchObject({ voto_proprio: true, votado_por: 'proprietario', opcao: '61' });
      // Outro proprietário da mesma unidade: vê a opção (mesmo nível), mas o voto não é dele.
      expect(daEnquete(await svc.enqueteGetDetails(6, 13, morador(13)))).toMatchObject({ voto_proprio: false, votado_por: 'proprietario', opcao: '61' });
      expect(daEnquete(await svc.enqueteGetDetails(6, 20, morador(20)))).toMatchObject({ voto_proprio: false, votado_por: null });
    });

    it('membro na enquete pode votar enquanto ninguém de nível acima votou', async () => {
      const { svc } = build();
      const r: any = await svc.enqueteGetDetails(6, 12, morador(12));
      expect(r.votosPorUnidade).toEqual([
        { id_votacao: 6, id_apto: 100, rotulo: 'Apto 11 Bloco A', opcao: null, tipo_vinculo: 'membro', pode_votar: true, motivo: null, votado_por: null, voto_proprio: false },
      ]);
      expect(r.unidades).toEqual([{ id_apto: 100, rotulo: 'Apto 11 Bloco A' }]);
    });
  });
});

describe('2.6 — mapa de votação (nominal, só síndico/staff)', () => {
  const t = (hhmm: string) => new Date(`2026-11-14T${hhmm}:00Z`);
  const VOTOS = [
    // Unidade 100: inquilino votou, proprietária substituiu.
    { id: 1, id_opcao: 52, id_user: 11, id_apto: 100, tipo_vinculo: 'inquilino', nome_votante: 'Igor Inquilino', rotulo_unidade: 'Apto 11 Bloco A', created_at: t('12:00'), substituido_em: t('13:00') },
    { id: 2, id_opcao: 51, id_user: 10, id_apto: 100, tipo_vinculo: 'proprietario', nome_votante: 'Paula Proprietária', rotulo_unidade: 'Apto 11 Bloco A', created_at: t('13:00') },
    // Unidade 200: voto antigo (sem retrato) do proprietário legado 20.
    { id: 3, id_opcao: 52, id_user: 20, id_apto: 200, created_at: t('11:00') },
    // Conta excluída, voto novo: continua no mapa com o retrato.
    { id: 4, id_opcao: 51, id_user: null, id_apto: null, tipo_vinculo: 'proprietario', nome_votante: 'Ex-morador', rotulo_unidade: 'Apto 31', created_at: t('10:00') },
  ] as any;
  const porteiro: any = { sub: 3, nome: 'João', id_condominio: 1, tipo_sub: 'funcionario_portaria' };

  function encerrada() {
    const b = build({ votos: VOTOS });
    b.votacoes[0].encerrada_em = new Date('2026-11-14T20:00:00Z');
    b.votacoes[0].somente_proprietarios = 0;
    return b;
  }

  it('aberta: 400 e nada é revelado', async () => {
    const { svc } = build({ votos: VOTOS });
    await expect(svc.mapaVotacao(5, sindico)).rejects.toThrow(
      new BadRequestException('O mapa de votação fica disponível quando a votação é encerrada.'),
    );
  });

  it('porteiro do console (token sem typeAccess) e morador: 403', async () => {
    const { svc } = encerrada();
    await expect(svc.mapaVotacao(5, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.mapaVotacao(5, morador(10))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('encerrada: todos os votos, inclusive os substituídos, por unidade e hora, com datas de Brasília', async () => {
    const { svc } = encerrada();
    const mapa = await svc.mapaVotacao(5, sindico);
    expect(mapa.votacao).toEqual({ id: 5, titulo: 'Contas 2025', somente_proprietarios: 0, encerrada_em: '14/11/2026 17:00:00' });
    expect(mapa.participacao).toEqual({ unidades_votaram: 3, unidades_total: 3 });
    expect(mapa.opcoes).toEqual([{ id: 51, nome: 'Aprovar', votos: 2 }, { id: 52, nome: 'Rejeitar', votos: 1 }]);
    expect(mapa.votos).toEqual([
      { unidade: 'Apto 11 Bloco A', votante: 'Igor Inquilino', tipo_vinculo: 'inquilino', opcao: 'Rejeitar', registrado_em: '14/11/2026 09:00:00', vigente: false, substituido_em: '14/11/2026 10:00:00' },
      { unidade: 'Apto 11 Bloco A', votante: 'Paula Proprietária', tipo_vinculo: 'proprietario', opcao: 'Aprovar', registrado_em: '14/11/2026 10:00:00', vigente: true, substituido_em: null },
      { unidade: 'Apto 21 Bloco A', votante: 'Vinte', tipo_vinculo: 'proprietario', opcao: 'Rejeitar', registrado_em: '14/11/2026 08:00:00', vigente: true, substituido_em: null },
      { unidade: 'Apto 31', votante: 'Ex-morador', tipo_vinculo: 'proprietario', opcao: 'Aprovar', registrado_em: '14/11/2026 07:00:00', vigente: true, substituido_em: null },
    ]);
  });

  it('confere o condomínio da votação (tenant)', async () => {
    const { svc } = encerrada();
    const tenant = (svc as any).tenant;
    await svc.mapaVotacao(5, sindico);
    expect(tenant.assertEntidade).toHaveBeenCalledWith(COND, sindico, expect.stringContaining('5'));
  });

  it('rota GET votacoes/mapa?id= repassa o id e o token', () => {
    const service: any = { mapaVotacao: jest.fn(async () => ({})) };
    new AssembleiasController(service).mapa('5', sindico);
    expect(service.mapaVotacao).toHaveBeenCalledWith(5, sindico);
  });

  describe('texto canônico (base do código de integridade)', () => {
    it('é determinístico, sem participação nem hora de encerramento, e muda quando um voto muda', async () => {
      const { svc } = encerrada();
      const mapa = await svc.mapaVotacao(5, sindico);
      const texto = textoCanonicoMapa(mapa);
      expect(texto).toBe(textoCanonicoMapa(JSON.parse(JSON.stringify(mapa))));
      expect(texto.split('\n')[0]).toBe('mapa-de-votacao v1');
      expect(texto).toContain('["Apto 11 Bloco A","Igor Inquilino","inquilino","Rejeitar","14/11/2026 09:00:00",false,"14/11/2026 10:00:00"]');
      expect(textoCanonicoMapa({ ...mapa, participacao: { unidades_votaram: 0, unidades_total: 99 }, votacao: { ...mapa.votacao, encerrada_em: null } })).toBe(texto);
      const alterado = { ...mapa, votos: mapa.votos.map((v, i) => (i === 1 ? { ...v, opcao: 'Rejeitar' } : v)) };
      expect(textoCanonicoMapa(alterado)).not.toBe(texto);
      expect(hashMapas([mapa])).toMatch(/^[0-9a-f]{64}$/);
      expect(hashMapas([mapa])).toBe(hashMapas([JSON.parse(JSON.stringify(mapa))]));
    });
  });
});

describe('2.5 — nada some', () => {
  const t = (hhmm: string) => new Date(`2026-11-14T${hhmm}:00Z`);
  const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';
  const VOTOS = [
    { id: 1, id_opcao: 52, id_user: 11, id_apto: 100, tipo_vinculo: 'inquilino', nome_votante: 'Igor Inquilino', rotulo_unidade: 'Apto 11 Bloco A', created_at: t('12:00'), substituido_em: t('13:00') },
    { id: 2, id_opcao: 51, id_user: 10, id_apto: 100, tipo_vinculo: 'proprietario', nome_votante: 'Paula Proprietária', rotulo_unidade: 'Apto 11 Bloco A', created_at: t('13:00') },
    { id: 3, id_opcao: 52, id_user: 21, id_apto: 200, tipo_vinculo: 'inquilino', nome_votante: 'Vinte e Um', rotulo_unidade: 'Apto 21 Bloco A', created_at: t('13:30') },
  ] as any;
  // Assembleia 3 com duas pautas: 5 (aberta) e 8 (já encerrada pela data).
  const comDuasPautas = () =>
    build({
      votos: VOTOS,
      votacoes: [
        { id: 5, id_assembleia: 3, is_enquete: 0, titulo: 'Contas 2025', somente_proprietarios: 1, opcoes: [{ id: 51, nome: 'Aprovar' }, { id: 52, nome: 'Rejeitar' }] },
        { id: 8, id_assembleia: 3, is_enquete: 0, titulo: 'Obra', data_termino: new Date('2026-11-01T00:00:00Z'), opcoes: [{ id: 81, nome: 'Sim' }, { id: 82, nome: 'Não' }] },
        { id: 6, id_assembleia: null, is_enquete: 1, titulo: 'Cor da fachada', opcoes: [{ id: 61, nome: 'Azul' }, { id: 62, nome: 'Verde' }] },
      ],
    });
  const textoDoUpload = (storage: any, n: number) =>
    Buffer.from(storage.uploadDataUrl.mock.calls[n][0].split('base64,')[1], 'base64').toString('utf8');

  describe('finish (finalizar com a ATA)', () => {
    it('NÃO apaga: marca finalizada (quem, quando, ATA, hash), encerra as pautas abertas e mantém os votos', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-15T13:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
      try {
        const { svc, prisma, assembleias, votacoes, votos, documentos } = comDuasPautas();
        const res: any = await svc.finish(COND, { id: 3, doc: PDF }, sindico);
        expect(res.message).toContain('ATA');
        expect(prisma.assembleias.delete).not.toHaveBeenCalled();
        expect(prisma.votacoes.delete).not.toHaveBeenCalled();
        expect(votos).toHaveLength(3);
        const ata = documentos.find((d) => d.nome.startsWith('ATA '));
        expect(assembleias[0]).toMatchObject({
          finalizada_em: new Date('2026-11-15T13:00:00Z'), finalizada_por: 7, id_documento_ata: ata.id,
        });
        expect(assembleias[0].apuracao_hash).toMatch(/^[0-9a-f]{64}$/);
        // A pauta aberta foi encerrada agora (e o término futuro virou hoje); a já encerrada pela data não.
        expect(votacoes[0].encerrada_em).toEqual(new Date('2026-11-15T13:00:00Z'));
        expect(votacoes[0].data_termino.toISOString().slice(0, 10)).toBe('2026-11-15');
        expect(votacoes[1].encerrada_em).toBeNull();
        expect(votacoes[2].encerrada_em).toBeNull(); // enquete avulsa não é da assembleia
      } finally {
        jest.useRealTimers();
      }
    });

    it('apuração publicada: totais, participação, "somente proprietários", a regra e o código de integridade — sem nomes', async () => {
      const { svc, storage, documentos, assembleias } = comDuasPautas();
      await svc.finish(COND, { id: 3, doc: PDF }, sindico);
      const texto = textoDoUpload(storage, 1);
      expect(texto).toContain('1. Contas 2025');
      expect(texto).toContain('Somente proprietários votam nesta pauta.');
      expect(texto).toContain('- Aprovar: 1 voto(s)');
      expect(texto).toContain('- Rejeitar: 1 voto(s)');
      expect(texto).toContain('Participação: 2 de 3 unidades');
      expect(texto).toContain('2. Obra');
      expect(texto).toContain('Participação: 0 de 3 unidades');
      expect(texto).toMatch(/Regra: um voto por unidade/);
      expect(texto).toContain('Código de integridade do mapa de votação: ' + assembleias[0].apuracao_hash);
      for (const nome of ['Paula', 'Igor', 'Vinte e Um']) expect(texto).not.toContain(nome);
      expect(documentos.map((d) => d.nome)).toEqual(['ATA AGO 2026 - 20/11/2026', 'Apuração das pautas - ATA AGO 2026 - 20/11/2026']);
    });

    it('o hash confere com o mapa de votação que o síndico baixa depois', async () => {
      const { svc, assembleias } = comDuasPautas();
      await svc.finish(COND, { id: 3, doc: PDF }, sindico);
      const mapas = [await svc.mapaVotacao(5, sindico), await svc.mapaVotacao(8, sindico)];
      expect(hashMapas(mapas)).toBe(assembleias[0].apuracao_hash);
    });

    it('finalizar de novo: 400 "Assembleia já finalizada." e nada é publicado', async () => {
      const { svc, prisma, storage } = comDuasPautas();
      await svc.finish(COND, { id: 3, doc: PDF }, sindico);
      prisma.documentos.create.mockClear();
      storage.uploadDataUrl.mockClear();
      await expect(svc.finish(COND, { id: 3, doc: PDF }, sindico)).rejects.toThrow(new BadRequestException('Assembleia já finalizada.'));
      expect(prisma.documentos.create).not.toHaveBeenCalled();
      expect(storage.uploadDataUrl).not.toHaveBeenCalled();
    });

    it('corrida: outra finalização confirmou antes — a transação desfaz (400) e o PDF enviado sai do bucket', async () => {
      const { svc, prisma, storage } = comDuasPautas();
      prisma.assembleias.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(svc.finish(COND, { id: 3, doc: PDF }, sindico)).rejects.toThrow('Assembleia já finalizada.');
      expect(storage.deleteUrl).toHaveBeenCalled();
    });

    it('payload exato do app 1.2.48 (modal_finalizar_assembleia: id, titulo, data, doc) continua 200', async () => {
      const { svc } = comDuasPautas();
      const ctrl = new AssembleiasController(svc);
      const body = { id_condominio: '1', assembleia: { id: 3, titulo: 'AGO 2026', data: '20/11/2026', doc: PDF } };
      await expect(ctrl.finish(body, sindico)).resolves.toEqual(expect.objectContaining({ message: expect.any(String) }));
    });
  });

  describe('assembleia finalizada é imutável', () => {
    const finalizada = () => {
      const b = comDuasPautas();
      b.assembleias[0].finalizada_em = new Date('2026-11-15T13:00:00Z');
      return b;
    };

    it('update: 400 e nada é gravado', async () => {
      const { svc, prisma } = finalizada();
      await expect(svc.update(COND, { id: 3, titulo: 'Outro' }, 7, sindico)).rejects.toThrow(
        new BadRequestException('Assembleia finalizada não pode ser editada.'),
      );
      expect(prisma.assembleias.updateMany).not.toHaveBeenCalled();
    });

    it('remove: 400', async () => {
      const { svc, prisma } = finalizada();
      await expect(svc.remove(3, sindico)).rejects.toThrow(new BadRequestException('Assembleia finalizada não pode ser excluída.'));
      expect(prisma.assembleias.delete).not.toHaveBeenCalled();
    });

    it('nova pauta: 400', async () => {
      const { svc, prisma } = finalizada();
      await expect(
        svc.insertVotacao({ titulo: 'Nova', data_inicio: '01/12/2026', data_termino: '10/12/2026', opcoes: ['Sim', 'Não'], id_assembleia: 3 }, COND, sindico),
      ).rejects.toThrow(new BadRequestException('Assembleia finalizada não aceita novas pautas.'));
      expect(prisma.votacoes.create).not.toHaveBeenCalled();
    });

    it('excluir pauta dela: 400 (mesmo sem voto)', async () => {
      const { svc, prisma } = finalizada();
      await expect(svc.removeVotacao(8, sindico)).rejects.toThrow(
        new BadRequestException('Pauta de assembleia finalizada não pode ser excluída.'),
      );
      expect(prisma.votacoes.delete).not.toHaveBeenCalled();
    });

    it('votar: 400', async () => {
      const { svc } = finalizada();
      await expect(votar(svc, 10, 5, 51)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('excluir com voto', () => {
    it('assembleia NÃO finalizada com voto (vigente ou não) em qualquer pauta: 400', async () => {
      const { svc, prisma } = comDuasPautas();
      await expect(svc.remove(3, sindico)).rejects.toThrow(
        new BadRequestException('Esta assembleia já tem votos e não pode ser excluída. Finalize-a com a ATA.'),
      );
      expect(prisma.assembleias.delete).not.toHaveBeenCalled();
      // Só um voto substituído também conta.
      const b = build({ votos: [{ ...VOTOS[0] }] });
      await expect(b.svc.remove(3, sindico)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('assembleia sem voto: exclui', async () => {
      const { svc, prisma } = build();
      await expect(svc.remove(3, sindico)).resolves.toEqual({ success: true });
      expect(prisma.assembleias.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    });

    it('pauta de assembleia com voto: 400; sem voto: exclui', async () => {
      const { svc, prisma } = comDuasPautas();
      await expect(svc.removeVotacao(5, sindico)).rejects.toThrow(
        new BadRequestException('Esta pauta já tem votos e não pode ser excluída. Encerre a votação.'),
      );
      await expect(svc.removeVotacao(8, sindico)).resolves.toEqual({ success: true });
      expect(prisma.votacoes.delete.mock.calls.map((c: any) => c[0].where.id)).toEqual([8]);
    });

    it('enquete avulsa continua podendo ser excluída, mesmo com voto', async () => {
      const { svc, prisma } = build({ votos: [{ id: 1, id_opcao: 61, id_user: 10, id_apto: 100, tipo_vinculo: 'proprietario' }] });
      await expect(svc.removeVotacao(6, sindico)).resolves.toEqual({ success: true });
      expect(prisma.votacoes.delete).toHaveBeenCalledWith({ where: { id: 6 } });
    });
  });

  describe('getAll e get', () => {
    const tres = () =>
      build({
        assembleias: [
          { id: 3, titulo: 'AGO', data: new Date('2026-11-20T00:00:00Z'), finalizada_em: new Date('2026-11-21T15:00:00Z'), id_documento_ata: 900 },
          { id: 4, titulo: 'AGE', data: new Date('2026-12-01T00:00:00Z') },
          { id: 2, titulo: 'Antiga', data: new Date('2026-10-01T00:00:00Z') },
        ],
      });

    it('padrão (app 1.2.48): só as NÃO finalizadas', async () => {
      const { svc } = tres();
      const lista: any[] = await svc.getAll(COND, sindico);
      expect(lista.map((a) => a.id).sort()).toEqual([2, 4]);
      expect(lista.every((a) => a.finalizada === false && a.finalizada_em === null)).toBe(true);
    });

    it('incluir_finalizadas: todas, com finalizada/finalizada_em, finalizadas por último', async () => {
      const { svc, prisma } = tres();
      prisma.assembleias.findMany.mockImplementation(async ({ where }: any) =>
        [
          { id: 2, id_condominio: 1, titulo: 'Antiga', data: new Date('2026-10-01T00:00:00Z'), hora: null, finalizada_em: null },
          { id: 3, id_condominio: 1, titulo: 'AGO', data: new Date('2026-11-20T00:00:00Z'), hora: null, finalizada_em: new Date('2026-11-21T15:00:00Z') },
          { id: 4, id_condominio: 1, titulo: 'AGE', data: new Date('2026-12-01T00:00:00Z'), hora: null, finalizada_em: null },
        ].filter((a) => casa(a, where)),
      );
      const lista: any[] = await svc.getAll(COND, sindico, true);
      expect(lista.map((a) => [a.id, a.finalizada, a.finalizada_em])).toEqual([
        [2, false, null],
        [4, false, null],
        [3, true, '2026-11-21T15:00:00.000Z'],
      ]);
    });

    it('controller: ?incluir_finalizadas=1 liga; ausente não', () => {
      const service: any = { getAll: jest.fn(async () => []) };
      const ctrl = new AssembleiasController(service);
      ctrl.getAll('1', sindico);
      ctrl.getAll('1', sindico, '1');
      ctrl.getAll('1', sindico, 'true');
      ctrl.getAll('1', sindico, '0');
      expect(service.getAll.mock.calls.map((c: any) => c[2])).toEqual([false, true, true, false]);
    });

    it('get de uma finalizada: finalizada, finalizada_em e link_ata (do Documento da ATA)', async () => {
      const { svc, documentos } = tres();
      documentos.push({ id: 900, id_condominio: 1, nome: 'ATA AGO', link_doc: 'https://bucket.s3.amazonaws.com/atas/ata.pdf' });
      const r: any = await svc.get(COND, 3, 10, morador(10));
      expect(r.assembleia).toMatchObject({ id: 3, finalizada: true, finalizada_em: '2026-11-21T15:00:00.000Z', link_ata: 'https://bucket.s3.amazonaws.com/atas/ata.pdf' });
      const aberta: any = await svc.get(COND, 4, 10, morador(10));
      expect(aberta.assembleia).toMatchObject({ finalizada: false, finalizada_em: null, link_ata: null });
    });
  });
});

describe('2.5 — corridas e bordas da finalização', () => {
  const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';
  const umVoto = [{ id: 1, id_opcao: 51, id_user: 10, id_apto: 100, tipo_vinculo: 'proprietario', nome_votante: 'P', rotulo_unidade: 'Apto 11 Bloco A' }] as any;

  it('voto que chega enquanto a ATA sobe: a finalização desfaz (409) e os arquivos enviados saem do bucket', async () => {
    const { svc, prisma, storage, assembleias, votos } = build({ votos: umVoto });
    // O segundo upload (apuração) é o momento em que outro morador vota.
    const real = storage.uploadDataUrl.getMockImplementation();
    storage.uploadDataUrl.mockImplementation(async (d: string, pasta: string) => {
      if (storage.uploadDataUrl.mock.calls.length === 2) {
        votos.push({ id: 2, id_opcao: 52, id_user: 20, id_apto: 200, created_at: new Date(), tipo_vinculo: 'proprietario', nome_votante: 'V', rotulo_unidade: 'Apto 21 Bloco A', substituido_em: null });
      }
      return real(d, pasta);
    });
    await expect(svc.finish(COND, { id: 3, doc: PDF }, sindico)).rejects.toThrow(
      new ConflictException('Chegaram votos durante a finalização. Confira a apuração e finalize de novo.'),
    );
    expect(assembleias[0].finalizada_em).toBeNull();
    expect(storage.deleteUrl).toHaveBeenCalledTimes(2);
    expect(prisma.assembleias.delete).not.toHaveBeenCalled();
  });

  it('"Encerrar" pauta de assembleia finalizada: sucesso sem regravar', async () => {
    const { svc, prisma, votacoes } = build({ assembleias: [{ id: 3, finalizada_em: new Date('2026-11-15T13:00:00Z') }] });
    votacoes[0].data_termino = new Date('2026-11-01T00:00:00Z'); // encerrada pela data, sem encerrada_em
    await expect(svc.finishVotacao(5, sindico)).resolves.toEqual({ success: true });
    expect(prisma.votacoes.update).not.toHaveBeenCalled();
  });
});
