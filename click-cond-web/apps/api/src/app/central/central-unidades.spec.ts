import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { criarBancoFalso } from '../interfone/banco-falso.spec';
import { CentralController } from './central.controller';
import { CentralService } from './central.service';

/**
 * "Ligar para a unidade" na Central: o operador não tem token de condomínio, então escolhe o
 * condomínio e busca a unidade por esta rota (só leitura, só `{ id, rotulo }`).
 */

const TOKEN_OPERADORA: any = { sub: 5, nome: 'Olga Operadora', papel: 'operador_central', cred: 'c'.repeat(32) };
const TOKEN_PORTEIRO: any = { sub: 3, nome: 'Carlos Porteiro', id_condominio: 1, tipo_sub: 'funcionario_portaria', cred: 'x' };
const TOKEN_TROCAR: any = { ...TOKEN_OPERADORA, trocar_senha: true };

function montar() {
  const banco = criarBancoFalso({
    condominios: [
      { id: 1, nome: 'Residencial Central', central_contratada: 1, ativo: 1 },
      { id: 2, nome: 'Prédio Sem Central', central_contratada: 0, ativo: 1 },
      { id: 3, nome: 'Central Desativado', central_contratada: 1, ativo: 0 },
    ],
    apartamentos: [
      { id: 101, id_condominio: 1, apto: '201', bloco: 'A', interfone_ramal: '201' },
      { id: 100, id_condominio: 1, apto: '106', bloco: 'A', interfone_ramal: '106' },
      { id: 102, id_condominio: 1, apto: '1006', bloco: 'Bloco B', interfone_ramal: null, fracao: '0,5' },
      { id: 103, id_condominio: 1, apto: '12', bloco: null, interfone_ramal: '12' },
      { id: 900, id_condominio: 2, apto: '106', bloco: 'A', interfone_ramal: '106' },
      { id: 300, id_condominio: 3, apto: '1', bloco: null, interfone_ramal: '1' },
    ],
  });
  const central = new CentralService(banco.prisma, {} as any, {} as any);
  const ctrl = new CentralController(central);
  return { ...banco, central, ctrl };
}

describe('central — unidades de um condomínio (Ligar)', () => {
  it('só id e rótulo, das unidades do condomínio da central, em ordem de bloco e apartamento', async () => {
    const m = montar();
    const r = await m.ctrl.unidades(1, undefined, TOKEN_OPERADORA);
    expect(r).toEqual([
      { id: 103, rotulo: 'Apto 12' },
      { id: 100, rotulo: 'Bloco A · Apto 106' },
      { id: 101, rotulo: 'Bloco A · Apto 201' },
      { id: 102, rotulo: 'Bloco B · Apto 1006' },
    ]);
    for (const u of r) expect(Object.keys(u).sort()).toEqual(['id', 'rotulo']);
  });

  it('busca pelo começo do número, do bloco ou dos dois, sem diferenciar maiúsculas', async () => {
    const m = montar();
    expect((await m.ctrl.unidades(1, '10', TOKEN_OPERADORA)).map((u) => u.id)).toEqual([100, 102]);
    expect((await m.ctrl.unidades(1, 'b', TOKEN_OPERADORA)).map((u) => u.id)).toEqual([102]);
    expect((await m.ctrl.unidades(1, 'bloco a 2', TOKEN_OPERADORA)).map((u) => u.id)).toEqual([101]);
    expect((await m.ctrl.unidades(1, 'Apto 106', TOKEN_OPERADORA)).map((u) => u.id)).toEqual([100]);
    expect(await m.ctrl.unidades(1, '999', TOKEN_OPERADORA)).toEqual([]);
  });

  it('no máximo 20 resultados', async () => {
    const m = montar();
    for (let i = 0; i < 30; i++) m.tabelas.apartamentos.push({ id: 1000 + i, id_condominio: 1, apto: String(500 + i), bloco: 'C' });
    expect(await m.ctrl.unidades(1, '5', TOKEN_OPERADORA)).toHaveLength(20);
  });

  it('condomínio sem central, desativado ou inexistente → 404', async () => {
    const m = montar();
    await expect(m.ctrl.unidades(2, undefined, TOKEN_OPERADORA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(m.ctrl.unidades(3, undefined, TOKEN_OPERADORA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(m.ctrl.unidades(77, undefined, TOKEN_OPERADORA)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('só operador da central, sem senha temporária pendente', async () => {
    const m = montar();
    await expect(m.ctrl.unidades(1, undefined, TOKEN_PORTEIRO)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.ctrl.unidades(1, undefined, TOKEN_TROCAR)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
