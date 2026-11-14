import { BadRequestException } from '@nestjs/common';
import { MoradoresService } from '../moradores/moradores.service';
import { CrmService } from '../crm/crm.service';
import { CrmCondominiosService } from '../crm/crm-condominios.service';
import { DOMINIO_CONTA_REVOGADA } from './email-reservado.util';

/**
 * Nenhum cadastro grava e-mail/login de Users no domínio das lápides da
 * revogação de acesso (conta-revogada.invalid): quem ocupasse a lápide de
 * antemão fazia a revogação bater no @unique. App e prestadores já recusavam;
 * faltavam o cadastro de moradores (console) e o CRM.
 */
describe('Cadastros recusam e-mail no domínio reservado', () => {
  const RESERVADO = `alguem@${DOMINIO_CONTA_REVOGADA}`;
  const erro = new BadRequestException('E-mail inválido.');

  describe('MoradoresService', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        apartamentos: { findUnique: jest.fn() },
        moradores: {
          findFirst: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          findUnique: jest.fn(async () => ({ id: 3, id_condominio: 1, email: 'velho@x.com', id_user: 9, user: { id: 9 } })),
        },
        users: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        $transaction: jest.fn(),
      };
      const svc = new MoradoresService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
      return { svc, prisma };
    }

    it('create: 400 antes de consultar ou gravar', async () => {
      const { svc, prisma } = build();
      await expect(svc.create({ nome: 'N', email: RESERVADO, id_apartamento: 5, id_condominio: 1 } as any)).rejects.toThrow(erro);
      expect(prisma.apartamentos.findUnique).not.toHaveBeenCalled();
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('update trocando o e-mail para o domínio reservado: 400 sem gravar', async () => {
      const { svc, prisma } = build();
      await expect(svc.update(3, { email: ` Fulano@${DOMINIO_CONTA_REVOGADA.toUpperCase()} ` })).rejects.toThrow(erro);
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  it('CRM atualizarCliente: e-mail do síndico reservado → 400 sem gravar', async () => {
    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn(async () => ({ id: 1 })), update: jest.fn() },
      sindicos_Condominios: { findMany: jest.fn(async () => [{ id_user: 9 }]) },
      sindicos: { findFirst: jest.fn(), update: jest.fn() },
      users: { update: jest.fn() },
    };
    const svc = new CrmService(prisma, {} as any, {} as any);
    await expect(svc.atualizarCliente(1, { sindicoEmail: RESERVADO })).rejects.toThrow(erro);
    expect(prisma.condominios.update).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  describe('CrmCondominiosService', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        moradores: { findFirst: jest.fn(), update: jest.fn() },
        users: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        funcionarios_Portaria: { count: jest.fn(async () => 0) },
        $transaction: jest.fn(),
      };
      const svc = new CrmCondominiosService(prisma, { registrar: jest.fn() } as any, {} as any);
      return { svc, prisma };
    }

    it('criar condomínio com síndico no domínio reservado: 400 sem criar conta', async () => {
      const { svc, prisma } = build();
      await expect(
        svc.criar({ nome: 'Cond', sindico: { nome: 'S', email: RESERVADO, senha: '123456' } } as any, 'ana'),
      ).rejects.toThrow(erro);
      expect(prisma.users.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('corrigir e-mail de acesso do morador para o domínio reservado: 400 sem gravar', async () => {
      const { svc, prisma } = build();
      await expect(
        svc.corrigirEmailAcessoMorador(1, 50, { email: RESERVADO, motivo: 'm' }, { role: 'crm_admin' } as any),
      ).rejects.toThrow(erro);
      expect(prisma.moradores.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });
});
