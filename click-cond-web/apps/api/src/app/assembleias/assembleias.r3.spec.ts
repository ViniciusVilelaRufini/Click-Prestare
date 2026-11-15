import { BadRequestException } from '@nestjs/common';
import { AssembleiasService } from './assembleias.service';

/**
 * Rodada 3 (raia c):
 *  - M3: "Encerrar Imediatamente" depois das 21h de Brasília gravava
 *    `data_termino` = ontem no relógio UTC, que já era HOJE em Brasília — a
 *    enquete seguia "Ativa" e aceitando voto até a meia-noite;
 *  - B5: data da assembleia fora do padrão ("20/11", "20-11-2026") virava
 *    Invalid Date e o Prisma recusava com 500.
 */
describe('AssembleiasService — rodada 3', () => {
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };

  function build() {
    const prisma: any = {
      isConnected: true,
      assembleias: {
        create: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: jest.fn(async () => ({ anexos: '' })),
      },
      votacoes: {
        findUnique: jest.fn(async () => ({ id_condominio: 1 })),
        update: jest.fn(async () => ({})),
        findMany: jest.fn(async () => []),
      },
      users: { findUnique: jest.fn(async () => ({ id: 1 })) },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    // Travas (SELECT ... FOR UPDATE / FOR SHARE): assembleia não finalizada; a
    // votação vem do findUnique do próprio fake.
    prisma.$queryRaw = jest.fn(async (strings: TemplateStringsArray, ...vals: unknown[]) => {
      const sql = strings.join('?');
      if (/FROM Assembleias/.test(sql)) return [{ id: vals[0], id_condominio: 1, finalizada_em: null }];
      if (/FROM Votacoes WHERE id =/.test(sql)) {
        const v = await prisma.votacoes?.findUnique?.({ where: { id: vals[0] } });
        return v ? [{ id: vals[0], id_assembleia: null, encerrada_em: null, data_inicio: null, data_termino: null, ...v }] : [];
      }
      return [];
    });
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
    };
    const storage: any = { chaveDoArquivo: jest.fn(() => null) };
    const service = new AssembleiasService(prisma, storage, tenant);
    return { service, prisma };
  }

  // Rodada 5: encerrar grava `encerrada_em` (o status sai dela) e o término
  // vira HOJE de Brasília quando estava no futuro — não mais "ontem". Os
  // casos completos estão em encerrar-votacao.spec.ts.
  describe('M3 — encerrar enquete às 22h de Brasília', () => {
    afterEach(() => jest.useRealTimers());

    it('o término exibido é HOJE no calendário de Brasília (12/11, não 13/11 do UTC) e a enquete fica encerrada', async () => {
      // 13/11 01:30 UTC = 12/11 22:30 em Brasília.
      jest.useFakeTimers({ now: new Date('2026-11-13T01:30:00Z') });
      const { service, prisma } = build();
      prisma.votacoes.findUnique.mockResolvedValue({ id_condominio: 1, encerrada_em: null, data_termino: new Date('2026-11-30T00:00:00Z') });
      await service.finishVotacao(9, sindico);
      const { data } = prisma.votacoes.update.mock.calls[0][0];
      expect(data.data_termino.toISOString().slice(0, 10)).toBe('2026-11-12');
      expect((service as any).calcStatusInt(new Date('2026-11-01T00:00:00Z'), data.data_termino, data.encerrada_em)).toBe(2);
    });
  });

  describe('M3 — enquete que começou hoje e foi encerrada hoje', () => {
    afterEach(() => jest.useRealTimers());

    it('mostra "13/11 a 13/11" e continua encerrada', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-13T15:00:00Z') });
      const { service, prisma } = build();
      prisma.votacoes.findUnique.mockResolvedValue({ id_condominio: 1, encerrada_em: null, data_termino: new Date('2026-11-20T00:00:00Z') });
      await service.finishVotacao(9, sindico);
      const { data } = prisma.votacoes.update.mock.calls[0][0];
      prisma.votacoes.findMany = jest.fn(async () => [
        {
          id: 9, id_condominio: 1, titulo: 'Academia', descricao: '', created_at: new Date(),
          data_inicio: new Date('2026-11-13T00:00:00Z'), data_termino: data.data_termino,
          encerrada_em: data.encerrada_em, opcoes: [],
        },
      ]);
      const [enquete] = await service.enqueteGetAll(1, sindico);
      expect(enquete.data_inicio).toBe('13/11/2026');
      expect(enquete.data_termino).toBe('13/11/2026');
      expect(enquete.status).toBe(2);
    });

    it('linha antiga (término = ontem, sem encerrada_em) continua "13/11 a 13/11" e encerrada', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-13T15:00:00Z') });
      const { service, prisma } = build();
      prisma.votacoes.findMany = jest.fn(async () => [
        {
          id: 9, id_condominio: 1, titulo: 'Academia', descricao: '', created_at: new Date(),
          data_inicio: new Date('2026-11-13T00:00:00Z'), data_termino: new Date('2026-11-12T00:00:00Z'), opcoes: [],
        },
      ]);
      const [enquete] = await service.enqueteGetAll(1, sindico);
      expect([enquete.data_termino, enquete.status]).toEqual(['13/11/2026', 2]);
    });
  });

  describe('B5 — data da assembleia', () => {
    it.each(['20/11', '20-11-2026', '32/11/2026', '20/13/2026', 'amanhã', '2026-02-30'])(
      'insert com data %j → 400 e não grava',
      async (data) => {
        const { service, prisma } = build();
        await expect(service.insert(1, { titulo: 'AGE', data }, 1, sindico)).rejects.toThrow(
          new BadRequestException('Data inválida: use DD/MM/AAAA.'),
        );
        expect(prisma.assembleias.create).not.toHaveBeenCalled();
      },
    );

    it('update com data inválida → 400 e não grava', async () => {
      const { service, prisma } = build();
      await expect(service.update(1, { id: 5, titulo: 'AGE', data: '20/11' }, 1, sindico)).rejects.toThrow(
        'Data inválida: use DD/MM/AAAA.',
      );
      expect(prisma.assembleias.updateMany).not.toHaveBeenCalled();
    });

    // O app do síndico manda `DateFormat("dd/MM/yyyy").parseStrict(...).toString()`
    // (new_assembleia.dart → utils.dart convertStringToDate): "2026-11-20 00:00:00.000".
    it.each([
      ['2026-11-20 00:00:00.000'],
      ['2026-11-20T00:00:00.000Z'],
      ['2026-11-20'],
      ['2026-11-20 00:00'],
      ['2026-11-20T00:00:00'],
    ])('app: insert e update com %j gravam 20/11 à meia-noite UTC', async (data) => {
      const { service, prisma } = build();
      await service.insert(1, { titulo: 'AGE', data }, 1, sindico);
      await service.update(1, { id: 5, titulo: 'AGE', data }, 1, sindico);
      const criada: Date = prisma.assembleias.create.mock.calls[0][0].data.data;
      const editada: Date = prisma.assembleias.updateMany.mock.calls[0][0].data.data;
      expect(criada.toISOString()).toBe('2026-11-20T00:00:00.000Z');
      expect(editada.toISOString()).toBe('2026-11-20T00:00:00.000Z');
    });

    it.each(['2026-11-20 lixo', '2026-11-20T', '2026-11-20 00:00:00.000 extra', '2026-11-31 00:00:00.000'])(
      'continua recusando %j',
      async (data) => {
        const { service, prisma } = build();
        await expect(service.insert(1, { titulo: 'AGE', data }, 1, sindico)).rejects.toThrow('Data inválida');
        expect(prisma.assembleias.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['20/11/2026', 2026, 10, 20],
      ['2026-11-20', 2026, 10, 20],
      ['5/1/2027', 2027, 0, 5],
    ])('aceita %j', async (data, ano, mes, dia) => {
      const { service, prisma } = build();
      await service.insert(1, { titulo: 'AGE', data }, 1, sindico);
      const gravada: Date = prisma.assembleias.create.mock.calls[0][0].data.data;
      // Aceita meia-noite local (DD/MM) ou UTC (ISO): o dia é o mesmo.
      const d = data.includes('/') ? [gravada.getFullYear(), gravada.getMonth(), gravada.getDate()]
        : [gravada.getUTCFullYear(), gravada.getUTCMonth(), gravada.getUTCDate()];
      expect(d).toEqual([ano, mes, dia]);
    });
  });
});
