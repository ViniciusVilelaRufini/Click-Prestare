import { RelatoriosService } from './relatorios.service';

/**
 * A coluna `audit_logs.modulo` é comparada pelo MySQL com colação que ignora acento e caixa:
 * `modulo = 'ocorrências'` casa com as linhas gravadas como `ocorrencias`. Quando há módulos
 * ocultos para quem pede, o módulo pedido que não bate em JS com a lista de ocultos não pode ir
 * sozinho para o banco — a exclusão dos ocultos tem que acompanhar o filtro, para passar pela
 * mesma colação.
 */
const SIGILOSOS = ['financeiro', 'crm', 'crm-condominio', 'superlogica', 'auth', 'AUTH'];

async function whereDe(modulo: string, verSigilosos: boolean, ocultarOcorrencias: boolean) {
  const prisma: any = {
    isConnected: true,
    auditLog: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
  };
  await (new RelatoriosService(prisma) as any).getAuditoria(
    1, modulo, undefined, undefined, 1, 50, verSigilosos, ocultarOcorrencias,
  );
  const where = prisma.auditLog.findMany.mock.calls[0][0].where;
  expect(prisma.auditLog.count.mock.calls[0][0].where).toEqual(where);
  return where;
}

/** O where nunca deixa passar uma linha de módulo oculto: ou lista vazia, ou exclusão junto do filtro. */
function excluiOcultos(where: any, ocultos: string[]) {
  if (where.modulo && Array.isArray(where.modulo.in) && where.modulo.in.length === 0) return true;
  const partes: any[] = Array.isArray(where.AND) ? where.AND : [];
  return partes.some((p) => p?.modulo?.notIn && ocultos.every((o) => p.modulo.notIn.includes(o)));
}

describe('RelatoriosService.getAuditoria — módulo pedido x colação do banco', () => {
  it.each(['ocorrências', 'OCORRÊNCIAS', 'Ocorrências', 'ocorrêncIas'])(
    'funcionário sem a flag pedindo "%s": o where exclui ocorrencias',
    async (m) => {
      const where = await whereDe(m, false, true);
      expect(excluiOcultos(where, ['ocorrencias'])).toBe(true);
    },
  );

  it.each(['finânceiro', 'Superlógica', 'ÁUTH', 'crm-condomínio'])(
    'porteiro pedindo "%s": o where exclui os sigilosos',
    async (m) => {
      const where = await whereDe(m, false, false);
      expect(excluiOcultos(where, SIGILOSOS)).toBe(true);
    },
  );

  it('módulo livre com ocultos: filtro pedido E exclusão dos ocultos', async () => {
    expect(await whereDe('encomendas', false, true)).toEqual({
      id_condominio: 1,
      AND: [{ modulo: 'encomendas' }, { modulo: { notIn: [...SIGILOSOS, 'ocorrencias'] } }],
    });
  });

  it('síndico (nada oculto): igualdade simples, sem AND', async () => {
    expect(await whereDe('ocorrências', true, false)).toEqual({ id_condominio: 1, modulo: 'ocorrências' });
  });
});
