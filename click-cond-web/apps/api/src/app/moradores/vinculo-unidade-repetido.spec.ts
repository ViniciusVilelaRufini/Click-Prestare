import { BadRequestException } from '@nestjs/common';
import { MoradoresService } from './moradores.service';
import { ehVinculoUnidadeRepetido } from '../common/vinculos-usuario.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * D4 (varredura 24/11): Apartamentos_Users não tinha chave única (id_apto, id_user). Duas gravações
 * ao mesmo tempo passavam pela conferência "já vinculado?" e gravavam vínculo e Moradores em dobro.
 * Com uq_au_apto_user (prisma/sql/2026-11-24-apartamentos-users-unico.sql) a segunda recebe P2002,
 * que a API devolve como "já vinculado".
 */
describe('ehVinculoUnidadeRepetido', () => {
  it('reconhece a chave pelo nome do índice ou pelos campos', () => {
    expect(ehVinculoUnidadeRepetido({ code: 'P2002', meta: { target: 'uq_au_apto_user' } })).toBe(true);
    expect(ehVinculoUnidadeRepetido({ code: 'P2002', meta: { target: ['id_apto', 'id_user'] } })).toBe(true);
  });
  it('não confunde com outras chaves nem outros erros', () => {
    expect(ehVinculoUnidadeRepetido({ code: 'P2002', meta: { target: 'uni_cpf' } })).toBe(false);
    expect(ehVinculoUnidadeRepetido({ code: 'P2002', meta: { target: ['login'] } })).toBe(false);
    expect(ehVinculoUnidadeRepetido({ code: 'P2003', meta: { target: 'uq_au_apto_user' } })).toBe(false);
    expect(ehVinculoUnidadeRepetido(new Error('x'))).toBe(false);
  });
});

describe('MoradoresService.linkExistingUser — corrida com a chave única', () => {
  const porteiro: JwtPayload = { sub: 12, nome: 'Porteiro', id_condominio: 1 };

  function montar(erroNoCreate: any) {
    const tx: any = {
      apartamentos_Users: { create: jest.fn(async () => { throw erroNoCreate; }) },
      moradores: { create: jest.fn(async () => ({ id: 1 })) },
      users: { update: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async () => ({ id: 3, id_condominio: 1, bloco: 'A', apto: '101' })) },
      users: { findUnique: jest.fn(async () => ({ id: 10, name: 'Ana' })) },
      // usuarioTemVinculoNoCondominio: tem vínculo aqui.
      sindicos_Condominios: { count: jest.fn(async () => 1) },
      funcionarios: { count: jest.fn(async () => 0) },
      moradores: { count: jest.fn(async () => 0) },
      // A conferência antes do create não vê o vínculo (a outra chamada ainda não gravou).
      apartamentos_Users: { count: jest.fn(async () => 0), findFirst: jest.fn(async () => null) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const svc = new MoradoresService(prisma, {} as any, {} as any, {} as any, {} as any);
    return { svc, tx };
  }

  it('P2002 da uq_au_apto_user vira "já está vinculado" e o Moradores não é gravado', async () => {
    const { svc, tx } = montar(Object.assign(new Error('Unique'), { code: 'P2002', meta: { target: 'uq_au_apto_user' } }));
    const p = svc.linkExistingUser(1, { id_user: 10, id_apartamento: 3 }, porteiro);
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow('Ana já está vinculado a este apartamento.');
    expect(tx.moradores.create).not.toHaveBeenCalled();
  });

  it('outro erro do banco segue como estava', async () => {
    const { svc } = montar(Object.assign(new Error('boom'), { code: 'P2010' }));
    await expect(svc.linkExistingUser(1, { id_user: 10, id_apartamento: 3 }, porteiro)).rejects.toThrow('boom');
  });
});
