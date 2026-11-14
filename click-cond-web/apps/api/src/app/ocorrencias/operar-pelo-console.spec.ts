import { ForbiddenException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';
import { OcorrenciasController } from './ocorrencias.controller';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * O porteiro logado no console (token sem typeAccess, tipo_sub
 * 'funcionario_portaria') via todos os botões da ocorrência e quase todos
 * falhavam em silêncio: as mutações passavam por assertStaff, que só aceita
 * Sindico/Funcionario. Agora a equipe do console opera (ciente, solucionar,
 * reabrir, responder, atribuir) pela mesma regra das outras telas da
 * portaria: assertOperador + a flag `ocorrencias` do funcionário do app.
 * Remover e alternar Pública/Privada continuam fora do alcance do porteiro.
 */
describe('Ocorrências — operar pelo console', () => {
  const porteiro: JwtPayload = { sub: 3, nome: 'Porteiro', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' };
  const sindicoConsole: JwtPayload = { sub: 7, nome: 'Síndico', id_condominio: 1, turno: 'Síndico', typeAccess: 'Sindico' };
  // Sessão do console aberta por QR Code a partir do app do funcionário.
  const funcionarioQr: JwtPayload = { sub: 20, nome: 'Func', id_condominio: 1, turno: 'Porteiro (App)', typeAccess: 'Funcionario' };
  const morador: JwtPayload = { sub: 100, nome: 'Morador', typeAccess: 'Morador', user: { id: 100 } } as any;

  function montar(flag = 1) {
    const oc: any = { id: 5, id_condominio: 1, user: 100, status: 'Pendente', tipo: 1, publica: false };
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn(async () => ({ ocorrencias: flag })) },
      ocorrencias: {
        findUnique: jest.fn(async () => ({ ...oc })),
        update: jest.fn(async ({ data }: any) => ({ ...oc, ...data, categoria: null })),
        // Mudança de status: condicionada ao status de origem.
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (!where.status.in.includes(oc.status)) return { count: 0 };
          Object.assign(oc, data);
          return { count: 1 };
        }),
        delete: jest.fn(async () => ({})),
      },
      ocorrencias_Categorias: { findUnique: jest.fn(async () => ({ sla_horas: 24 })) },
      funcionarios_Portaria: {
        findMany: jest.fn(async () => [{ id: 3, login: 'porteiro@a', nome: 'Porteiro A', turno: 'Diurno', ativo: 1 }]),
      },
      users: {
        findMany: jest.fn(async () => [{ id: 31, login: 'porteiro@a' }]),
        findUnique: jest.fn(async () => null),
      },
    };
    const real = new TenantAccessService(prisma);
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn((id: number, f: any, p: any) => real.assertPermissaoFuncionario(id, f, p)),
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const svc = new OcorrenciasService(prisma, notifications, tenant, {} as any);
    return { svc, prisma };
  }

  describe('porteiro do console', () => {
    it('marca ciente, soluciona e reabre', async () => {
      const { svc, prisma } = montar();
      await svc.updateStatus(5, 'Ciente', porteiro);
      await svc.updateStatus(5, 'Solucionado', porteiro);
      await svc.updateStatus(5, 'Pendente', porteiro);
      expect(prisma.ocorrencias.updateMany).toHaveBeenCalledTimes(3);
    });

    it('responde publicamente e atribui responsável', async () => {
      const { svc, prisma } = montar();
      await svc.updateResposta(5, 'Encanador chamado', porteiro);
      await svc.atribuir(5, 31, porteiro);
      expect(prisma.ocorrencias.update).toHaveBeenCalledTimes(2);
    });

    it('NÃO remove nem alterna Pública/Privada', async () => {
      const { svc, prisma } = montar();
      await expect(svc.remove(5, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.updatePublica(5, true, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ocorrencias.delete).not.toHaveBeenCalled();
      expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
    });
  });

  describe('funcionário no console (QR Code) depende da flag `ocorrencias`', () => {
    it('sem a flag: 403 com mensagem clara e nada gravado', async () => {
      const { svc, prisma } = montar(0);
      const e = await svc.updateStatus(5, 'Ciente', funcionarioQr).catch((x) => x);
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(e.message).toMatch(/permissão/);
      expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
      expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
    });

    it('com a flag: opera', async () => {
      const { svc, prisma } = montar(1);
      await svc.updateStatus(5, 'Ciente', funcionarioQr);
      expect(prisma.ocorrencias.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  it('morador continua barrado', async () => {
    const { svc, prisma } = montar();
    await expect(svc.updateStatus(5, 'Solucionado', morador)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.updateResposta(5, 'x', morador)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.atribuir(5, 31, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
    expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
  });

  it('síndico no console continua podendo tudo', async () => {
    const { svc, prisma } = montar();
    await svc.updateStatus(5, 'Ciente', sindicoConsole);
    await svc.updatePublica(5, true, sindicoConsole);
    await svc.remove(5, sindicoConsole);
    expect(prisma.ocorrencias.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.ocorrencias.update).toHaveBeenCalledTimes(1);
    expect(prisma.ocorrencias.delete).toHaveBeenCalledTimes(1);
  });

  describe('GET acesso — o que a tela pode oferecer', () => {
    it.each([
      // Conversa desde que a mensagem passou a gravar id_funcionario_portaria (chat-porteiro.spec).
      ['porteiro do console', porteiro, 1, { operar: true, administrar: false, conversar: true }],
      ['síndico no console', sindicoConsole, 1, { operar: true, administrar: true, conversar: true }],
      ['funcionário QR com a flag', funcionarioQr, 1, { operar: true, administrar: false, conversar: true }],
      ['funcionário QR sem a flag', funcionarioQr, 0, { operar: false, administrar: false, conversar: false }],
      ['morador', morador, 1, { operar: false, administrar: false, conversar: false }],
    ])('%s', async (_n, user, flag, esperado) => {
      const { svc } = montar(flag as number);
      await expect(svc.acesso(1, user as JwtPayload)).resolves.toEqual(esperado);
    });

    it('a rota existe no controller', async () => {
      const service: any = { acesso: jest.fn(async () => ({ operar: true })) };
      const ctrl = new OcorrenciasController(service);
      await ctrl.acesso(1, porteiro);
      expect(service.acesso).toHaveBeenCalledWith(1, porteiro);
    });
  });
});
