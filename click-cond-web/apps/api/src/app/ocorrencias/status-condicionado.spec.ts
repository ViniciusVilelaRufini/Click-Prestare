import { BadRequestException, ConflictException } from '@nestjs/common';
import { OcorrenciasController } from './ocorrencias.controller';
import { OcorrenciasService } from './ocorrencias.service';
import { STATUS_SOLUCIONADO, ocorrenciaSolucionada } from '../common/status-ocorrencia.util';

/**
 * Mudar o status a partir de uma lista desatualizada fazia a ocorrência
 * regredir: o porteiro B, com a tela de 30 s atrás, clicava "Marcar como
 * ciente" numa ocorrência que o porteiro A acabara de solucionar, e a API
 * gravava sem olhar o estado atual (o morador recebia "Ciente" depois de
 * "Solucionado"). Agora a escrita é condicionada ao status de origem:
 *  - Ciente só a partir de Pendente;
 *  - Solucionado a partir de Pendente ou Ciente;
 *  - Reabrir só a partir de Solucionado (inclusive a grafia antiga
 *    'Resolvida') e grava Pendente — o app mostra Responder por esse status;
 *  - o console manda o status e o updated_at que mostrava: diferente → 409.
 * Fora disso: 409 e nada é gravado nem avisado.
 */
describe('Ocorrências — status condicionado ao estado de origem', () => {
  const sindico = { sub: 7, typeAccess: 'Sindico' } as any;

  function montar(status: string) {
    const oc: any = { id: 5, id_condominio: 1, user: 100, status, tipo: 2, prazo: null };
    const prisma: any = {
      isConnected: true,
      ocorrencias: {
        findUnique: jest.fn(async () => ({ ...oc })),
        update: jest.fn(async ({ data }: any) => ({ ...oc, ...data })),
        // Simula o MySQL: só grava se o status atual está entre os de origem.
        updateMany: jest.fn(async ({ where, data }: any) => {
          const origens: string[] = where.status?.in ?? [where.status];
          if (!origens.map((s) => s.toLowerCase()).includes(String(oc.status).toLowerCase())) return { count: 0 };
          Object.assign(oc, data);
          return { count: 1 };
        }),
      },
      ocorrencias_Categorias: { findUnique: jest.fn(async () => ({ sla_horas: 24 })) },
      users: { findUnique: jest.fn(async () => ({ fcm_token: 'tok', notif_ocorrencias: 1 })) },
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const notifications: any = { sendPushNotification: jest.fn(async () => 'ok') };
    const svc = new OcorrenciasService(prisma, notifications, tenant, {} as any);
    return { svc, prisma, notifications, oc };
  }

  it('Solucionado → "Marcar como ciente" (lista velha): 409, nada gravado, morador não é avisado', async () => {
    const { svc, prisma, notifications, oc } = montar('Solucionado');
    const e: any = await svc.updateStatus(5, 'Ciente', sindico).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toContain('Solucionado');
    expect(oc.status).toBe('Solucionado');
    expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('Ciente → Ciente e Solucionado → Solucionado: 409 "já está"', async () => {
    for (const s of ['Ciente', 'Solucionado'] as const) {
      const { svc } = montar(s);
      const e: any = await svc.updateStatus(5, s, sindico).catch((x) => x);
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.message).toContain(`já está ${s}`);
    }
  });

  it('Pendente → Ciente → Solucionado: grava, condicionado à origem', async () => {
    const { svc, prisma, oc } = montar('Pendente');
    await svc.updateStatus(5, 'Ciente', sindico);
    expect(prisma.ocorrencias.updateMany.mock.calls[0][0].where).toEqual({ id: 5, status: { in: ['Pendente'] } });
    expect(oc.status).toBe('Ciente');
    await svc.updateStatus(5, 'Solucionado', sindico);
    expect(prisma.ocorrencias.updateMany.mock.calls[1][0].where).toEqual({ id: 5, status: { in: ['Pendente', 'Ciente'] } });
    expect(oc.status).toBe('Solucionado');
  });

  it('reabrir (pedido "Pendente"): só a partir de Solucionado, grava Pendente com prazo novo; push diz reaberta', async () => {
    const { svc, prisma, notifications, oc } = montar('Solucionado');
    const r: any = await svc.updateStatus(5, 'Pendente', sindico);
    expect(r.status).toBe('Pendente');
    const { where, data } = prisma.ocorrencias.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: 5, status: { in: ['Solucionado', 'solucionado', 'Solucionada', 'solucionada', 'Resolvida', 'resolvida', 'Resolvido', 'resolvido'] } });
    expect(data.status).toBe('Pendente');
    expect(data.prazo).toBeInstanceOf(Date);
    expect(oc.status).toBe('Pendente');
    expect(notifications.sendPushNotification.mock.calls[0][2]).toBe('Sua ocorrência #5 foi reaberta.');
  });

  it('status legado "Resolvida" pode ser reaberto', async () => {
    const { svc, oc } = montar('Resolvida');
    await svc.updateStatus(5, 'Pendente', sindico);
    expect(oc.status).toBe('Pendente');
  });

  it('status fora do vocabulário (inclusive "toString"): 400, sem ler nem gravar', async () => {
    const { svc, prisma } = montar('Pendente');
    for (const s of ['toString', 'constructor', 'Qualquer', undefined]) {
      const e = await svc.updateStatus(5, s as any, sindico).catch((x) => x);
      expect(e).toBeInstanceOf(BadRequestException);
    }
    expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
  });

  describe('o que a tela mostrava (status_esperado / updated_at_esperado)', () => {
    const VISTO = '2026-11-13T10:00:00.000Z';

    it('A soluciona e reabre; B, com a tela velha (mesmo status Pendente, carimbo antigo), clica Solucionar: 409', async () => {
      const { svc, prisma, notifications, oc } = montar('Pendente');
      oc.updated_at = new Date('2026-11-13T10:00:30.000Z'); // reaberta depois do que B viu
      const e: any = await svc.updateStatus(5, 'Solucionado', sindico, { status: 'Pendente', updated_at: VISTO }).catch((x) => x);
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.message).toContain('mudou enquanto você via a lista');
      expect(oc.status).toBe('Pendente');
      expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
      expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    });

    it('status esperado diferente do atual: 409', async () => {
      const { svc, oc } = montar('Ciente');
      const e = await svc.updateStatus(5, 'Solucionado', sindico, { status: 'Pendente' }).catch((x) => x);
      expect(e).toBeInstanceOf(ConflictException);
      expect(oc.status).toBe('Ciente');
    });

    it('igual ao atual: grava, com o carimbo no filtro da escrita', async () => {
      const { svc, prisma, oc } = montar('Pendente');
      oc.updated_at = new Date(VISTO);
      await svc.updateStatus(5, 'Solucionado', sindico, { status: 'Pendente', updated_at: VISTO });
      expect(prisma.ocorrencias.updateMany.mock.calls[0][0].where).toEqual({
        id: 5, status: { in: ['Pendente', 'Ciente'] }, updated_at: new Date(VISTO),
      });
      expect(oc.status).toBe('Solucionado');
    });

    it('carimbo inválido: 400', async () => {
      const { svc } = montar('Pendente');
      expect(await svc.updateStatus(5, 'Ciente', sindico, { updated_at: 'ontem' }).catch((x) => x)).toBeInstanceOf(BadRequestException);
    });

    it('controller repassa status_esperado e updated_at_esperado', async () => {
      const service: any = { updateStatus: jest.fn(async () => ({})) };
      const ctrl = new OcorrenciasController(service);
      await ctrl.updateStatus(5, { status: 'Ciente', status_esperado: 'Pendente', updated_at_esperado: VISTO }, sindico);
      expect(service.updateStatus).toHaveBeenCalledWith(5, 'Ciente', sindico, { status: 'Pendente', updated_at: VISTO });
    });
  });

  it('Reabrir desatualizado (já reaberta e marcada ciente por outro): 409', async () => {
    const { svc } = montar('Ciente');
    const e = await svc.updateStatus(5, 'Pendente', sindico).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
  });

  it('corrida: o status muda entre a leitura e a escrita → 409', async () => {
    const { svc, prisma } = montar('Pendente');
    prisma.ocorrencias.updateMany.mockResolvedValueOnce({ count: 0 });
    const e = await svc.updateStatus(5, 'Ciente', sindico).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
  });

  // Onda final: uma lista só de "solucionado" (common/status-ocorrencia.util),
  // a mesma do dashboard e do PDF.
  it.each(['Solucionado', 'solucionado', 'Solucionada', 'Resolvida', 'Resolvido'])(
    'grafia "%s" conta como solucionada no util comum e pode ser reaberta',
    async (grafia) => {
      expect(ocorrenciaSolucionada(grafia)).toBe(true);
      const { svc, oc, prisma } = montar(grafia);
      await svc.updateStatus(5, 'Pendente', sindico);
      expect(oc.status).toBe('Pendente');
      expect(prisma.ocorrencias.updateMany.mock.calls[0][0].where.status.in).toEqual([...STATUS_SOLUCIONADO]);
    },
  );

  it('o util comum cobre as grafias que o dashboard precisa excluir das abertas', () => {
    for (const g of ['Solucionada', 'Resolvido']) expect(STATUS_SOLUCIONADO).toContain(g);
    expect(ocorrenciaSolucionada('Pendente')).toBe(false);
    expect(ocorrenciaSolucionada('Ciente')).toBe(false);
  });

  // Status legado fora do vocabulário (ex.: 'Em andamento'): antes, toda
  // mudança dava 409 "já está Em andamento" e a ocorrência ficava presa.
  it.each(['Ciente', 'Solucionado', 'Pendente'] as const)(
    'legado "Em andamento" → %s: grava, condicionado ao status legado lido',
    async (destino) => {
      const { svc, oc, prisma } = montar('Em andamento');
      await svc.updateStatus(5, destino, sindico, { status: 'Em andamento' });
      expect(oc.status).toBe(destino);
      expect(prisma.ocorrencias.updateMany.mock.calls[0][0].where.status).toBe('Em andamento');
    },
  );
});
