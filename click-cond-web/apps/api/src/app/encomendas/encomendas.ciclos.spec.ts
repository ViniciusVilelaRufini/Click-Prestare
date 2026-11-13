import { ConflictException, ForbiddenException } from '@nestjs/common';
import { EncomendasController } from './encomendas.controller';
import { EncomendasService } from './encomendas.service';

/** Ciclos do porteiro nas encomendas (auditoria de 13/11: A4, M1, M2, B6). */
describe('Encomendas — ciclos do porteiro', () => {
  const porteiro = { sub: 7, nome: 'Portaria', id_condominio: 1, turno: 'Manha', tipo_sub: 'funcionario_portaria' } as any;
  const sindico = { sub: 3, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico', user: { id: 3 } } as any;

  function build(opts: { moradores?: any[]; push?: any; whatsapp?: any; esperado?: any } = {}) {
    const registros: any[] = [];
    let proximo = 100;
    if (opts.esperado) registros.push({ ...opts.esperado });
    const prisma: any = {
      isConnected: true,
      encomendas: {
        findFirst: jest.fn(async ({ where }: any) =>
          registros.find((r) => r.codigo_rastreio === where.codigo_rastreio && r.status === where.status) ?? null),
        findUnique: jest.fn(async ({ where }: any) => {
          const r = registros.find((x) => x.id === where.id);
          return r ? { ...r, recebidoPor: null, entreguePor: null } : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const r = { id: proximo++, recebido_em: new Date(), ...data };
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
      users: { findMany: jest.fn(async () => opts.moradores ?? []) },
    };
    const notifications: any = {
      sendPushNotification: jest.fn(async () => opts.push ?? null),
      sendWhatsApp: jest.fn(async () => opts.whatsapp ?? null),
    };
    const storage: any = { isDataUrl: jest.fn(() => false), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const svc = new EncomendasService(prisma, notifications, storage, auditoria, tenant);
    return { svc, prisma, notifications, registros, tenant, auditoria };
  }

  const dto = { descricao: 'Caixa', destinatario_apto: '101', destinatario_bloco: 'A', id_condominio: 1 };

  describe('A4: notificado só quando alguém foi avisado', () => {
    it('ninguém para avisar: grava sem notificado e devolve avisados = 0', async () => {
      const { svc, registros } = build({ moradores: [] });
      const r: any = await svc.create(dto, porteiro);
      expect(r.avisados).toBe(0);
      expect(registros[0].notificado).toBe(0);
      expect(registros[0].notificado_em ?? null).toBeNull();
    });

    it('push falhou para todos: continua sem notificado', async () => {
      const { svc, registros } = build({ moradores: [{ fcm_token: 't1', name: 'Ana', phone: null }], push: null });
      const r: any = await svc.create(dto, porteiro);
      expect(r.avisados).toBe(0);
      expect(registros[0].notificado).toBe(0);
    });

    it('um envio deu certo: notificado = 1 e avisados conta os moradores alcançados', async () => {
      const { svc, registros } = build({
        moradores: [{ fcm_token: 't1', name: 'Ana', phone: null }, { fcm_token: null, name: 'Bia', phone: null }],
        push: 'msg-1',
      });
      const r: any = await svc.create(dto, porteiro);
      expect(r.avisados).toBe(1);
      expect(r.notificado).toBe(1);
      expect(registros[0].notificado).toBe(1);
      expect(registros[0].notificado_em).toEqual(expect.any(Date));
    });

    it('WhatsApp conta como aviso', async () => {
      const { svc } = build({ moradores: [{ fcm_token: null, name: 'Ana', phone: '11999999999' }], whatsapp: { id: 'w' } });
      const r: any = await svc.create(dto, porteiro);
      expect(r.avisados).toBe(1);
    });

    it('notificar de novo sem ninguém alcançado não marca notificado', async () => {
      const { svc, registros } = build({ moradores: [] });
      registros.push({ id: 5, ...dto, status: 'Aguardando', notificado: 0, notificado_em: null });
      const r: any = await svc.notificar(5, porteiro);
      expect(r.avisados).toBe(0);
      expect(registros[0].notificado).toBe(0);
    });

    it('notificar com envio ok marca notificado', async () => {
      const { svc, registros } = build({ moradores: [{ fcm_token: 't1', name: 'Ana', phone: null }], push: 'ok' });
      registros.push({ id: 5, ...dto, status: 'Aguardando', notificado: 0, notificado_em: null });
      const r: any = await svc.notificar(5, porteiro);
      expect(r.avisados).toBe(1);
      expect(registros[0].notificado).toBe(1);
    });

    it('receber pré-registro sem ninguém alcançado não marca notificado', async () => {
      const { svc, registros } = build({ moradores: [] });
      registros.push({ id: 6, ...dto, status: 'Esperando', notificado: 0 });
      const r: any = await svc.receber(6, porteiro);
      expect(r.avisados).toBe(0);
      expect(registros[0]).toMatchObject({ status: 'Aguardando', notificado: 0 });
    });
  });

  describe('M1: casar com pré-registro pelo rastreio', () => {
    it('atualiza quando chegou e quem recebeu', async () => {
      const antigo = new Date('2026-11-01T10:00:00Z');
      const { svc, registros } = build({
        esperado: { id: 9, ...dto, status: 'Esperando', codigo_rastreio: 'BR123', recebido_em: antigo, recebido_por_user: null },
      });
      await svc.create({ ...dto, codigo_rastreio: 'BR123' }, sindico);
      expect(registros[0].status).toBe('Aguardando');
      expect(registros[0].recebido_em.getTime()).toBeGreaterThan(antigo.getTime());
      expect(registros[0].recebido_por_user).toBe(3);
    });
  });

  describe('B6: create grava quem recebeu quando o token traz Users.id', () => {
    it('síndico: recebido_por_user = Users.id; porteiro do console: null', async () => {
      const a = build();
      await a.svc.create(dto, sindico);
      expect(a.registros[0].recebido_por_user).toBe(3);
      const b = build();
      await b.svc.create(dto, porteiro);
      expect(b.registros[0].recebido_por_user).toBeNull();
    });
  });

  describe('M2: corrigir a unidade de uma encomenda aguardando', () => {
    it('troca a unidade, confere o condomínio e avisa a nova unidade', async () => {
      const { svc, registros, tenant, prisma, notifications } = build({ moradores: [{ fcm_token: 't2', name: 'Caio', phone: null }], push: 'ok' });
      registros.push({ id: 5, ...dto, status: 'Aguardando', notificado: 1 });
      const r: any = await svc.corrigirUnidade(1, 5, { destinatario_apto: '202', destinatario_bloco: 'B' }, porteiro);
      expect(tenant.assertEntidade).toHaveBeenCalledWith(1, porteiro, expect.any(String));
      expect(registros[0]).toMatchObject({ destinatario_apto: '202', destinatario_bloco: 'B', notificado: 1 });
      expect(prisma.users.findMany.mock.calls[0][0].where.moradores.some).toMatchObject({ apartamento: '202', bloco: 'B' });
      expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
      expect(r.avisados).toBe(1);
    });

    it('encomenda já retirada não muda (409)', async () => {
      const { svc, registros } = build();
      registros.push({ id: 5, ...dto, status: 'Retirada' });
      await expect(svc.corrigirUnidade(1, 5, { destinatario_apto: '202' }, porteiro)).rejects.toBeInstanceOf(ConflictException);
      expect(registros[0].destinatario_apto).toBe('101');
    });

    it('encomenda de outro condomínio que o da rota: recusa', async () => {
      const { svc, registros } = build();
      registros.push({ id: 5, ...dto, id_condominio: 2, status: 'Aguardando' });
      await expect(svc.corrigirUnidade(1, 5, { destinatario_apto: '202' }, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rota exige operador', async () => {
      const service: any = { corrigirUnidade: jest.fn(async () => ({})) };
      const ctrl = new EncomendasController(service);
      const morador = { sub: 50, typeAccess: 'Morador' } as any;
      await expect(Promise.resolve().then(() => ctrl.corrigirUnidade(1, 5, { destinatario_apto: '202' }, morador)))
        .rejects.toBeInstanceOf(ForbiddenException);
      await ctrl.corrigirUnidade(1, 5, { destinatario_apto: '202', destinatario_bloco: 'B' }, porteiro);
      expect(service.corrigirUnidade).toHaveBeenCalledWith(1, 5, { destinatario_apto: '202', destinatario_bloco: 'B' }, porteiro);
    });
  });
});
