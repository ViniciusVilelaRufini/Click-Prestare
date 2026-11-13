import { resolverInfoVisitantesPorIdAcessoFacial } from './acesso-facial-visitante-lookup.util';

/**
 * Acessos_Facial.id_pessoa guarda id de Pessoa OU de Visita, sem coluna dizendo qual. O resolvedor
 * buscava as duas tabelas só por id: com faixas de autoincrement sobrepostas, o evento do condomínio 1
 * ganhava foto/documento/unidade do visitante do condomínio 2.
 */
describe('resolverInfoVisitantesPorIdAcessoFacial — só o condomínio do evento', () => {
  const pessoas = [{ id: 2000005, id_condominio: 1, foto_pessoa: 'a.jpg', doc_identificacao: '52998224725', tipo_pessoa: 'visitante' }];
  const visitas = [{
    id: 2000005, id_condominio: 2, apartamento: { bloco: 'B', apto: '1' },
    pessoa: { foto_pessoa: 'b.jpg', doc_identificacao: '11144477735', tipo_pessoa: 'visitante' },
  }];
  const filtra = (linhas: any[]) =>
    jest.fn(async ({ where }: any) =>
      linhas.filter((l) => where.id.in.includes(l.id) && (where.id_condominio === undefined || l.id_condominio === where.id_condominio)),
    );

  it('id que colide entre Pessoa (cond. 1) e Visita (cond. 2) resolve para a Pessoa do condomínio 1', async () => {
    const prisma: any = { pessoas: { findMany: filtra(pessoas) }, visitas: { findMany: filtra(visitas) } };
    const map = await resolverInfoVisitantesPorIdAcessoFacial(prisma, [2000005], 1);
    expect(map.get(2000005)).toEqual(expect.objectContaining({ doc_identificacao: '52998224725', apartamento: null }));
    expect(prisma.pessoas.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [2000005] }, id_condominio: 1 } }));
    expect(prisma.visitas.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [2000005] }, id_condominio: 1 } }));
  });
});
