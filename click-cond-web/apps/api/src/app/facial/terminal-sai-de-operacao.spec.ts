import { BadRequestException, ConflictException } from '@nestjs/common';
import { FacialService } from './facial.service';

/**
 * T1: desativar, trocar o tipo ou excluir um terminal facial ativo tirava o
 * aparelho de toda a manutenção (syncs, revogações, varredura de fantasmas só
 * olham `ativo: 1, tipo: 'facial'`) com todos os rostos gravados — morador
 * removido e visitante vencido seguiam entrando. Agora os rostos saem ANTES de
 * gravar a mudança; agente offline ou remoção falha → 409 e nada é gravado.
 *
 * T2: tirar a área do terminal devolve os moradores (carga do terminal) e a
 * auditoria registra área, controle por reserva e modelo.
 *
 * T3: abrir porta manual recusa dispositivo desativado.
 */
describe('FacialService — terminal que sai de operação (T1, T2, T3)', () => {
  function build(over: Record<string, any> = {}, opts: { online?: boolean } = {}) {
    const device: any = {
      id: 5, id_condominio: 3, nome: 'Facial Hall', tipo: 'facial', ativo: 1,
      ip: '192.168.0.50', porta: 80, api_user: 'admin', api_password: null,
      fabricante: 'intelbras', id_area_social: null, mac: null, ultima_sincr: null,
      ...over,
    };
    const ordem: string[] = [];
    const prisma: any = {
      facial_Devices: {
        findUnique: jest.fn(async () => ({ ...device })),
        findFirst: jest.fn(async () => null),
        count: jest.fn(async () => 0),
        update: jest.fn(async ({ data }: any) => {
          ordem.push('update');
          return Object.assign(device, data);
        }),
        delete: jest.fn(async () => {
          ordem.push('delete');
          return device;
        }),
      },
      acessos_Facial: { count: jest.fn(async () => 0) },
      deliveryPedidosPortao: { count: jest.fn(async () => 0) },
      ocorrencias: { updateMany: jest.fn(async () => ({ count: 0 })) },
      areas_Sociais: {
        findFirst: jest.fn(async () => ({ id: 7 })),
        findMany: jest.fn(async () => [{ id: 7, controle_acesso_facial: 1 }]),
        findUnique: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
      },
      moradores: { findMany: jest.fn(async () => [{ id: 1, face_id: 'F1' }, { id: 2, face_id: 'F2' }]) },
      visitantes: { findMany: jest.fn(async () => [{ id: 8, face_id: 'V8' }]) },
      prestadores_servico: { findMany: jest.fn(async () => []) },
      // Heartbeat: por padrão o aparelho já falou com o agente um dia.
      agente_Dispositivos_Estado: {
        findUnique: jest.fn(async () => ({ ultimo_poll_em: new Date('2026-11-20T10:00:00Z') })),
      },
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const agent: any = { isOnline: jest.fn(() => opts.online ?? true) };
    const client: any = {
      listUserIds: jest.fn(async () => {
        ordem.push('listUserIds');
        return ['F1', 'F2', 'X9'];
      }),
      removeUsers: jest.fn(async () => {
        ordem.push('removeUsers');
      }),
      removePerson: jest.fn(async () => {
        ordem.push('removePerson');
      }),
      triggerRelay: jest.fn(async () => ({ ok: true })),
    };
    const svc = new FacialService(
      prisma, client, null as any, null as any, auditoria,
      null as any, agent, null as any, null as any, null as any,
    );
    return { svc, prisma, client, agent, auditoria, ordem, device };
  }

  describe('T1 — rostos saem antes', () => {
    it('desativar apaga TODOS os rostos do aparelho antes de gravar ativo=0', async () => {
      const { svc, client, ordem, auditoria } = build();
      await svc.updateDevice(5, { ativo: 0 });
      expect(client.listUserIds).toHaveBeenCalledWith(expect.objectContaining({ id: 5, fabricante: 'intelbras' }));
      expect(client.removeUsers).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), ['F1', 'F2', 'X9']);
      expect(ordem).toEqual(['listUserIds', 'removeUsers', 'update']);
      expect(auditoria.registrar.mock.calls[0][0].detalhes.rostos_removidos).toBe(3);
    });

    it('trocar o tipo de facial para catraca também limpa antes', async () => {
      const { svc, ordem } = build();
      await svc.updateDevice(5, { tipo: 'catraca' } as any);
      expect(ordem).toEqual(['listUserIds', 'removeUsers', 'update']);
    });

    it('excluir limpa antes do delete', async () => {
      const { svc, ordem, auditoria } = build();
      await expect(svc.removeDevice(5)).resolves.toEqual({ ok: true });
      expect(ordem).toEqual(['listUserIds', 'removeUsers', 'delete']);
      expect(auditoria.registrar.mock.calls[0][0].detalhes.rostos_removidos).toBe(3);
    });

    it('falou com o agente um dia e está offline: desativar é recusado com 409 e nada é gravado', async () => {
      const { svc, prisma, client } = build({}, { online: false });
      const p = svc.updateDevice(5, { ativo: 0 });
      await expect(p).rejects.toThrow(ConflictException);
      await expect(svc.updateDevice(5, { ativo: 0 })).rejects.toThrow(/agente local está offline/i);
      expect(prisma.facial_Devices.update).not.toHaveBeenCalled();
      expect(client.listUserIds).not.toHaveBeenCalled();
    });

    it('agente offline: excluir é recusado com 409 e o aparelho não é apagado', async () => {
      const { svc, prisma } = build({}, { online: false });
      await expect(svc.removeDevice(5)).rejects.toThrow(ConflictException);
      expect(prisma.facial_Devices.delete).not.toHaveBeenCalled();
    });

    it('nunca falou com o agente (sem linha de heartbeat): desativa e exclui sem limpeza, auditado', async () => {
      const { svc, prisma, client, auditoria } = build({}, { online: false });
      prisma.agente_Dispositivos_Estado.findUnique.mockResolvedValue(null);
      await svc.updateDevice(5, { ativo: 0 });
      expect(prisma.facial_Devices.update).toHaveBeenCalled();
      expect(auditoria.registrar.mock.calls[0][0].detalhes.limpeza_dispensada).toMatch(/nunca falou com o agente/);

      const outro = build({}, { online: false });
      outro.prisma.agente_Dispositivos_Estado.findUnique.mockResolvedValue(null);
      await expect(outro.svc.removeDevice(5)).resolves.toEqual({ ok: true });
      expect(outro.prisma.facial_Devices.delete).toHaveBeenCalled();
      expect(outro.auditoria.registrar.mock.calls[0][0].detalhes.limpeza_dispensada).toMatch(/nunca falou/);

      for (const c of [client, outro.client]) {
        expect(c.listUserIds).not.toHaveBeenCalled();
        expect(c.removeUsers).not.toHaveBeenCalled();
        expect(c.removePerson).not.toHaveBeenCalled();
      }
    });

    it('linha de heartbeat com ultimo_poll_em nulo também conta como nunca falou', async () => {
      const { svc, prisma, client } = build({}, { online: false });
      prisma.agente_Dispositivos_Estado.findUnique.mockResolvedValue({ ultimo_poll_em: null });
      await svc.updateDevice(5, { tipo: 'catraca' } as any);
      expect(prisma.facial_Devices.update).toHaveBeenCalled();
      expect(client.listUserIds).not.toHaveBeenCalled();
    });

    it('falha ao ler o heartbeat não prova nada: 409 como offline', async () => {
      const { svc, prisma } = build({}, { online: false });
      prisma.agente_Dispositivos_Estado.findUnique.mockRejectedValue(new Error('tabela ausente'));
      await expect(svc.updateDevice(5, { ativo: 0 })).rejects.toThrow(/agente local está offline/i);
      expect(prisma.facial_Devices.update).not.toHaveBeenCalled();
    });

    it('remoção que falha no aparelho: 409 e nada é gravado', async () => {
      const { svc, prisma, client } = build();
      client.removeUsers.mockRejectedValue(new Error('timeout do agente'));
      await expect(svc.updateDevice(5, { ativo: 0 })).rejects.toThrow(/timeout do agente/);
      await expect(svc.removeDevice(5)).rejects.toThrow(ConflictException);
      expect(prisma.facial_Devices.update).not.toHaveBeenCalled();
      expect(prisma.facial_Devices.delete).not.toHaveBeenCalled();
    });

    it('marca sem listagem: remove pessoa a pessoa (com a matrícula) e recusa se uma falhar', async () => {
      const { svc, prisma, client } = build({ fabricante: 'genérico' });
      client.removePerson.mockImplementation(async (_c: any, faceId: string) => {
        if (faceId === 'F2') throw new Error('sem resposta');
      });
      await expect(svc.updateDevice(5, { ativo: 0 })).rejects.toThrow(/1 de 3.*morador_2/);
      expect(client.removePerson).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), 'F1', 'morador_1');
      expect(client.removePerson).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), 'V8', 'visitante_8');
      expect(client.listUserIds).not.toHaveBeenCalled();
      expect(prisma.facial_Devices.update).not.toHaveBeenCalled();
    });

    it('marca sem listagem, todas removidas: grava a desativação', async () => {
      const { svc, prisma, client } = build({ fabricante: 'genérico' });
      await svc.updateDevice(5, { ativo: 0 });
      expect(client.removePerson).toHaveBeenCalledTimes(3);
      expect(prisma.facial_Devices.update).toHaveBeenCalled();
    });

    it('edição comum (nome) de terminal ativo não mexe nos rostos', async () => {
      const { svc, client } = build();
      await svc.updateDevice(5, { nome: 'Facial Hall 2', ativo: 1 });
      expect(client.listUserIds).not.toHaveBeenCalled();
      expect(client.removePerson).not.toHaveBeenCalled();
    });

    it('terminal já desativado: excluir ou trocar o tipo não tenta limpar (agente não fala com ele)', async () => {
      const { svc, client } = build({ ativo: 0 }, { online: false });
      await svc.updateDevice(5, { tipo: 'catraca' } as any);
      await expect(svc.removeDevice(5)).resolves.toEqual({ ok: true });
      expect(client.listUserIds).not.toHaveBeenCalled();
    });

    it('botoeira (não facial) desativa sem limpeza nem agente', async () => {
      const { svc, prisma, client } = build({ tipo: 'botoeira' }, { online: false });
      await svc.updateDevice(5, { ativo: 0 });
      expect(client.listUserIds).not.toHaveBeenCalled();
      expect(prisma.facial_Devices.update).toHaveBeenCalled();
    });
  });

  describe('T2 — área do terminal', () => {
    const assentar = () => new Promise((r) => setImmediate(r));

    it('tirar a área devolve os moradores: carga do terminal', async () => {
      const { svc } = build({ id_area_social: 7 });
      const carga = jest
        .spyOn(svc as any, 'syncAllForCondominio')
        .mockResolvedValue({ started: true, total: 2 });
      await svc.updateDevice(5, { id_area_social: null });
      await assentar();
      expect(carga).toHaveBeenCalledWith(3, { deviceIds: [5] });
    });

    it('manter a área não dispara carga', async () => {
      const { svc } = build({ id_area_social: 7 });
      const carga = jest.spyOn(svc as any, 'syncAllForCondominio').mockResolvedValue({ started: true });
      jest.spyOn(svc, 'reconcileAreaGating').mockResolvedValue(undefined);
      await svc.updateDevice(5, { id_area_social: 7, nome: 'Piscina' });
      await assentar();
      expect(carga).not.toHaveBeenCalled();
    });

    it('auditoria registra área, controle por reserva e modelo', async () => {
      const { svc, auditoria } = build({ id_area_social: null, modelo: 'SS 3530' });
      jest.spyOn(svc, 'reconcileAreaGating').mockResolvedValue(undefined);
      await svc.updateDevice(5, { id_area_social: 7, controle_acesso_facial: 1, modelo: 'SS 5530' });
      const changes = auditoria.registrar.mock.calls[0][0].detalhes.changes;
      expect(changes.id_area_social).toEqual({ de: null, para: 7 });
      expect(changes.modelo).toEqual({ de: 'SS 3530', para: 'SS 5530' });
      expect(changes.controle_acesso_facial).toEqual({ de: 0, para: 1 });
    });

    it('desligar o controle por reserva entra na auditoria', async () => {
      const { svc, auditoria } = build({ id_area_social: 7 });
      jest.spyOn(svc, 'reconcileAreaGating').mockResolvedValue(undefined);
      await svc.updateDevice(5, { controle_acesso_facial: 0 });
      const changes = auditoria.registrar.mock.calls[0][0].detalhes.changes;
      expect(changes.controle_acesso_facial).toEqual({ de: 1, para: 0 });
    });
  });

  describe('T3 — abrir porta manual', () => {
    it('recusa botoeira desativada sem acionar o relé', async () => {
      const { svc, client } = build({ tipo: 'botoeira', ativo: 0 });
      await expect(svc.triggerDevice(5)).rejects.toThrow(BadRequestException);
      await expect(svc.triggerDevice(5)).rejects.toThrow(/desativado/);
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });
  });
});
