import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AssembleiasController } from './assembleias.controller';
import { AssembleiasService } from './assembleias.service';

/**
 * Voto por UNIDADE, gravado no próprio voto (`Votacoes_Usuarios.id_apto`).
 *
 * Antes a coluna não existia: cada conta votava pela "unidade atribuída" (o
 * menor `id_apto` dos vínculos dela) e quem tinha duas unidades votava por uma
 * só. Agora:
 *  - o voto grava a unidade; o app manda `id_apto` quando a pessoa tem mais de
 *    uma unidade no condomínio;
 *  - `id_apto` de unidade sem vínculo com o usuário → 403;
 *  - sem `id_apto` (app antigo) → a única unidade, ou a menor `id_apto` quando
 *    há várias (a mesma atribuída de antes, para não quebrar o app antigo);
 *  - um voto por (votação, unidade): o novo apaga o da mesma unidade — inclusive
 *    o voto antigo, sem `id_apto`, de conta cuja unidade atribuída é ela — e
 *    nunca o de outra unidade;
 *  - a apuração deduplica por `id_apto` (ou pela unidade atribuída no voto
 *    antigo), fica com o mais recente e descarta votante sem vínculo.
 *
 * O prisma aqui é um banco em memória (filtros `in`, `null`, `OR` e o filtro
 * de relação `opcao`), então os testes conferem o RESULTADO — o que ficou
 * gravado e como foi apurado —, não o formato das consultas.
 */
describe('Votação — um voto por unidade (id_apto no voto)', () => {
  const COND = 1;

  // Unidades do condomínio 1: 100 (Apto 11 Bloco A), 200 (Apto 21 Bloco A),
  // 300 (Apto 31, sem bloco). 400 é de outro condomínio (2).
  const APTOS = [
    { id: 100, id_condominio: 1, bloco: 'A', apto: '11' },
    { id: 200, id_condominio: 1, bloco: 'A', apto: '21' },
    { id: 300, id_condominio: 1, bloco: null, apto: '31' },
    { id: 400, id_condominio: 2, bloco: null, apto: '41' },
  ];
  // 50 e 51 moram no 100; X=60 tem o 200 e o 300; Y=61 só o 300;
  // 70 só tem unidade no outro condomínio; 80 (síndico) não tem unidade.
  const VINCULOS_PADRAO = [
    { id_user: 50, id_apto: 100 },
    { id_user: 51, id_apto: 100 },
    { id_user: 60, id_apto: 300 },
    { id_user: 60, id_apto: 200 },
    { id_user: 61, id_apto: 300 },
    { id_user: 70, id_apto: 400 },
  ];
  // Votação 5 (enquete, opções 9 e 10) e votação 6 (mesma assembleia 3,
  // opções 11 e 12): votar numa não mexe na outra.
  const VOTACOES = [
    { id: 5, id_condominio: COND, id_assembleia: 3, is_enquete: 1, titulo: 'Fachada', opcoes: [{ id: 9, nome: 'Sim' }, { id: 10, nome: 'Não' }] },
    { id: 6, id_condominio: COND, id_assembleia: 3, is_enquete: 0, titulo: 'Portão', opcoes: [{ id: 11, nome: 'Sim' }, { id: 12, nome: 'Não' }] },
  ];

  type Voto = { id: number; id_opcao: number; id_user: number; id_apto: number | null; created_at: Date };

  /** Avalia um `where` do Prisma sobre um objeto (o subconjunto que o serviço usa). */
  function casa(row: any, where: any, relacoes: Record<string, (row: any, sub: any) => boolean> = {}): boolean {
    if (!where) return true;
    return Object.entries(where).every(([campo, filtro]: [string, any]) => {
      if (campo === 'OR') return (filtro as any[]).some((w) => casa(row, w, relacoes));
      if (campo === 'AND') return (filtro as any[]).every((w) => casa(row, w, relacoes));
      if (relacoes[campo]) return relacoes[campo](row, filtro);
      const v = row[campo];
      if (filtro === null) return v === null || v === undefined;
      if (typeof filtro === 'object' && !(filtro instanceof Date)) {
        if ('in' in filtro) return filtro.in.includes(v);
        if ('equals' in filtro) return v === filtro.equals;
        throw new Error(`filtro não suportado no fake: ${campo} ${JSON.stringify(filtro)}`);
      }
      return v === filtro;
    });
  }

  function build(opts: { votos?: any[]; vinculos?: typeof VINCULOS_PADRAO } = {}) {
    const vinculos = opts.vinculos ?? VINCULOS_PADRAO;
    let seq = 1000;
    let relogio = Date.parse('2026-11-11T12:00:00Z');
    const votos: Voto[] = (opts.votos ?? []).map((v: any) => ({ id_apto: null, ...v }));
    const ordem: string[] = [];
    const locks: Array<{ sql: string; valores: unknown[] }> = [];

    const opcaoDe = (idOpcao: number) => {
      for (const vt of VOTACOES) {
        const op = vt.opcoes.find((o) => o.id === idOpcao);
        if (op) return { ...op, id_votacao: vt.id, votacao: vt };
      }
      return undefined;
    };
    const relVoto = {
      opcao: (row: Voto, sub: any) => {
        const op = opcaoDe(row.id_opcao);
        if (!op) return false;
        if (sub.id_votacao !== undefined && op.id_votacao !== sub.id_votacao) return false;
        if (sub.votacao?.id_assembleia !== undefined && op.votacao.id_assembleia !== sub.votacao.id_assembleia) return false;
        return true;
      },
    };
    const linhaVinculo = (v: { id_user: number; id_apto: number }) => {
      const apto = APTOS.find((a) => a.id === v.id_apto)!;
      return { ...v, apartamento: apto };
    };
    const relVinculo = {
      apartamento: (row: any, sub: any) => casa(row.apartamento, sub),
    };
    const ordenarVotos = (lista: Voto[], orderBy: any) => {
      if (!orderBy) return lista;
      return [...lista].sort((a, b) => (b.created_at.getTime() - a.created_at.getTime()) || (b.id - a.id));
    };

    const prisma: any = {
      isConnected: true,
      votacoes: {
        findUnique: jest.fn(async ({ where }: any) => {
          const vt = VOTACOES.find((v) => v.id === where.id);
          if (!vt) return null;
          return {
            ...vt,
            data_inicio: new Date('2020-01-01T00:00:00Z'),
            data_termino: new Date('2099-01-01T00:00:00Z'),
            opcoes: vt.opcoes.map((o) => ({ id: o.id })),
          };
        }),
        findMany: jest.fn(async ({ where }: any) =>
          VOTACOES.filter((vt) => casa(vt, where)).map((vt) => ({
            ...vt,
            descricao: null,
            data_inicio: null,
            data_termino: null,
            created_at: new Date('2026-11-01T00:00:00Z'),
            opcoes: vt.opcoes.map((o) => ({
              ...o,
              votos: votos
                .filter((v) => v.id_opcao === o.id)
                .map((v) => ({ id: v.id, id_user: v.id_user, id_apto: v.id_apto, created_at: v.created_at })),
            })),
          })),
        ),
      },
      apartamentos_Users: {
        findMany: jest.fn(async ({ where }: any) =>
          vinculos.map(linhaVinculo).filter((row) => casa(row, where, relVinculo)),
        ),
      },
      votacoes_Usuarios: {
        deleteMany: jest.fn(async ({ where }: any) => {
          ordem.push('deleteMany');
          const antes = votos.length;
          for (let i = votos.length - 1; i >= 0; i--) if (casa(votos[i], where, relVoto)) votos.splice(i, 1);
          return { count: antes - votos.length };
        }),
        create: jest.fn(async ({ data }: any) => {
          ordem.push('create');
          relogio += 60_000;
          const novo: Voto = { id: ++seq, id_apto: null, created_at: new Date(relogio), ...data };
          votos.push(novo);
          return novo;
        }),
        findFirst: jest.fn(async ({ where, orderBy }: any) =>
          ordenarVotos(votos.filter((v) => casa(v, where, relVoto)), orderBy)[0] ?? null,
        ),
        findMany: jest.fn(async ({ where, orderBy }: any) =>
          ordenarVotos(votos.filter((v) => casa(v, where, relVoto)), orderBy),
        ),
      },
      assembleias: {
        findFirst: jest.fn(async () => ({ id: 3, titulo: 'AGO', descricao: null, data: null, hora: null, link: '', local: '', anexos: '' })),
      },
    };
    const raw = jest.fn(async (strings: TemplateStringsArray, ...valores: unknown[]) => {
      ordem.push('lock');
      locks.push({ sql: strings.join('?'), valores });
      return [];
    });
    prisma.$queryRaw = raw;
    prisma.$executeRaw = raw;
    prisma.$transaction = jest.fn(async (fn: any) => {
      ordem.push('tx');
      return fn(prisma);
    });
    const tenant: any = { assertEntidade: jest.fn(async () => undefined), assertCondominio: jest.fn(async () => undefined) };
    const svc = new AssembleiasService(prisma, {} as any, tenant);
    return { svc, prisma, votos, ordem, locks };
  }

  const token = (id: number, typeAccess = 'Morador') => ({ sub: id, nome: `U${id}`, typeAccess, user: { id } }) as any;
  const votar = (svc: AssembleiasService, user: number, opcao: number, idApto?: number, votacao = opcao >= 11 ? 6 : 5) =>
    (svc as any).registerVoto(votacao, opcao, user, token(user), idApto);
  const apurar = async (svc: AssembleiasService, votacao = 5) =>
    (await (svc as any).getVotacoesFormatadas(undefined, false, undefined, votacao))[0].opcoes;
  const t = (hhmm: string) => new Date(`2026-11-10T${hhmm}:00Z`);

  describe('registerVoto', () => {
    it('duas unidades da mesma pessoa contam 2 votos', async () => {
      const { svc, votos } = build();
      await votar(svc, 60, 9, 200);
      await votar(svc, 60, 10, 300);
      expect(votos.map((v) => [v.id_user, v.id_apto, v.id_opcao])).toEqual([[60, 200, 9], [60, 300, 10]]);
      expect(await apurar(svc)).toEqual(['9;Sim;1', '10;Não;1']);
    });

    it('votar de novo pela mesma unidade troca só o voto dela', async () => {
      const { svc, votos } = build();
      await votar(svc, 60, 9, 200);
      await votar(svc, 60, 9, 300);
      await votar(svc, 60, 10, 200);
      expect(votos.map((v) => [v.id_apto, v.id_opcao])).toEqual([[300, 9], [200, 10]]);
      expect(await apurar(svc)).toEqual(['9;Sim;1', '10;Não;1']);
    });

    it('outra conta da mesma unidade substitui o voto da unidade', async () => {
      const { svc, votos } = build();
      await votar(svc, 50, 9);
      await votar(svc, 51, 10);
      expect(votos.map((v) => [v.id_user, v.id_apto, v.id_opcao])).toEqual([[51, 100, 10]]);
      expect(await apurar(svc)).toEqual(['9;Sim;0', '10;Não;1']);
    });

    it('o voto de Y (só 300) não apaga o de X pela 200', async () => {
      const { svc, votos } = build();
      await votar(svc, 60, 9, 200);
      await votar(svc, 61, 10);
      expect(votos.map((v) => [v.id_user, v.id_apto])).toEqual([[60, 200], [61, 300]]);
      expect(await apurar(svc)).toEqual(['9;Sim;1', '10;Não;1']);
    });

    it('voto antigo (id_apto nulo) é substituído pelo voto novo da mesma unidade atribuída', async () => {
      const { svc, votos } = build({ votos: [{ id: 1, id_user: 50, id_opcao: 9, created_at: t('10:00') }] });
      await votar(svc, 51, 10);
      expect(votos.map((v) => [v.id_user, v.id_apto, v.id_opcao])).toEqual([[51, 100, 10]]);
      expect(await apurar(svc)).toEqual(['9;Sim;0', '10;Não;1']);
    });

    it('voto antigo de X (atribuído à 200) fica quando X vota pela 300, e sai quando vota pela 200', async () => {
      const { svc, votos } = build({ votos: [{ id: 1, id_user: 60, id_opcao: 9, created_at: t('10:00') }] });
      await votar(svc, 60, 10, 300);
      expect(votos.map((v) => [v.id, v.id_apto])).toEqual([[1, null], [1001, 300]]);
      expect(await apurar(svc)).toEqual(['9;Sim;1', '10;Não;1']);

      await votar(svc, 60, 10, 200);
      expect(votos.map((v) => v.id_apto)).toEqual([300, 200]);
      expect(await apurar(svc)).toEqual(['9;Sim;0', '10;Não;2']);
    });

    it('voto antigo de Y (atribuído à 300) sai quando X vota pela 300', async () => {
      const { svc, votos } = build({ votos: [{ id: 1, id_user: 61, id_opcao: 9, created_at: t('10:00') }] });
      await votar(svc, 60, 10, 300);
      expect(votos.map((v) => [v.id_user, v.id_apto])).toEqual([[60, 300]]);
    });

    it('não apaga voto de outra votação', async () => {
      const { svc, votos } = build();
      await votar(svc, 50, 11); // votação 6
      await votar(svc, 51, 9); // votação 5, mesma unidade
      expect(votos.map((v) => [v.id_user, v.id_opcao])).toEqual([[50, 11], [51, 9]]);
    });

    it('id_apto de unidade sem vínculo com o usuário → 403', async () => {
      const { svc, votos } = build();
      await expect(votar(svc, 61, 9, 200)).rejects.toThrow(new ForbiddenException('Você não tem vínculo com esta unidade.'));
      // Unidade de outro condomínio, mesmo com vínculo: não é desta votação.
      await expect(votar(svc, 70, 9, 400)).rejects.toBeInstanceOf(ForbiddenException);
      // Unidade inexistente.
      await expect(votar(svc, 60, 9, 999)).rejects.toThrow(new ForbiddenException('Você não tem vínculo com esta unidade.'));
      expect(votos).toEqual([]);
    });

    it('id_apto que não é número inteiro positivo → 400', async () => {
      const { svc, votos } = build();
      await expect(votar(svc, 60, 9, Number.NaN)).rejects.toBeInstanceOf(BadRequestException);
      await expect(votar(svc, 60, 9, 0)).rejects.toBeInstanceOf(BadRequestException);
      expect(votos).toEqual([]);
    });

    it('sem id_apto e com UMA unidade: vota por ela', async () => {
      const { svc, votos } = build();
      await votar(svc, 61, 9);
      expect(votos.map((v) => v.id_apto)).toEqual([300]);
    });

    it('sem id_apto e com VÁRIAS unidades (app antigo): vota pela menor id_apto, como antes', async () => {
      const { svc, votos } = build();
      await votar(svc, 60, 9);
      expect(votos.map((v) => v.id_apto)).toEqual([200]);
    });

    it('sem nenhuma unidade no condomínio continua 403', async () => {
      const { svc } = build();
      await expect(votar(svc, 80, 9)).rejects.toThrow(
        new ForbiddenException('Somente moradores com unidade no condomínio podem votar.'),
      );
      await expect(votar(svc, 70, 9)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('trava a linha da unidade (FOR UPDATE) na transação antes de apagar e gravar', async () => {
      const { svc, ordem, locks } = build();
      await votar(svc, 60, 9, 300);
      expect(ordem).toEqual(['tx', 'lock', 'deleteMany', 'create']);
      expect(locks[0].sql).toMatch(/FROM\s+`?Apartamentos`?\s+WHERE\s+`?id`?\s*=\s*\?\s+FOR UPDATE/i);
      expect(locks[0].valores).toEqual([300]);
    });
  });

  describe('apuração', () => {
    it('duas linhas da mesma unidade (corrida) contam 1, a mais recente', async () => {
      const { svc } = build({
        votos: [
          { id: 1, id_user: 50, id_apto: 100, id_opcao: 9, created_at: t('12:00') },
          { id: 2, id_user: 51, id_apto: 100, id_opcao: 10, created_at: t('12:00') },
        ],
      });
      expect(await apurar(svc)).toEqual(['9;Sim;0', '10;Não;1']);
    });

    it('voto novo da unidade vence o voto antigo (nulo) de outra conta atribuída a ela', async () => {
      const { svc } = build({
        votos: [
          { id: 1, id_user: 61, id_apto: null, id_opcao: 9, created_at: t('12:00') }, // atribuído à 300
          { id: 2, id_user: 60, id_apto: 300, id_opcao: 10, created_at: t('12:05') },
          { id: 3, id_user: 60, id_apto: 200, id_opcao: 10, created_at: t('12:06') },
        ],
      });
      expect(await apurar(svc)).toEqual(['9;Sim;0', '10;Não;2']);
    });

    it('voto antigo continua contando pela unidade atribuída', async () => {
      const { svc } = build({
        votos: [
          { id: 1, id_user: 60, id_apto: null, id_opcao: 9, created_at: t('12:00') }, // 200
          { id: 2, id_user: 61, id_apto: null, id_opcao: 9, created_at: t('12:00') }, // 300
        ],
      });
      expect(await apurar(svc)).toEqual(['9;Sim;2', '10;Não;0']);
    });

    it('descarta votante sem vínculo (e voto com id_apto de unidade da qual saiu)', async () => {
      const { svc } = build({
        votos: [
          { id: 1, id_user: 80, id_apto: null, id_opcao: 9, created_at: t('12:00') },
          { id: 2, id_user: 70, id_apto: null, id_opcao: 9, created_at: t('12:00') }, // unidade em outro condomínio
          { id: 3, id_user: 61, id_apto: 200, id_opcao: 9, created_at: t('12:00') }, // não tem vínculo com a 200
          { id: 4, id_user: 50, id_apto: 100, id_opcao: 10, created_at: t('12:00') },
        ],
      });
      expect(await apurar(svc)).toEqual(['9;Sim;0', '10;Não;1']);
    });
  });

  describe('meu voto por unidade', () => {
    it('enquete: lista cada unidade do usuário com o voto que vale nela, e mantém meuVoto', async () => {
      const { svc } = build({
        votos: [
          { id: 1, id_user: 60, id_apto: 200, id_opcao: 9, created_at: t('12:00') },
          { id: 2, id_user: 61, id_apto: 300, id_opcao: 10, created_at: t('12:05') }, // Y votou pela 300
        ],
      });
      const r = await svc.enqueteGetDetails(5, 60, token(60));
      expect(r.unidades).toEqual([
        { id_apto: 200, rotulo: 'Apto 21 Bloco A' },
        { id_apto: 300, rotulo: 'Apto 31' },
      ]);
      expect(r.votosPorUnidade).toEqual([
        { id_votacao: 5, id_apto: 200, rotulo: 'Apto 21 Bloco A', opcao: '9' },
        { id_votacao: 5, id_apto: 300, rotulo: 'Apto 31', opcao: '10' },
      ]);
      // Campo antigo: o voto mais recente da própria conta.
      expect(r.meuVoto).toEqual(['9']);
      expect(r.votacao.opcoes).toEqual(['9;Sim;1', '10;Não;1']);
    });

    it('enquete: unidade sem voto vem com opcao null; meuVoto é o mais recente da conta', async () => {
      const { svc } = build({
        votos: [
          { id: 1, id_user: 60, id_apto: 300, id_opcao: 9, created_at: t('12:00') },
          { id: 2, id_user: 60, id_apto: 200, id_opcao: 10, created_at: t('12:05') },
        ],
      });
      const r = await svc.enqueteGetDetails(5, 60, token(60));
      expect(r.meuVoto).toEqual(['10']);
      const { svc: svc2 } = build();
      const r2 = await svc2.enqueteGetDetails(5, 61, token(61));
      expect(r2.votosPorUnidade).toEqual([{ id_votacao: 5, id_apto: 300, rotulo: 'Apto 31', opcao: null }]);
      expect(r2.meuVoto).toEqual([]);
    });

    it('assembleia: votos por unidade de todas as votações, e meusVotos antigo', async () => {
      const { svc } = build({
        votos: [
          { id: 1, id_user: 60, id_apto: 200, id_opcao: 9, created_at: t('12:00') },
          { id: 2, id_user: 60, id_apto: 300, id_opcao: 12, created_at: t('12:00') },
        ],
      });
      const r: any = await svc.get(COND, 3, 60, token(60));
      expect(r.unidades.map((u: any) => u.id_apto)).toEqual([200, 300]);
      expect(r.votosPorUnidade).toEqual([
        { id_votacao: 5, id_apto: 200, rotulo: 'Apto 21 Bloco A', opcao: '9' },
        { id_votacao: 5, id_apto: 300, rotulo: 'Apto 31', opcao: null },
        { id_votacao: 6, id_apto: 200, rotulo: 'Apto 21 Bloco A', opcao: null },
        { id_votacao: 6, id_apto: 300, rotulo: 'Apto 31', opcao: '12' },
      ]);
      expect([...r.meusVotos].sort()).toEqual(['12', '9']);
    });
  });

  describe('controller', () => {
    it('repassa o id_apto do corpo ao serviço', () => {
      const service: any = { registerVoto: jest.fn(async () => ({ success: true })) };
      const ctrl = new AssembleiasController(service);
      const morador = { sub: 42, nome: 'M', typeAccess: 'Morador' } as any;
      ctrl.registerVoto({ voto: { votacao_id: 5, opcao_id: 9, id_apto: '200' } } as any, morador);
      expect(service.registerVoto).toHaveBeenLastCalledWith(5, 9, 42, morador, 200);
      ctrl.registerVoto({ voto: { votacao_id: 5, opcao_id: 9, id_apto: null } } as any, morador);
      expect(service.registerVoto).toHaveBeenLastCalledWith(5, 9, 42, morador, undefined);
    });
  });
});
