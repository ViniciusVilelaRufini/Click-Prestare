import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ContatosService } from './contatos.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Contatos úteis são a agenda de mão de obra do prédio: o síndico publica e o
 * morador só consulta. O risco aqui não é vazar dado sensível — é o morador
 * conseguir ESCREVER, porque um telefone falso de "chaveiro" cadastrado por
 * qualquer um vira golpe com a credibilidade do app.
 */
describe('ContatosService — quem escreve e quem lê', () => {
  const contatoDoCond2 = { id: 500, id_condominio: 2 };

  function buildService(overrides: Partial<any> = {}) {
    const prisma: any = {
      isConnected: true,
      contatos_Uteis: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 500 ? { ...contatoDoCond2 } : null,
        ),
        create: jest.fn(async () => ({ ...contatoDoCond2 })),
        update: jest.fn(async () => ({ ...contatoDoCond2 })),
        delete: jest.fn(async () => ({ ...contatoDoCond2 })),
      },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      apartamentos_Users: { findFirst: jest.fn(async () => null) },
      funcionarios: { findFirst: jest.fn(async () => null) },
      ...overrides,
    };
    const tenant = new TenantAccessService(prisma);
    return { svc: new ContatosService(prisma, tenant), prisma };
  }

  const sindicoDoCond2: JwtPayload = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico' };
  const moradorDoCond2: JwtPayload = { sub: 7, nome: 'Morador', typeAccess: 'Morador' };

  /** Síndico com vínculo real ao condomínio 2 (o que o TenantAccessService checa). */
  function comVinculoSindico(overrides: Partial<any> = {}) {
    return buildService({
      sindicos_Condominios: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 9 && where.id_condominio === 2 ? { id: 1 } : null,
        ),
      },
      ...overrides,
    });
  }

  const contatoValido = { nome: 'João Elétrica', categoria: 'Eletricista', telefone: '11999990000' };

  describe('escrita é só de staff', () => {
    it('NEGA morador cadastrar contato', async () => {
      const { svc, prisma } = buildService();
      await expect(
        svc.insert(2, contatoValido, moradorDoCond2),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.contatos_Uteis.create).not.toHaveBeenCalled();
    });

    it('NEGA morador remover contato', async () => {
      const { svc, prisma } = buildService();
      await expect(svc.remove(500, moradorDoCond2)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.contatos_Uteis.delete).not.toHaveBeenCalled();
    });

    it('PERMITE síndico do condomínio cadastrar', async () => {
      const { svc, prisma } = comVinculoSindico();
      await svc.insert(2, contatoValido, sindicoDoCond2);
      expect(prisma.contatos_Uteis.create).toHaveBeenCalled();
    });
  });

  describe('leitura é de qualquer pessoa do condomínio, mas só do dele', () => {
    it('PERMITE morador vinculado listar', async () => {
      const { svc, prisma } = buildService({
        apartamentos_Users: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 7 && where.apartamento?.id_condominio === 2
              ? { id_apto: 10 }
              : null,
          ),
        },
      });
      await svc.getAll(2, moradorDoCond2);
      expect(prisma.contatos_Uteis.findMany).toHaveBeenCalled();
    });

    it('NEGA morador listar contatos de outro condomínio', async () => {
      const { svc } = buildService();
      await expect(svc.getAll(999, moradorDoCond2)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('cross-tenant no update/remove (IDOR)', () => {
    it('NEGA síndico de outro condomínio editar contato deste', async () => {
      // Síndico 9 tem vínculo com o cond 3, e tenta editar o contato 500 (cond 2)
      // passando id_condominio=3 no corpo — a checagem do dono real tem que pegar.
      const { svc, prisma } = buildService({
        sindicos_Condominios: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 9 && where.id_condominio === 3 ? { id: 1 } : null,
          ),
        },
      });
      await expect(
        svc.update(3, { id: 500, ...contatoValido }, sindicoDoCond2),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.contatos_Uteis.update).not.toHaveBeenCalled();
    });

    it('404 ao editar contato inexistente', async () => {
      const { svc } = comVinculoSindico();
      await expect(
        svc.update(2, { id: 12345, ...contatoValido }, sindicoDoCond2),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('validação de campos', () => {
    it('exige nome, categoria e telefone', async () => {
      const { svc } = comVinculoSindico();
      await expect(
        svc.insert(2, { nome: '  ', categoria: 'Eletricista', telefone: '119' }, sindicoDoCond2),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.insert(2, { nome: 'João', categoria: '', telefone: '119' }, sindicoDoCond2),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.insert(2, { nome: 'João', categoria: 'Eletricista', telefone: '' }, sindicoDoCond2),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
