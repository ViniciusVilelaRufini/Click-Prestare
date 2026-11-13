import { FERRAMENTAS_LEITURA, type ContextoFerramenta } from './chat-ia.tools';

/**
 * Morador cujo cadastro tem bloco nulo/vazio (cadastro legado num condomínio com blocos): a tool
 * só filtrava destinatario_bloco quando havia bloco, então "101" casava com 101 de TODOS os blocos e
 * o assistente contava as encomendas dos vizinhos (descrição, remetente, horário). A listagem REST
 * (listEncomendasByUser) já trata bloco vazio como "só sem bloco".
 */
describe('encomendas_pendentes — morador sem bloco', () => {
  const tool = FERRAMENTAS_LEITURA.find((f) => f.nome === 'encomendas_pendentes')!;

  function ctx(bloco: string | null, over: Partial<ContextoFerramenta> = {}): ContextoFerramenta {
    return {
      idCondominio: 1,
      idUser: 47,
      papel: 'Morador',
      staff: false,
      ocorrenciasPrivadas: false,
      aptos: [],
      cartoes: [],
      prisma: {
        moradores: { findFirst: jest.fn(async () => ({ nome: 'Morador QA', bloco, apartamento: '101', tipo: null })) },
        encomendas: { findMany: jest.fn(async () => []) },
      } as any,
      ...over,
    } as ContextoFerramenta;
  }
  const whereDe = (c: ContextoFerramenta) => (c.prisma as any).encomendas.findMany.mock.calls[0][0].where;

  it.each([[null], [''], ['   ']])('bloco %p: só encomendas sem bloco do apto 101', async (bloco) => {
    const c = ctx(bloco);
    await tool.executar({}, c);
    expect(whereDe(c)).toEqual({
      id_condominio: 1,
      status: 'Aguardando',
      destinatario_apto: '101',
      OR: [{ destinatario_bloco: null }, { destinatario_bloco: '' }],
    });
  });

  it('bloco preenchido: casa o bloco exato (como antes)', async () => {
    const c = ctx('A');
    await tool.executar({}, c);
    expect(whereDe(c)).toEqual({ id_condominio: 1, status: 'Aguardando', destinatario_apto: '101', destinatario_bloco: 'A' });
  });

  it('staff continua vendo o condomínio inteiro', async () => {
    const c = ctx(null, { papel: 'Sindico', staff: true });
    await tool.executar({}, c);
    expect(whereDe(c)).toEqual({ id_condominio: 1, status: 'Aguardando' });
  });
});
