import { BadRequestException } from '@nestjs/common';
import { assertTagNaoEmUso } from './tag-em-uso.util';
import { MobileAuthService } from '../auth/mobile-auth.service';
import { MoradoresService } from '../moradores/moradores.service';
import { VisitantesService } from '../visitantes/visitantes.service';
import { VisitasService } from '../visitas/visitas.service';
import { TagsService } from '../veiculos/tags.service';
import { VeiculosService } from '../veiculos/veiculos.service';

/**
 * Unicidade de tag por VARIANTES (revisão 11/11).
 *
 * A checagem era por texto exato e por tabela: um morador cadastrava pelo app
 * a tag de outro em formato diferente ("12345678" x "BC614E") e passava a ser
 * registrado no lugar dele — ou deixava o outro negado por ambiguidade.
 *
 * Banco em memória mínimo: só o que as consultas do helper filtram.
 */
const MSG = 'Esta tag já está cadastrada para outra pessoa ou veículo.';

type Banco = {
  tags?: any[];
  moradores?: any[];
  visitantes?: any[];
  visitas?: any[];
  veiculos?: any[];
};

const casaCodigo = (filtro: any, valor: string | null | undefined) => {
  if (filtro === undefined) return true;
  if (valor == null) return false;
  return typeof filtro === 'string' ? filtro === valor : filtro.in.includes(valor);
};
const casaId = (filtro: any, id: number) => {
  if (filtro === undefined) return true;
  if (typeof filtro === 'number') return filtro === id;
  if (filtro.not !== undefined) return filtro.not !== id;
  if (filtro.notIn !== undefined) return !filtro.notIn.includes(id);
  return true;
};
const naoEncerrada = (where: any, v: any) =>
  where.OR === undefined || v.data_saida == null || v.liberado === 1;

function prismaFake(banco: Banco) {
  const tags = banco.tags ?? [];
  const moradores = banco.moradores ?? [];
  const visitantes = banco.visitantes ?? [];
  const visitas = banco.visitas ?? [];
  const veiculos = banco.veiculos ?? [];
  const filtraTags = (where: any) =>
    tags.filter(
      (t) =>
        (where.id_condominio === undefined || t.id_condominio === where.id_condominio) &&
        casaCodigo(where.codigo, t.codigo) &&
        casaId(where.id, t.id) &&
        (where.ativo === undefined || t.ativo === where.ativo),
    );
  const filtraVisitas = (lista: any[]) => (where: any) =>
    lista.filter(
      (v) =>
        (where.id_condominio === undefined || v.id_condominio === where.id_condominio) &&
        casaCodigo(where.tag_rfid, v.tag_rfid) &&
        casaId(where.id, v.id) &&
        casaId(where.id_pessoa, v.id_pessoa) &&
        naoEncerrada(where, v),
    );
  const prisma: any = {
    isConnected: true,
    tags: {
      findFirst: jest.fn(async ({ where }: any) => filtraTags(where)[0] ?? null),
      findUnique: jest.fn(async ({ where }: any) => filtraTags(where.id_condominio_codigo)[0] ?? null),
      upsert: jest.fn(async ({ where, create }: any) => {
        const achada = filtraTags(where.id_condominio_codigo)[0];
        return achada ?? { id: 900, ...create };
      }),
    },
    moradores: {
      findFirst: jest.fn(async ({ where }: any) =>
        moradores.find(
          (m) =>
            (where.id_condominio === undefined || m.id_condominio === where.id_condominio) &&
            casaCodigo(where.tag_rfid, m.tag_rfid) &&
            (where.qrcode_acesso === undefined || m.qrcode_acesso === where.qrcode_acesso) &&
            casaId(where.id, m.id) &&
            (where.NOT?.id === undefined || m.id !== where.NOT.id),
        ) ?? null,
      ),
    },
    visitantes: {
      findFirst: jest.fn(async ({ where }: any) => filtraVisitas(visitantes)(where)[0] ?? null),
    },
    visitas: {
      findFirst: jest.fn(async ({ where }: any) => filtraVisitas(visitas)(where)[0] ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
    },
    veiculos: {
      findFirst: jest.fn(async ({ where }: any) =>
        veiculos.find(
          (v) =>
            casaId(where.id, v.id) &&
            (where.id_tag === undefined || v.id_tag === where.id_tag) &&
            (where.ativo === undefined || v.ativo === where.ativo) &&
            (where.id_condominio === undefined || v.id_condominio === where.id_condominio),
        ) ?? null,
      ),
      update: jest.fn(async ({ data }: any) => ({ id: 5, ...data })),
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
    },
  };
  return prisma;
}

describe('assertTagNaoEmUso', () => {
  const flag = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    delete process.env['PESSOAS_MIGRATION_ENABLED'];
  });
  afterAll(() => {
    if (flag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = flag;
  });

  it('código livre passa', async () => {
    await expect(assertTagNaoEmUso(prismaFake({}), 1, 'BC614E')).resolves.toBeUndefined();
  });

  it.each([
    ['Tags (ativa)', { tags: [{ id: 70, id_condominio: 1, codigo: '12345678', ativo: 1 }] }],
    ['Tags (bloqueada)', { tags: [{ id: 70, id_condominio: 1, codigo: '12345678', ativo: 0 }] }],
    ['Moradores.tag_rfid', { moradores: [{ id: 11, id_condominio: 1, tag_rfid: '12345678' }] }],
    [
      'visitante não encerrado',
      { visitantes: [{ id: 30, id_condominio: 1, tag_rfid: '12345678', liberado: 1, data_saida: null }] },
    ],
  ])('recusa "BC614E" quando "12345678" (mesma tag, outro formato) já está em %s', async (_n, banco) => {
    const erro = await assertTagNaoEmUso(prismaFake(banco as Banco), 1, 'BC614E').catch((e) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toBe(MSG);
  });

  it('recusa também o código EXATO em outra tabela', async () => {
    const prisma = prismaFake({ moradores: [{ id: 11, id_condominio: 1, tag_rfid: 'BC614E' }] });

    await expect(assertTagNaoEmUso(prisma, 1, 'BC614E')).rejects.toThrow(MSG);
  });

  it('visitante ENCERRADO (saída registrada e não liberado) não bloqueia: a tag é reaproveitada', async () => {
    const prisma = prismaFake({
      visitantes: [
        { id: 30, id_condominio: 1, tag_rfid: '12345678', liberado: 0, data_saida: new Date('2026-07-01') },
      ],
    });

    await expect(assertTagNaoEmUso(prisma, 1, 'BC614E')).resolves.toBeUndefined();
  });

  it('prestador com saída registrada mas ainda liberado continua dono da tag', async () => {
    const prisma = prismaFake({
      visitantes: [
        { id: 30, id_condominio: 1, tag_rfid: '12345678', liberado: 1, data_saida: new Date('2026-07-01') },
      ],
    });

    await expect(assertTagNaoEmUso(prisma, 1, 'BC614E')).rejects.toThrow(MSG);
  });

  it('outro condomínio não conta', async () => {
    const prisma = prismaFake({
      tags: [{ id: 70, id_condominio: 2, codigo: '12345678', ativo: 1 }],
      moradores: [{ id: 11, id_condominio: 2, tag_rfid: 'BC614E' }],
    });

    await expect(assertTagNaoEmUso(prisma, 1, 'BC614E')).resolves.toBeUndefined();
  });

  it('`ignorar` isenta o próprio registro (Tag, morador, visitante, pessoa)', async () => {
    const prisma = prismaFake({
      tags: [{ id: 70, id_condominio: 1, codigo: '12345678', ativo: 1 }],
      moradores: [{ id: 11, id_condominio: 1, tag_rfid: '12345678' }],
      visitantes: [{ id: 30, id_condominio: 1, tag_rfid: '12345678', liberado: 1, data_saida: null }],
    });

    await expect(
      assertTagNaoEmUso(prisma, 1, 'BC614E', { ignorar: { idTag: 70, idMorador: 11, idsVisitantes: [30] } }),
    ).resolves.toBeUndefined();
    // Isentar um não isenta os outros.
    await expect(assertTagNaoEmUso(prisma, 1, 'BC614E', { ignorar: { idTag: 70 } })).rejects.toThrow(MSG);
  });

  it('com a migração ligada confere Visitas (por pessoa), não Visitantes', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const prisma = prismaFake({
      visitas: [{ id: 40, id_pessoa: 7, id_condominio: 1, tag_rfid: '12345678', liberado: 1, data_saida: null }],
    });

    await expect(assertTagNaoEmUso(prisma, 1, 'BC614E')).rejects.toThrow(MSG);
    await expect(assertTagNaoEmUso(prisma, 1, 'BC614E', { ignorar: { idPessoa: 7 } })).resolves.toBeUndefined();
    expect(prisma.visitantes.findFirst).not.toHaveBeenCalled();
  });
});

describe('unicidade por variantes nos pontos de cadastro', () => {
  const flag = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    delete process.env['PESSOAS_MIGRATION_ENABLED'];
  });
  afterAll(() => {
    if (flag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = flag;
  });

  // --------------------------------------------------- app do morador
  describe('app do morador (vincularTagAoVeiculo)', () => {
    function build(banco: Banco) {
      const prisma = prismaFake(banco);
      const svc: any = Object.create(MobileAuthService.prototype);
      svc.prisma = prisma;
      return { svc, prisma };
    }

    it('NEGA "BC614E" quando outro veículo já usa a Tag "12345678"', async () => {
      const { svc, prisma } = build({
        tags: [{ id: 70, id_condominio: 1, codigo: '12345678', ativo: 1 }],
        veiculos: [{ id: 9, id_tag: 70, ativo: 1 }],
      });

      await expect(svc.vincularTagAoVeiculo(1, 5, 'BC614E')).rejects.toThrow(MSG);

      expect(prisma.tags.upsert).not.toHaveBeenCalled();
      expect(prisma.veiculos.update).not.toHaveBeenCalled();
    });

    it('NEGA quando o código é a tag pessoal de outro morador em outro formato', async () => {
      const { svc, prisma } = build({ moradores: [{ id: 12, id_condominio: 1, tag_rfid: '12345678' }] });

      await expect(svc.vincularTagAoVeiculo(1, 5, 'bc:61:4e')).rejects.toThrow(MSG);
      expect(prisma.tags.upsert).not.toHaveBeenCalled();
    });

    it('PERMITE reenviar o código da Tag que já é DESTE veículo (o app reenvia a cada edição)', async () => {
      const { svc, prisma } = build({
        tags: [{ id: 70, id_condominio: 1, codigo: 'BC614E', ativo: 1 }],
        veiculos: [{ id: 5, id_tag: 70, ativo: 1 }],
        // Cadastro antigo: a mesma tag também como pessoal — não trava a edição.
        moradores: [{ id: 11, id_condominio: 1, tag_rfid: '12345678' }],
      });

      await expect(svc.vincularTagAoVeiculo(1, 5, 'BC614E')).resolves.toBeUndefined();
      expect(prisma.veiculos.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { id_tag: 70 } });
    });

    it('PERMITE vincular uma Tag existente e livre pelo código exato', async () => {
      const { svc, prisma } = build({ tags: [{ id: 70, id_condominio: 1, codigo: 'BC614E', ativo: 1 }] });

      await svc.vincularTagAoVeiculo(1, 5, 'BC614E');

      expect(prisma.veiculos.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { id_tag: 70 } });
    });
  });

  // --------------------------------------------------- Tags (portaria)
  describe('Tags (upsert da portaria)', () => {
    function build(banco: Banco) {
      const prisma = prismaFake(banco);
      return { svc: new TagsService(prisma), prisma };
    }

    it('NEGA criar "BC614E" quando já existe a Tag "12345678"', async () => {
      const { svc, prisma } = build({ tags: [{ id: 70, id_condominio: 1, codigo: '12345678', ativo: 1 }] });

      await expect(svc.upsert(1, { codigo: 'BC614E' })).rejects.toThrow(MSG);
      expect(prisma.tags.upsert).not.toHaveBeenCalled();
    });

    it('NEGA criar Tag com o código da tag pessoal de um morador', async () => {
      const { svc } = build({ moradores: [{ id: 11, id_condominio: 1, tag_rfid: '12345678' }] });

      await expect(svc.upsert(1, { codigo: '0012345678' })).rejects.toThrow(MSG);
    });

    it('PERMITE regravar a própria Tag (mesmo código) — fluxo de captura/seleção da portaria', async () => {
      const { svc, prisma } = build({ tags: [{ id: 70, id_condominio: 1, codigo: 'BC614E', ativo: 1 }] });

      await svc.upsert(1, { codigo: 'bc:61:4e', descricao: 'Carro da Ana' });

      expect(prisma.tags.upsert).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------- morador (tag pessoal)
  describe('morador (assertCredencialDisponivel)', () => {
    function build(banco: Banco) {
      const prisma = prismaFake(banco);
      const svc: any = Object.create(MoradoresService.prototype);
      svc.prisma = prisma;
      return { svc, prisma };
    }

    it('NEGA "BC614E" quando outro morador tem "12345678"', async () => {
      const { svc } = build({ moradores: [{ id: 12, id_condominio: 1, tag_rfid: '12345678' }] });

      await expect(svc.assertCredencialDisponivel(1, 'BC614E', undefined, null)).rejects.toThrow(MSG);
    });

    it('NEGA quando o código é a Tag de um veículo (qualquer estado)', async () => {
      const { svc } = build({ tags: [{ id: 70, id_condominio: 1, codigo: '12345678', ativo: 0 }] });

      await expect(svc.assertCredencialDisponivel(1, 'BC614E', undefined, null)).rejects.toThrow(MSG);
    });

    it('PERMITE o próprio morador (edição) e código livre', async () => {
      const { svc } = build({ moradores: [{ id: 12, id_condominio: 1, tag_rfid: '12345678' }] });

      await expect(svc.assertCredencialDisponivel(1, 'BC614E', undefined, 12)).resolves.toBeUndefined();
      await expect(svc.assertCredencialDisponivel(1, 'ABC999', undefined, null)).resolves.toBeUndefined();
    });
  });

  // --------------------------------------------------- visitante/prestador
  describe('visitante/prestador (atualizarPessoa, legado)', () => {
    function build(banco: Banco, ref: any) {
      const prisma = prismaFake({ ...banco, visitantes: [ref, ...(banco.visitantes ?? [])] });
      prisma.visitantes.findUnique = jest.fn(async () => ref);
      prisma.visitantes.updateMany = jest.fn(async () => ({ count: 1 }));
      const svc: any = Object.create(VisitantesService.prototype);
      svc.prisma = prisma;
      svc.registrosDaPessoa = jest.fn(async () => [ref]);
      svc.auditoria = { registrar: jest.fn(async () => ({})) };
      svc.facial = { syncVisitante: jest.fn(async () => ({})) };
      svc.logger = { warn: jest.fn(), log: jest.fn() };
      return { svc, prisma };
    }
    const REF = (extra: any = {}) => ({
      id: 30,
      id_condominio: 1,
      nome: 'Vítor',
      is_prestador: 1,
      liberado: 1,
      data_saida: null,
      tag_rfid: null,
      ...extra,
    });

    it('NEGA "BC614E" quando um morador tem "12345678"', async () => {
      const { svc, prisma } = build({ moradores: [{ id: 11, id_condominio: 1, tag_rfid: '12345678' }] }, REF());

      await expect(svc.atualizarPessoa(1, 30, { tag_rfid: 'BC614E' })).rejects.toThrow(MSG);
      expect(prisma.visitantes.updateMany).not.toHaveBeenCalled();
    });

    it('NEGA quando OUTRO visitante não encerrado tem a tag em outro formato', async () => {
      const outro = { id: 31, id_condominio: 1, tag_rfid: '12345678', liberado: 1, data_saida: null };
      const { svc } = build({ visitantes: [outro] }, REF());

      await expect(svc.atualizarPessoa(1, 30, { tag_rfid: 'BC614E' })).rejects.toThrow(MSG);
    });

    it('PERMITE tag livre e grava normalizada', async () => {
      const { svc, prisma } = build({}, REF());

      await svc.atualizarPessoa(1, 30, { tag_rfid: ' bc:61:4e ' });

      expect(prisma.visitantes.updateMany.mock.calls[0][0].data.tag_rfid).toBe('BC614E');
    });

    // 4a: a tela reenvia a tag; cadastro antigo fora do padrão não trava a
    // edição dos outros campos.
    it('tag IGUAL à já gravada não é revalidada (cadastro antigo fora do padrão, e duplicado)', async () => {
      const ref = REF({ tag_rfid: 'TAG_#1' });
      const { svc, prisma } = build({ moradores: [{ id: 11, id_condominio: 1, tag_rfid: 'TAG_#1' }] }, ref);

      await svc.atualizarPessoa(1, 30, { nome: 'Vítor Silva', tag_rfid: 'TAG_#1' });

      const data = prisma.visitantes.updateMany.mock.calls[0][0].data;
      expect(data.nome).toBe('Vítor Silva');
      expect(data.tag_rfid).toBe('TAG_#1');
    });

    it('tag DIFERENTE da gravada e inválida continua recusada', async () => {
      const { svc } = build({}, REF({ tag_rfid: 'TAG_#1' }));

      await expect(svc.atualizarPessoa(1, 30, { tag_rfid: 'TAG_#2' })).rejects.toThrow(/tag inválido/i);
    });
  });

  // --------------------------------------------------- visita (Pessoas/Visitas)
  describe('visita (criarVisita)', () => {
    function build(banco: Banco) {
      const prisma = prismaFake(banco);
      prisma.apartamentos = { findUnique: jest.fn(async () => ({ id: 101, id_condominio: 1 })) };
      const pessoas: any = { obterOuCriar: jest.fn(async () => ({ id: 50, nome: 'Visitante' })) };
      return { svc: new VisitasService(prisma, pessoas), prisma, pessoas };
    }
    const base = { id_condominio: 1, id_apartamento: 101, pessoa: { nome: 'Visitante' } };

    it('NEGA "BC614E" quando um morador tem "12345678"', async () => {
      const { svc, prisma } = build({ moradores: [{ id: 11, id_condominio: 1, tag_rfid: '12345678' }] });

      await expect(svc.criarVisita({ ...base, tag_rfid: 'BC614E' })).rejects.toThrow(MSG);
      expect(prisma.visitas.create).not.toHaveBeenCalled();
    });

    it('NEGA quando a visita não encerrada de OUTRA pessoa tem a tag em outro formato', async () => {
      const { svc, prisma } = build({
        visitas: [{ id: 40, id_pessoa: 7, id_condominio: 1, tag_rfid: '12345678', liberado: 1, data_saida: null }],
      });

      await expect(svc.criarVisita({ ...base, tag_rfid: 'BC614E' })).rejects.toThrow(MSG);
      expect(prisma.visitas.create).not.toHaveBeenCalled();
    });

    it('PERMITE a mesma pessoa numa nova visita (a tag é dela) e visita encerrada de outra pessoa', async () => {
      const { svc, prisma } = build({
        visitas: [
          { id: 40, id_pessoa: 50, id_condominio: 1, tag_rfid: '12345678', liberado: 1, data_saida: null },
          { id: 41, id_pessoa: 7, id_condominio: 1, tag_rfid: 'BC614E', liberado: 0, data_saida: new Date('2026-07-01') },
        ],
      });

      await svc.criarVisita({ ...base, tag_rfid: 'BC614E' });

      expect(prisma.visitas.create.mock.calls[0][0].data.tag_rfid).toBe('BC614E');
    });

    // 4a
    it('tag IGUAL à já gravada numa visita da pessoa não é revalidada (cadastro antigo fora do padrão)', async () => {
      const { svc, prisma } = build({
        visitas: [{ id: 40, id_pessoa: 50, id_condominio: 1, tag_rfid: 'TAG_#1', liberado: 1, data_saida: null }],
        moradores: [{ id: 11, id_condominio: 1, tag_rfid: 'TAG_#1' }],
      });

      await svc.criarVisita({ ...base, tag_rfid: 'TAG_#1' });

      expect(prisma.visitas.create.mock.calls[0][0].data.tag_rfid).toBe('TAG_#1');
    });

    it('código inválido que não é de ninguém continua recusado antes de criar a pessoa', async () => {
      const { svc, pessoas } = build({});

      await expect(svc.criarVisita({ ...base, tag_rfid: 'TAG_#1' })).rejects.toThrow(/tag inválido/i);
      expect(pessoas.obterOuCriar).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------- 4b: veículo da portaria
  describe('veículo da portaria (assertTagLivre)', () => {
    function build(veiculos: any[]) {
      const prisma = prismaFake({ tags: [{ id: 70, id_condominio: 1, codigo: 'BC614E', ativo: 1 }], veiculos });
      return { svc: new VeiculosService(prisma), prisma };
    }

    // A tela reenvia o formulário inteiro: dado antigo (a mesma tag em dois
    // veículos ativos) não pode travar a edição de cor/modelo.
    it('veículo que JÁ tem a tag e não a trocou não é conferido, mesmo com a tag também em outro veículo', async () => {
      const { svc, prisma } = build([
        { id: 5, id_condominio: 1, id_tag: 70, ativo: 1 },
        { id: 9, id_condominio: 1, id_tag: 70, ativo: 1 },
      ]);

      await svc.update(1, 5, { placa: 'AAA0A00', cor: 'Azul', id_tag: 70 });

      expect(prisma.veiculos.update).toHaveBeenCalled();
    });

    it('TROCAR para uma tag que está em outro veículo ativo continua negado', async () => {
      const { svc, prisma } = build([
        { id: 5, id_condominio: 1, id_tag: null, ativo: 1 },
        { id: 9, id_condominio: 1, id_tag: 70, ativo: 1 },
      ]);

      await expect(svc.update(1, 5, { placa: 'AAA0A00', id_tag: 70 })).rejects.toThrow(
        'Esta tag já está vinculada a outro veículo.',
      );
      expect(prisma.veiculos.update).not.toHaveBeenCalled();
    });
  });
});
