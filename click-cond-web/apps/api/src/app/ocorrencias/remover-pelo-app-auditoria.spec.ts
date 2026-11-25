import { BadRequestException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';

/**
 * POST /ocorrencias/remove (app) não deixava rastro: o token do app não traz id_condominio e o
 * AuditInterceptor não grava. removerPeloApp grava a exclusão no condomínio da ocorrência, com o
 * número e a categoria (nunca o texto do relato), só quando a exclusão acontece.
 */
describe('OcorrenciasService.removerPeloApp — auditoria', () => {
  const autor = { sub: 100, nome: 'Morador Beto', typeAccess: 'Morador', user: { id: 100, nome: 'Morador Beto' } } as any;
  const sindico = { sub: 7, nome: 'Síndica Ana', typeAccess: 'Sindico', user: { id: 7, nome: 'Síndica Ana' } } as any;

  function montar(opts: { status?: string; corrida?: boolean } = {}) {
    const oc = { id: 5, id_condominio: 3, user: 100, status: opts.status ?? 'Pendente', resposta_at: null, descricao: 'relato pessoal', categoria: { nome: 'Barulho' } };
    const prisma: any = {
      ocorrencias: {
        findUnique: jest.fn(async () => oc),
        deleteMany: jest.fn(async () => ({ count: opts.corrida ? 0 : 1 })),
        delete: jest.fn(async () => ({})),
      },
      ocorrenciaMensagens: { count: jest.fn(async () => 0) },
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined), assertCondominio: jest.fn(async () => undefined) };
    const registrar = jest.fn(async () => undefined);
    const svc = new OcorrenciasService(prisma, {} as any, tenant, {} as any, { registrar } as any);
    (svc as any).loadParaAdministrar = jest.fn(async () => oc);
    return { svc, registrar, linhas: () => registrar.mock.calls.map((c: any[]) => c[0]) };
  }

  it('autor exclui a própria pendente: DELETE em ocorrencias com número e categoria', async () => {
    const { svc, linhas } = montar();
    await svc.removerPeloApp(5, autor);
    expect(linhas()).toEqual([
      expect.objectContaining({
        id_condominio: 3,
        acao: 'DELETE',
        modulo: 'ocorrencias',
        entidade_id: 5,
        usuario_nome: 'Morador Beto',
        descricao: 'Removeu a ocorrência #5 (Barulho)',
      }),
    ]);
    expect(JSON.stringify(linhas())).not.toContain('relato pessoal');
  });

  it('síndico exclui pelo app: também grava', async () => {
    const { svc, linhas } = montar({ status: 'Em andamento' });
    await svc.removerPeloApp(5, sindico);
    expect(linhas()).toEqual([expect.objectContaining({ id_condominio: 3, acao: 'DELETE', usuario_nome: 'Síndica Ana', entidade_id: 5 })]);
  });

  it('exclusão recusada (corrida com a equipe): nada gravado', async () => {
    const { svc, linhas } = montar({ corrida: true });
    await expect(svc.removerPeloApp(5, autor)).rejects.toBeInstanceOf(BadRequestException);
    expect(linhas()).toEqual([]);
  });
});
