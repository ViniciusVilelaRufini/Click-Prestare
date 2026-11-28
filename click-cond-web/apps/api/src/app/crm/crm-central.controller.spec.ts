import * as bcrypt from 'bcrypt';
import { CrmCentralController } from './crm-central.controller';
import { CrmAdminGuard } from './crm-admin.guard';

/*
 * Operadores da central (cadastro no CRM). A senha temporária sai uma vez na resposta e nunca
 * mais (a lista não traz senha nem hash); criar, desativar/reativar e nova senha trocam o
 * carimbo `cred` (derruba os tokens do operador).
 */

const ADMIN: any = { sub: 1, nome: 'Admin', role: 'crm_admin' };

function bancoOperadores(inicial: any[] = []) {
  let seq = inicial.reduce((m, r) => Math.max(m, r.id), 0);
  const linhas: any[] = inicial.map((r) => ({ ...r }));
  const casa = (r: any, where: any = {}) => Object.entries(where).every(([k, v]) => r[k] === v);
  const prisma: any = {
    isConnected: true,
    central_Operadores: {
      findMany: jest.fn(async (a: any = {}) =>
        linhas
          .filter((r) => casa(r, a.where))
          .sort((x, y) => x.nome.localeCompare(y.nome))
          .map((r) => (a.select ? Object.fromEntries(Object.keys(a.select).map((k) => [k, r[k]])) : { ...r })),
      ),
      findUnique: jest.fn(async (a: any) => {
        const r = linhas.find((x) => casa(x, a.where));
        return r ? { ...r } : null;
      }),
      create: jest.fn(async (a: any) => {
        if (linhas.some((x) => x.email === a.data.email)) throw Object.assign(new Error('único'), { code: 'P2002' });
        const r = { id: ++seq, trocar_senha: 1, ativo: 1, cred: '', ultimo_acesso: null, created_at: new Date(), ...a.data };
        linhas.push(r);
        return { ...r };
      }),
      update: jest.fn(async (a: any) => {
        const r = linhas.find((x) => casa(x, a.where));
        if (!r) throw Object.assign(new Error('não achou'), { code: 'P2025' });
        Object.assign(r, a.data);
        return { ...r };
      }),
    },
  };
  return { prisma, linhas };
}

describe('CRM: operadores da central', () => {
  it('só crm_admin (CrmAdminGuard no controller)', () => {
    expect(Reflect.getMetadata('__guards__', CrmCentralController)).toContain(CrmAdminGuard);
  });

  it('criar operador devolve senha temporária uma vez e grava hash', async () => {
    const b = bancoOperadores();
    const c = new CrmCentralController(b.prisma);
    const r = await c.criar({ nome: '  Ana Central ', email: ' Ana@Prestare.TEST ' }, ADMIN);
    expect(r).toEqual({ id: expect.any(Number), senha_temporaria: expect.any(String) });
    expect(r.senha_temporaria).toMatch(/^[A-Za-z0-9]{12}$/);
    const linha = b.linhas[0];
    expect(linha).toMatchObject({ nome: 'Ana Central', email: 'ana@prestare.test', trocar_senha: 1, ativo: 1 });
    expect(linha.senha_hash).not.toBe(r.senha_temporaria);
    expect(linha.senha_hash).toMatch(/^\$2[aby]\$12\$/);
    await expect(bcrypt.compare(r.senha_temporaria, linha.senha_hash)).resolves.toBe(true);
    expect(linha.cred).toMatch(/^[0-9a-f]{32}$/);

    // A lista nunca traz a senha nem o hash nem o carimbo.
    const lista = await c.listar();
    expect(lista).toEqual([
      { id: r.id, nome: 'Ana Central', email: 'ana@prestare.test', ativo: true, trocar_senha: true, ultimo_acesso: null, created_at: expect.any(Date) },
    ]);
    const texto = JSON.stringify(lista);
    expect(texto).not.toContain(r.senha_temporaria);
    expect(texto).not.toContain('senha_hash');
    expect(texto).not.toContain(linha.cred);
  }, 20_000);

  it('e-mail repetido → 409; nome ou e-mail inválido → 400', async () => {
    const b = bancoOperadores([
      { id: 1, nome: 'Ana', email: 'ana@prestare.test', senha_hash: 'x', trocar_senha: 0, ativo: 1, cred: 'a'.repeat(32), ultimo_acesso: null, created_at: new Date() },
    ]);
    const c = new CrmCentralController(b.prisma);
    await expect(c.criar({ nome: 'Outra', email: 'ANA@prestare.test' }, ADMIN)).rejects.toMatchObject({ status: 409 });
    await expect(c.criar({ nome: '', email: 'b@prestare.test' }, ADMIN)).rejects.toMatchObject({ status: 400 });
    await expect(c.criar({ nome: 'B', email: 'sem-arroba' }, ADMIN)).rejects.toMatchObject({ status: 400 });
    await expect(c.criar({ nome: 'x'.repeat(121), email: 'b@prestare.test' }, ADMIN)).rejects.toMatchObject({ status: 400 });
    expect(b.linhas).toHaveLength(1);
  }, 20_000);

  it('desativar e reativar trocam o cred', async () => {
    const credAntigo = 'a'.repeat(32);
    const b = bancoOperadores([
      { id: 5, nome: 'Ana', email: 'ana@prestare.test', senha_hash: 'x', trocar_senha: 0, ativo: 1, cred: credAntigo, ultimo_acesso: null, created_at: new Date() },
    ]);
    const c = new CrmCentralController(b.prisma);
    await expect(c.ativo(5, false, ADMIN)).resolves.toEqual({ id: 5, ativo: false });
    expect(b.linhas[0].ativo).toBe(0);
    const credDesativado = b.linhas[0].cred;
    expect(credDesativado).not.toBe(credAntigo);
    await expect(c.ativo(5, true, ADMIN)).resolves.toEqual({ id: 5, ativo: true });
    expect(b.linhas[0].ativo).toBe(1);
    expect(b.linhas[0].cred).not.toBe(credDesativado);
    await expect(c.ativo(5, 'sim' as any, ADMIN)).rejects.toMatchObject({ status: 400 });
    await expect(c.ativo(99, false, ADMIN)).rejects.toMatchObject({ status: 404 });
  });

  it('nova senha devolve a temporária, grava hash, pede troca e troca o cred', async () => {
    const credAntigo = 'a'.repeat(32);
    const b = bancoOperadores([
      { id: 5, nome: 'Ana', email: 'ana@prestare.test', senha_hash: 'x', trocar_senha: 0, ativo: 1, cred: credAntigo, ultimo_acesso: null, created_at: new Date() },
    ]);
    const c = new CrmCentralController(b.prisma);
    const r = await c.novaSenha(5, ADMIN);
    expect(Object.keys(r)).toEqual(['senha_temporaria']);
    expect(r.senha_temporaria).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(b.linhas[0].trocar_senha).toBe(1);
    expect(b.linhas[0].cred).not.toBe(credAntigo);
    await expect(bcrypt.compare(r.senha_temporaria, b.linhas[0].senha_hash)).resolves.toBe(true);
    await expect(c.novaSenha(99, ADMIN)).rejects.toMatchObject({ status: 404 });
  }, 20_000);

  it('rotas que devolvem a senha temporária respondem no-store e ficam fora da auditoria automática', () => {
    for (const m of ['criar', 'novaSenha'] as const) {
      const h = Reflect.getMetadata('__headers__', (CrmCentralController.prototype as any)[m]) ?? [];
      expect(h).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    }
  });
});
