import { RelatoriosController } from './relatorios.controller';
import { RelatoriosService } from './relatorios.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * As linhas do módulo `ocorrencias` no log de auditoria carregam o texto da ocorrência
 * (descricao/detalhes). O funcionário do app sem a flag `ocorrencias` não lê ocorrência privada
 * em lugar nenhum — então não lê essas linhas. Mesma decisão de recorteOcorrenciasPrivadas.
 * Síndico e porteiro do console: sem mudança.
 */
const funcionario: JwtPayload = { sub: 10, nome: 'Func', typeAccess: 'Funcionario', user: { id: 10 } };
const sindico: JwtPayload = { sub: 11, nome: 'Síndico', typeAccess: 'Sindico' };
const porteiro: JwtPayload = { sub: 3, nome: 'Porteiro', id_condominio: 1 };
const SIGILOSOS = ['financeiro', 'crm', 'crm-condominio', 'superlogica', 'auth', 'AUTH'];

describe('RelatoriosController.getAuditoria — ocorrências para o funcionário do app', () => {
  function build(recorte: number | null) {
    const service: any = { getAuditoria: jest.fn(async () => ({ items: [] })) };
    const tenant: any = { recorteOcorrenciasPrivadas: jest.fn(async () => recorte) };
    return { ctrl: new RelatoriosController(service, undefined, tenant), service, tenant };
  }

  it('funcionário sem a flag: pede a listagem sem o módulo ocorrencias', async () => {
    const { ctrl, service, tenant } = build(10);
    await ctrl.getAuditoria(1, funcionario);
    expect(tenant.recorteOcorrenciasPrivadas).toHaveBeenCalledWith(1, funcionario);
    expect(service.getAuditoria.mock.calls[0][7]).toBe(true);
  });

  it('funcionário com a flag: lista como antes', async () => {
    const { ctrl, service } = build(null);
    await ctrl.getAuditoria(1, funcionario);
    expect(service.getAuditoria.mock.calls[0][7]).toBe(false);
  });

  it.each([['síndico', sindico], ['porteiro do console', porteiro]])('%s: sem consultar a flag', async (_n, p) => {
    const { ctrl, service, tenant } = build(10);
    await ctrl.getAuditoria(1, p);
    expect(tenant.recorteOcorrenciasPrivadas).not.toHaveBeenCalled();
    expect(service.getAuditoria.mock.calls[0][7]).toBe(false);
  });
});

describe('RelatoriosService.getAuditoria — ocultarOcorrencias', () => {
  async function whereDe(modulo: string | undefined, verSigilosos: boolean, ocultarOcorrencias: boolean) {
    const prisma: any = {
      isConnected: true,
      auditLog: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    };
    await (new RelatoriosService(prisma) as any).getAuditoria(1, modulo, undefined, undefined, 1, 50, verSigilosos, ocultarOcorrencias);
    expect(prisma.auditLog.count.mock.calls[0][0].where).toEqual(prisma.auditLog.findMany.mock.calls[0][0].where);
    return prisma.auditLog.findMany.mock.calls[0][0].where;
  }

  it('sem filtro: exclui sigilosos e ocorrencias', async () => {
    expect(await whereDe(undefined, false, true)).toEqual({
      id_condominio: 1,
      modulo: { notIn: [...SIGILOSOS, 'ocorrencias'] },
    });
  });

  it.each(['ocorrencias', 'Ocorrencias', ' ocorrencias '])('pedindo "%s": lista vazia, sem erro', async (m) => {
    expect((await whereDe(m, false, true)).modulo).toEqual({ in: [] });
  });

  it('outro módulo segue como antes', async () => {
    expect((await whereDe('visitantes', false, true)).modulo).toEqual({ in: ['visitantes', 'visitas', 'pessoas'] });
  });

  it('sem ocultar: igual ao comportamento anterior', async () => {
    expect(await whereDe(undefined, false, false)).toEqual({ id_condominio: 1, modulo: { notIn: SIGILOSOS } });
    expect((await whereDe('ocorrencias', false, false)).AND).toEqual([
      { modulo: 'ocorrencias' },
      { modulo: { notIn: SIGILOSOS } },
    ]);
    expect((await whereDe('ocorrencias', true, false)).modulo).toBe('ocorrencias');
  });
});
