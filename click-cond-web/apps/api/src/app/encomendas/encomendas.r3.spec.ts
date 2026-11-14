import { BadRequestException, ConflictException } from '@nestjs/common';
import { EncomendasController } from './encomendas.controller';
import { EncomendasService } from './encomendas.service';

/**
 * Rodada 3 (encomendas):
 *  - 17: a recarga de 20 s baixava o histórico inteiro com assinatura e foto
 *    (LongText) — agora a lista pode vir "leve" e só com as retiradas recentes;
 *  - 18: editar pelo app trocava a unidade sem as regras de "Corrigir unidade";
 *  - 21: Notificar encomenda já retirada mandava "aguardando retirada";
 *  - 22: bloco null x '' separava a mesma unidade no "Retirar lote".
 */
describe('Encomendas — rodada 3', () => {
  // 101 só existe no bloco A (bloco único para esse número); 7 sem bloco; 30 em dois blocos.
  const APTOS = [
    { id: 1, bloco: 'A', apto: '101' },
    { id: 2, bloco: null, apto: '7' },
    { id: 3, bloco: 'A', apto: '30' },
    { id: 4, bloco: 'B', apto: '30' },
  ];
  const porteiro = { sub: 7, nome: 'Portaria', id_condominio: 1, turno: 'Manha', tipo_sub: 'funcionario_portaria' } as any;

  function build(registros: any[] = [], moradores: any[] = [{ fcm_token: 't1', name: 'Ana', phone: null }]) {
    const prisma: any = {
      isConnected: true,
      encomendas: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async ({ where }: any) => {
          const r = registros.find((x) => x.id === where.id);
          return r ? { ...r, recebidoPor: null, entreguePor: null } : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const r = { id: 100 + registros.length, recebido_em: new Date(), ...data };
          registros.push(r);
          return { ...r };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const r = registros.find((x) => x.id === where.id);
          Object.assign(r, data);
          return { ...r };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const r = registros.find((x) => x.id === where.id && (!where.status || x.status === where.status));
          if (!r) return { count: 0 };
          Object.assign(r, data);
          return { count: 1 };
        }),
      },
      users: { findMany: jest.fn(async () => moradores) },
      apartamentos: {
        findFirst: jest.fn(async ({ where }: any) =>
          APTOS.find((a) =>
            a.apto === where.apto && (where.OR ? where.OR.some((o: any) => o.bloco === a.bloco) : a.bloco === where.bloco)) ?? null),
        findMany: jest.fn(async ({ where }: any) => APTOS.filter((a) => a.apto === where.apto)),
      },
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => 'ok'), sendWhatsApp: jest.fn(async () => null) };
    const storage: any = { isDataUrl: jest.fn(() => false), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const svc = new EncomendasService(prisma, notifications, storage, auditoria, tenant);
    return { svc, prisma, notifications, registros };
  }

  const enc = (o: any = {}) => ({
    id: 5, id_condominio: 1, descricao: 'Caixa', destinatario_apto: '101', destinatario_bloco: 'A',
    status: 'Aguardando', notificado: 1, notificado_em: new Date(), foto_volume: null, ...o,
  });

  describe('21: notificar só o que aguarda retirada', () => {
    it('já retirada: 409, sem push e sem marcar notificado', async () => {
      const { svc, notifications, registros } = build([enc({ status: 'Retirada', notificado: 0, notificado_em: null })]);
      const e = await svc.notificar(5, porteiro).catch((x) => x);
      expect(e).toBeInstanceOf(ConflictException);
      expect(notifications.sendPushNotification).not.toHaveBeenCalled();
      expect(registros[0].notificado).toBe(0);
    });

    it('aguardando: notifica', async () => {
      const { svc, notifications } = build([enc()]);
      const r: any = await svc.notificar(5, porteiro);
      expect(r.avisados).toBe(1);
      expect(notifications.sendPushNotification).toHaveBeenCalled();
    });
  });

  describe('22: sem bloco grava "" (como o console)', () => {
    it('create sem bloco', async () => {
      const { svc, registros } = build();
      await svc.create({ descricao: 'Caixa', destinatario_apto: '7', id_condominio: 1 } as any, porteiro);
      expect(registros[0].destinatario_bloco).toBe('');
    });

    it('receber pré-registro com bloco null normaliza para ""', async () => {
      const { svc, registros } = build([enc({ status: 'Esperando', destinatario_apto: '7', destinatario_bloco: null })]);
      await svc.receber(5, porteiro);
      expect(registros[0].status).toBe('Aguardando');
      expect(registros[0].destinatario_bloco).toBe('');
    });
  });

  describe('18: editar pelo app com outra unidade segue "Corrigir unidade"', () => {
    it('aguardando: troca, zera notificado, avisa a nova unidade e devolve avisados', async () => {
      const { svc, registros, notifications } = build([enc()]);
      const r: any = await svc.update(5, { destinatario_apto: '7', destinatario_bloco: null as any, descricao: 'Caixa grande' }, porteiro);
      expect(registros[0].destinatario_apto).toBe('7');
      expect(registros[0].destinatario_bloco).toBe('');
      expect(registros[0].descricao).toBe('Caixa grande');
      expect(notifications.sendPushNotification).toHaveBeenCalled();
      expect(r.avisados).toBe(1);
    });

    it('já retirada: 409 e nada muda', async () => {
      const { svc, registros, prisma } = build([enc({ status: 'Retirada' })]);
      const e = await svc.update(5, { destinatario_apto: '7', descricao: 'Outra' }, porteiro).catch((x) => x);
      expect(e).toBeInstanceOf(ConflictException);
      expect(registros[0].destinatario_apto).toBe('101');
      expect(registros[0].descricao).toBe('Caixa');
      expect(prisma.encomendas.update).not.toHaveBeenCalled();
    });

    // Onda final: o síndico corrige pelo app a unidade de um pré-registro
    // ("a chegar") antes de receber. Antes da rodada 3 gravava; tinha virado 409.
    it('a chegar (Esperando): grava a unidade nova validada, sem push de "Nova Encomenda"', async () => {
      const { svc, registros, notifications, prisma } = build([enc({ status: 'Esperando', notificado: 0, notificado_em: null })]);
      await svc.update(5, { destinatario_apto: '30', destinatario_bloco: 'B', descricao: 'iFood' }, porteiro);
      expect(registros[0]).toMatchObject({ destinatario_apto: '30', destinatario_bloco: 'B', descricao: 'iFood', status: 'Esperando' });
      expect(prisma.encomendas.updateMany.mock.calls[0][0].where).toEqual({ id: 5, status: 'Esperando' });
      expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    });

    it('a chegar (Esperando) com unidade que não existe: 400 e nada muda', async () => {
      const { svc, registros } = build([enc({ status: 'Esperando' })]);
      const e = await svc.update(5, { destinatario_apto: '999' }, porteiro).catch((x) => x);
      expect(e).toBeInstanceOf(BadRequestException);
      expect(registros[0].destinatario_apto).toBe('101');
    });

    it('unidade que não existe: 400 e nada muda', async () => {
      const { svc, registros } = build([enc()]);
      const e = await svc.update(5, { destinatario_apto: '999', descricao: 'Outra' }, porteiro).catch((x) => x);
      expect(e).toBeInstanceOf(BadRequestException);
      expect(registros[0].destinatario_apto).toBe('101');
      expect(registros[0].descricao).toBe('Caixa');
    });

    it('bloco preenchido sozinho pelo app leva ao mesmo apartamento: não é troca', async () => {
      // Gravada sem bloco; o app manda bloco 'A' (o único com o 101).
      const { svc, registros, notifications, prisma } = build([enc({ destinatario_bloco: '' })]);
      await svc.update(5, { destinatario_apto: '101', destinatario_bloco: 'A', descricao: 'Envelope' }, porteiro);
      expect(registros[0].descricao).toBe('Envelope');
      expect(registros[0].destinatario_bloco).toBe('');
      expect(registros[0].notificado).toBe(1);
      expect(prisma.encomendas.updateMany).not.toHaveBeenCalled();
      expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    });

    it('troca de verdade: uma escrita só (unidade + campos), push depois com a descrição nova', async () => {
      const { svc, prisma, notifications } = build([enc()]);
      await svc.update(5, { destinatario_apto: '30', destinatario_bloco: 'B', descricao: 'Caixa grande' }, porteiro);
      // update só para marcar notificado depois do aviso (marcarNotificada).
      for (const c of prisma.encomendas.update.mock.calls) expect(Object.keys(c[0].data).sort()).toEqual(['notificado', 'notificado_em']);
      expect(prisma.encomendas.updateMany).toHaveBeenCalledTimes(1);
      const { where, data } = prisma.encomendas.updateMany.mock.calls[0][0];
      expect(where).toEqual({ id: 5, status: 'Aguardando' });
      expect(data).toMatchObject({ descricao: 'Caixa grande', destinatario_apto: '30', destinatario_bloco: 'B', notificado: 0 });
      const ordemEscrita = prisma.encomendas.updateMany.mock.invocationCallOrder[0];
      expect(notifications.sendPushNotification.mock.invocationCallOrder[0]).toBeGreaterThan(ordemEscrita);
      expect(notifications.sendPushNotification.mock.calls[0][2]).toContain('Caixa grande');
    });

    it('número em dois blocos sem bloco informado: ambíguo, 400', async () => {
      const { svc, registros } = build([enc()]);
      const e = await svc.update(5, { destinatario_apto: '30', destinatario_bloco: '' }, porteiro).catch((x) => x);
      expect(e).toBeInstanceOf(BadRequestException);
      expect(registros[0].destinatario_apto).toBe('101');
    });

    it('mesma unidade (bloco null x "" igual): edição comum, sem aviso', async () => {
      const { svc, registros, notifications } = build([enc({ destinatario_apto: '7', destinatario_bloco: '' })]);
      await svc.update(5, { destinatario_apto: '7', destinatario_bloco: null as any, descricao: 'Envelope' }, porteiro);
      expect(registros[0].descricao).toBe('Envelope');
      expect(registros[0].destinatario_bloco).toBe('');
      expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    });
  });

  describe('17: lista leve para as recargas', () => {
    it('leve: sem assinatura e foto da retirada, com tem_comprovante; retiradas só as recentes', async () => {
      const { svc, prisma } = build();
      prisma.encomendas.findMany
        .mockResolvedValueOnce([
          { id: 1, status: 'Aguardando' },
          { id: 2, status: 'Retirada' },
          { id: 3, status: 'Retirada' },
        ])
        .mockResolvedValueOnce([{ id: 2 }]);
      const desde = new Date('2026-11-07T00:00:00Z');
      const r: any[] = await svc.findAll(1, undefined, porteiro, { leve: true, retiradasDesde: desde });
      const args = prisma.encomendas.findMany.mock.calls[0][0];
      expect(args.select.retirado_assinatura).toBeUndefined();
      expect(args.select.retirado_foto).toBeUndefined();
      expect(args.select.retirado_por).toBe(true);
      expect(args.where).toEqual({
        id_condominio: 1,
        OR: [{ status: { not: 'Retirada' } }, { retirado_em: { gte: desde } }],
      });
      expect(r.map((e) => e.tem_comprovante)).toEqual([false, true, false]);
    });

    it('sem opções: a lista de sempre (app e chamadas antigas)', async () => {
      const { svc, prisma } = build();
      await svc.findAll(1, 'Aguardando', porteiro);
      expect(prisma.encomendas.findMany.mock.calls[0][0]).toEqual({
        where: { id_condominio: 1, status: 'Aguardando' },
        orderBy: { recebido_em: 'desc' },
      });
    });

    it('controller: leve=1 e retiradas_dias=7 viram as opções', async () => {
      const service: any = { findAll: jest.fn(async () => []) };
      const ctrl = new EncomendasController(service);
      const antes = Date.now();
      await ctrl.list(1, undefined, porteiro, '1', '7');
      const [, , , opcoes] = service.findAll.mock.calls[0];
      expect(opcoes.leve).toBe(true);
      const dias = (antes - opcoes.retiradasDesde.getTime()) / 86_400_000;
      expect(dias).toBeGreaterThan(6.99);
      expect(dias).toBeLessThan(7.01);
      await ctrl.list(1, undefined, porteiro, undefined, 'abc');
      expect(service.findAll.mock.calls[1][3]).toEqual({ leve: false, retiradasDesde: undefined });
    });
  });
});
