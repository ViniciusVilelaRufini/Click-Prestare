import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PessoasController } from './pessoas.controller';
import { PessoasService } from './pessoas.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Item 3 do fase0: o TenantGuard só confere o `:idCondominio` da rota, e um
 * morador legitimamente pertence ao condomínio dele — sozinho o guard não
 * separa "morador" de "operador da portaria/síndico". Sem `assertOperador`,
 * qualquer morador autenticado listava/buscava/criava pessoas (nome, CPF,
 * telefone, fotos) e lia o histórico de visitas de qualquer um.
 */
describe('PessoasController — exige operador e fecha IDOR cross-tenant', () => {
  const morador: JwtPayload = { sub: 10, nome: 'Morador', typeAccess: 'Morador' };
  const sindicoApp: JwtPayload = { sub: 11, nome: 'Síndico', typeAccess: 'Sindico' };
  const porteiroWeb: JwtPayload = { sub: 12, nome: 'Porteiro', id_condominio: 1 };

  function build() {
    const service: any = {
      buscarPessoas: jest.fn(async () => []),
      obterOuCriar: jest.fn(async () => ({ id: 1 })),
      obterHistorico: jest.fn(async () => []),
    };
    return { ctrl: new PessoasController(service), service };
  }

  it('NEGA morador buscar pessoas cadastradas', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.buscar(1, morador, 'joao')).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.buscarPessoas).not.toHaveBeenCalled();
  });

  it('NEGA morador criar/cadastrar uma pessoa', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.criar(1, { nome: 'X' } as any, morador)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(service.obterOuCriar).not.toHaveBeenCalled();
  });

  it('NEGA morador ver o histórico de visitas de uma pessoa', async () => {
    const { ctrl, service } = build();
    await expect(ctrl.obterHistorico(1, 5, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.obterHistorico).not.toHaveBeenCalled();
  });

  it('PERMITE operador da portaria-web buscar pessoas', async () => {
    const { ctrl, service } = build();
    await ctrl.buscar(1, porteiroWeb, 'joao');
    expect(service.buscarPessoas).toHaveBeenCalled();
  });

  it('PERMITE síndico do app criar pessoa', async () => {
    const { ctrl, service } = build();
    await ctrl.criar(1, { nome: 'X' } as any, sindicoApp);
    expect(service.obterOuCriar).toHaveBeenCalled();
  });

  describe('IDOR cross-tenant em GET :idPessoa/historico (via service real)', () => {
    it('operador do condomínio A é recusado ao ler histórico de pessoa do condomínio B', async () => {
      const mockPrisma: any = {
        pessoas: { findUnique: jest.fn().mockResolvedValue({ id: 77, id_condominio: 2 }) },
        visitas: { findMany: jest.fn() },
      };
      const service = new PessoasService(mockPrisma);
      const ctrl = new PessoasController(service);

      // idCondominio=1 na rota, mas a pessoa 77 é do condomínio 2.
      await expect(ctrl.obterHistorico(1, 77, porteiroWeb)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockPrisma.visitas.findMany).not.toHaveBeenCalled();
    });

    it('operador do condomínio correto lê o histórico normalmente', async () => {
      const mockPrisma: any = {
        pessoas: { findUnique: jest.fn().mockResolvedValue({ id: 77, id_condominio: 1 }) },
        visitas: { findMany: jest.fn().mockResolvedValue([{ id: 1 }]) },
      };
      const service = new PessoasService(mockPrisma);
      const ctrl = new PessoasController(service);

      const res = await ctrl.obterHistorico(1, 77, porteiroWeb);
      expect(res).toHaveLength(1);
    });

    it('pessoa inexistente devolve 404, não 500', async () => {
      const mockPrisma: any = {
        pessoas: { findUnique: jest.fn().mockResolvedValue(null) },
        visitas: { findMany: jest.fn() },
      };
      const service = new PessoasService(mockPrisma);
      const ctrl = new PessoasController(service);

      await expect(ctrl.obterHistorico(1, 999, porteiroWeb)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
